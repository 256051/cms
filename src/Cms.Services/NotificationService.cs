using System.Net;
using System.Net.Http.Json;
using System.Net.Mail;
using System.Text.Json;
using Cms.Data;
using Microsoft.Extensions.Configuration;

namespace Cms.Services;

/// <summary>Credential-free notification configuration status.</summary>
public record NotificationSettings(bool Enabled, bool EmailEnabled, bool WeComEnabled, string SiteUrl, string[] Errors);

/// <summary>Single-site durable notification delivery through configured SMTP and WeCom channels.</summary>
public sealed class NotificationService(CmsRepository repository, IConfiguration config)
{
    private static readonly DateTime StartedAt = DateTime.UtcNow;
    private static readonly SemaphoreSlim Sender = new(1, 1);
    private static readonly HttpClient Http = new(new SocketsHttpHandler { AllowAutoRedirect = false }) { Timeout = TimeSpan.FromSeconds(15) };
    private string Value(string key) => config["Notifications:" + key] ?? "";
    private bool Enabled(string key) => config.GetValue<bool>("Notifications:" + key);
    private string[] Channels => new[] { Enabled("Email:Enabled") ? "email" : "", Enabled("WeCom:Enabled") ? "wecom" : "" }.Where(x => x != "").ToArray();

    /// <summary>Expose enabled channels and setup errors without disclosing webhook or SMTP credentials.</summary>
    public NotificationSettings Settings()
    {
        var errors = new List<string>();
        if (Enabled("Enabled"))
        {
            if (Channels.Length == 0) errors.Add("请启用邮件或企业微信渠道。");
            if (!Uri.TryCreate(Value("SiteUrl"), UriKind.Absolute, out var site) || site.Scheme is not ("http" or "https") || site.UserInfo != "")
                errors.Add("请配置有效的站点地址。");
            if (Enabled("Email:Enabled"))
            {
                try
                {
                    _ = new MailAddress(Value("Email:From"));
                    using var message = new MailMessage(); message.To.Add(Value("Email:To"));
                    if (message.To.Count == 0 || message.To.Count > 20 || Value("Email:Host") == "" ||
                        config.GetValue<int>("Notifications:Email:Port", 587) is < 1 or > 65535) throw new FormatException();
                }
                catch (Exception e) when (e is FormatException or ArgumentException) { errors.Add("邮件服务器、发件人或收件人配置不完整。"); }
            }
            if (Enabled("WeCom:Enabled") && !Webhook(out _)) errors.Add("企业微信地址须使用官方 HTTPS 群机器人 Webhook。");
        }
        return new(Enabled("Enabled"), Enabled("Email:Enabled"), Enabled("WeCom:Enabled"), Value("SiteUrl"), errors.ToArray());
    }

    private bool Webhook(out Uri? uri) => Uri.TryCreate(Value("WeCom:WebhookUrl"), UriKind.Absolute, out uri) && uri.UserInfo == "" &&
        (uri.Scheme == "https" && uri.Host == "qyapi.weixin.qq.com" && uri.AbsolutePath == "/cgi-bin/webhook/send" ||
         uri.IsLoopback && uri.Scheme == "http");

    /// <summary>Page safe delivery records for administrators.</summary>
    public Task<PageResult<NotificationDelivery>> ListAsync(int page) => repository.PageAsync<NotificationDelivery>(x => true, page, 30);

    /// <summary>Queue a fresh retry round for an unsent failed message without resending successful events.</summary>
    public Task<bool> RetryAsync(string actor, string id) => repository.WriteAsync(actor, "notification.retry", async repo =>
    {
        var row = await repo.FindAsync<NotificationDelivery>(id) ?? throw new CmsException(404, "NOT_FOUND", "通知记录不存在。");
        if (row.Status != "failed") throw new CmsException(409, "NOT_RETRYABLE", "只有失败的通知可以重试。");
        repo.SetAuditTarget("notification", row.Id, row.Title);
        row.RemainingAttempts = 5; row.NextAttemptAt = DateTime.UtcNow; row.Status = "queued";
        await repo.UpdateAsync(row); return true;
    });

    private async Task EnqueueAsync(CmsRepository repo, string kind, string id, DateTime at, string title, string path)
    {
        var key = kind + ":" + id + ":" + DateTime.SpecifyKind(at, DateTimeKind.Utc).ToString("O");
        foreach (var channel in Channels)
            if (await repo.FirstAsync<NotificationDelivery>(x => x.EventKey == key && x.Channel == channel) == null)
                await repo.InsertAsync(new NotificationDelivery { EventKey = key, Kind = kind, TargetId = id, Channel = channel,
                    OccurredAt = at, Title = title, Path = path });
    }

    /// <summary>Deduplicate a failed schedule by its source identity and scheduled time.</summary>
    public Task ScheduleFailureAsync(Content row) => !Enabled("Enabled") ? Task.CompletedTask : repository.RecordTrafficAsync( async repo =>
    {
        await EnqueueAsync(repo, "schedule-failed", row.Id, row.ScheduledUnpublishAt <= DateTime.UtcNow
            ? row.ScheduledUnpublishAt!.Value : row.ScheduledPublishAt!.Value, "定时发布或下架失败", "/admin/" +
            (row.Kind == "block" ? "blocks" : row.Kind == "template" ? "templates" : row.Kind == "page" ? "pages" : row.Kind == "product" ? "products" : row.Kind == "case" ? "cases" : "posts") + "/" + row.Id);
        return true;
    });

    /// <summary>Discover actionable events, then deliver pending messages outside database write transactions.</summary>
    public async Task RunAsync(CancellationToken cancellation = default)
    {
        if (!Enabled("Enabled") || !await Sender.WaitAsync(0, cancellation)) return;
        try
        {
            await repository.RecordTrafficAsync( async repo =>
            {
                var state = await repo.FindAsync<NotificationState>("site");
                if (state == null) { state = new() { Id = "site", CreatedAt = StartedAt }; await repo.InsertAsync(state); }
                var now = DateTime.UtcNow;
                // ponytail: scan inquiries since activation; add an event cursor when the site's volume warrants it.
                foreach (var lead in await repo.ListAsync<CustomerLead>(x => x.CreatedAt >= state.CreatedAt ||
                    x.NextContactAt < now && x.Status != "completed" && x.Status != "invalid"))
                {
                    if (lead.CreatedAt >= state.CreatedAt)
                        await EnqueueAsync(repo, "lead-new", lead.Id, lead.CreatedAt, "收到新的客户咨询", "/admin/leads");
                    if (lead.NextContactAt < now && lead.Status is not ("completed" or "invalid"))
                        await EnqueueAsync(repo, "lead-overdue", lead.Id, lead.NextContactAt.Value, "客户咨询已到跟进时间", "/admin/leads");
                }
                var backup = await repo.FindAsync<MaintenanceState>("site");
                if (backup is { Error.Length: > 0, LastAttemptAt: { } at })
                    await EnqueueAsync(repo, "backup-failed", "site", at, "站点备份失败", "/admin/maintenance");
                return true;
            });
            var now = DateTime.UtcNow;
            var channels = Channels;
            var pending = await repository.PageAsync<NotificationDelivery>(x => x.SentAt == null && x.NextAttemptAt <= now && channels.Contains(x.Channel), 1, 10);
            foreach (var row in pending.Items)
            {
                cancellation.ThrowIfCancellationRequested();
                if (!await RelevantAsync(row)) { row.Status = "cancelled"; row.NextAttemptAt = null; }
                else
                {
                    row.Attempts++; row.RemainingAttempts--; row.LastAttemptAt = DateTime.UtcNow;
                    try
                    {
                        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellation);
                        timeout.CancelAfter(TimeSpan.FromSeconds(15));
                        await SendAsync(row, timeout.Token);
                        row.SentAt = DateTime.UtcNow; row.Status = "sent"; row.Error = ""; row.NextAttemptAt = null;
                    }
                    catch (Exception e) when (!cancellation.IsCancellationRequested)
                    {
                        row.Status = "failed";
                        row.Error = e is SmtpException ? "邮件发送失败，请检查服务器、认证和收件人配置。" : "发送未成功，请检查渠道配置、网络及接收服务。";
                        row.NextAttemptAt = row.RemainingAttempts > 0 ? DateTime.UtcNow.AddMinutes(Math.Pow(2, 5 - row.RemainingAttempts)) : null;
                    }
                }
                await repository.RecordTrafficAsync( async repo => { await repo.UpdateAsync(row); return true; });
            }
        }
        finally { Sender.Release(); }
    }

    private async Task<bool> RelevantAsync(NotificationDelivery row)
    {
        if (row.Kind is "lead-new" or "lead-overdue")
        {
            var lead = await repository.FindAsync<CustomerLead>(row.TargetId);
            return lead != null && (row.Kind == "lead-new" || lead.Status is not ("completed" or "invalid") &&
                lead.NextContactAt == row.OccurredAt && lead.NextContactAt < DateTime.UtcNow);
        }
        if (row.Kind == "backup-failed")
        {
            var state = await repository.FindAsync<MaintenanceState>("site");
            return state?.Error != "" && state?.LastAttemptAt == row.OccurredAt;
        }
        var content = await repository.FindAsync<Content>(row.TargetId);
        return content?.DeletedAt == null && content != null &&
            (content.ScheduledPublishAt == row.OccurredAt || content.ScheduledUnpublishAt == row.OccurredAt);
    }

    private async Task SendAsync(NotificationDelivery row, CancellationToken cancellation)
    {
        if (!Uri.TryCreate(Value("SiteUrl"), UriKind.Absolute, out var site) || site.Scheme is not ("http" or "https") || site.UserInfo != "")
            throw new InvalidOperationException("Invalid site URL.");
        var body = row.Title + "\n" + new Uri(site.GetLeftPart(UriPartial.Authority) + row.Path).AbsoluteUri +
            "\n事件编号：" + row.Id + "\n请登录后台查看详情。";
        if (row.Channel == "wecom")
        {
            if (!Webhook(out var webhook)) throw new InvalidOperationException("Invalid webhook.");
            using var response = await Http.PostAsJsonAsync(webhook, new { msgtype = "text", text = new { content = body } }, cancellation);
            response.EnsureSuccessStatusCode();
            using var json = JsonDocument.Parse(await response.Content.ReadAsStringAsync(cancellation));
            if (!json.RootElement.TryGetProperty("errcode", out var code) || code.GetInt32() != 0) throw new InvalidOperationException("Webhook rejected delivery.");
            return;
        }
        using var message = new MailMessage { From = new MailAddress(Value("Email:From")), Subject = "CMS · " + row.Title, Body = body };
        message.To.Add(Value("Email:To"));
        if (message.To.Count is < 1 or > 20) throw new InvalidOperationException("Invalid recipients.");
        using var smtp = new SmtpClient(Value("Email:Host"), config.GetValue<int>("Notifications:Email:Port", 587)) {
            EnableSsl = config.GetValue<bool>("Notifications:Email:EnableSsl", true), UseDefaultCredentials = false };
        if (Value("Email:Username") != "") smtp.Credentials = new NetworkCredential(Value("Email:Username"), Value("Email:Password"));
        await smtp.SendMailAsync(message, cancellation);
    }
}
