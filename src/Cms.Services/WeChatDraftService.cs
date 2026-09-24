using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using AngleSharp.Html.Parser;
using Cms.Data;
using Microsoft.Extensions.Logging;

namespace Cms.Services;

/// <summary>Public configuration status with no secrets.</summary>
public record WeChatSettings(bool Enabled, bool AutoSync, string AppId, string[] Errors, bool AutoPublish = false);
/// <summary>Frozen fields sent to the destination account.</summary>
public record WeChatArticle(string Title, string Digest, string Html, string CoverId, string Author, string SourceUrl);
/// <summary>Safe editorial delivery status.</summary>
public record WeChatDraftView(string Id, string Status, string MediaId, string Error, DateTime UpdatedAt,
    string PublicationStatus = "", string PublishId = "", string PublicationError = "", bool CanRetryPublication = false);

/// <summary>Durable single-account draft delivery using only published website snapshots.</summary>
public sealed class WeChatDraftService(CmsRepository repository, WeChatSettingsService accountSettings, AssetService assets, WeChatClient client,
    ILogger<WeChatDraftService>? logger = null)
{
    // ponytail: one sender per API process, matching CmsRepository; use database leases before multiple API replicas.
    private static readonly SemaphoreSlim Sender = new(1, 1);

    /// <summary>Check effective settings without exposing the secret.</summary>
    public Task<WeChatSettings> SettingsAsync() => accountSettings.StatusAsync();

    /// <summary>Atomically enqueue a publication from any publishing entry point, without network calls.</summary>
    public static async Task EnqueuePublicationAsync(CmsRepository repo, Content row, WeChatSettingsService? accountSettings, bool? syncToWeChat = null)
    {
        if (syncToWeChat == false) return;
        if (accountSettings == null || row.Kind != "post")
        {
            if (syncToWeChat == true) throw Bad("公众号同步仅支持已配置接入的文章发布。");
            return;
        }
        var options = await accountSettings.LoadAsync(repo);
        var ready = options.Enabled && WeChatSettingsService.Errors(options).Length == 0;
        if (syncToWeChat == true && !ready)
            throw Bad("公众号接入未启用或配置不完整，请先配置接入，或取消勾选同步后再发布。");
        if (ready && (syncToWeChat ?? options.AutoSync)) await EnqueueAsync(repo, row, options);
    }

    private static async Task<WeChatDraft> EnqueueAsync(CmsRepository repo, Content row, WeChatOptions options)
    {
        var snapshot = ContentService.Published(row);
        var article = new WeChatArticle(snapshot.Title, snapshot.Summary, snapshot.Html, snapshot.CoverId,
            options.Author, options.SiteUrl.TrimEnd('/') + ContentService.PublicPath("post", snapshot.Slug));
        var json = JsonSerializer.Serialize(article);
        var hash = Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(WeChatArticleFormatter.Version + "\n" + json)));
        var app = options.AppId;
        var previous = await repo.FirstAsync<WeChatDraft>(x => x.AppId == app && x.ContentId == row.Id && x.Fingerprint == hash);
        if (previous != null)
        {
            if (previous.Status == "cancelled")
            {
                previous.Status = "queued"; previous.Error = ""; previous.UpdatedAt = DateTime.UtcNow;
                await repo.UpdateAsync(previous);
            }
            return previous;
        }
        var job = new WeChatDraft { AppId = app, ContentId = row.Id, Fingerprint = hash, SnapshotJson = json };
        await repo.InsertAsync(job);
        if (options.AutoPublish) await repo.InsertAsync(new WeChatPublication { Id = job.Id, AppId = app });
        return job;
    }

    /// <summary>Queue the expected current publication; unsaved drafts never leave the CMS.</summary>
    public Task<WeChatDraftView> QueueAsync(string actor, string id, int version) => repository.WriteAsync(actor, "wechat.queue", async repo =>
    {
        var options = await RequireReadyAsync(repo);
        var row = await repo.FindAsync<Content>(id);
        if (row is not { Kind: "post", Published: true, DeletedAt: null }) throw Bad("请先在网站发布这篇文章。");
        if (row.Version != version) throw new CmsException(409, "VERSION_CONFLICT", "文章已变化，请刷新后重试。");
        repo.SetAuditTarget("post", row.Id, row.PublishedTitle);
        var article = ContentService.Published(row);
        Validate(new(article.Title, article.Summary, article.Html, article.CoverId, options.Author, ""));
        return await ViewAsync(await EnqueueAsync(repo, row, options), repo);
    });

    /// <summary>Read recent outcomes for the configured account without disclosing snapshots.</summary>
    public async Task<IReadOnlyList<WeChatDraftView>> HistoryAsync(string id)
    {
        var app = (await accountSettings.LoadAsync()).AppId;
        var result = new List<WeChatDraftView>();
        foreach (var row in (await repository.PageAsync<WeChatDraft>(x => x.ContentId == id && x.AppId == app, 1, 10)).Items)
            result.Add(await ViewAsync(row, repository));
        return result;
    }

    /// <summary>Retry only definite failures, never an uncertain draft creation.</summary>
    public Task<bool> RetryAsync(string actor, string id) => repository.WriteAsync(actor, "wechat.retry", async repo =>
    {
        var options = await RequireReadyAsync(repo);
        var job = await repo.FindAsync<WeChatDraft>(id) ?? throw Bad("同步记录不存在。");
        var publication = await repo.FindAsync<WeChatPublication>(id);
        if (job.AppId == options.AppId && job.Status == "draft" && publication is { Status: "failed", PublishId: "" })
        {
            if (!options.AutoPublish) throw Bad("自动发布已关闭，请到微信后台处理草稿。");
            repo.SetAuditTarget("post", job.ContentId, "公众号发布重试");
            publication.Status = "queued"; publication.Error = ""; publication.UpdatedAt = DateTime.UtcNow;
            await repo.UpdateAsync(publication);
            return true;
        }
        if (job.AppId != options.AppId || job.Status != "failed") throw Bad("仅当前公众号明确失败的同步可以重试；待核实结果请先在公众号后台检查。");
        repo.SetAuditTarget("post", job.ContentId, "公众号草稿重试");
        job.Status = "queued"; job.Error = ""; job.UpdatedAt = DateTime.UtcNow;
        await repo.UpdateAsync(job);
        return true;
    });

    /// <summary>Deliver queued drafts outside website transactions; ambiguous submissions are never replayed.</summary>
    public async Task RunAsync(CancellationToken cancellation)
    {
        var settings = await SettingsAsync();
        if (!settings.Enabled || settings.Errors.Length != 0 || !await Sender.WaitAsync(0, cancellation)) return;
        try
        {
            // A previous process may have stopped between sending a request and persisting its result.
            foreach (var interrupted in await repository.ListAsync<WeChatDraft>(x => x.AppId == settings.AppId &&
                (x.Status == "submitting" || x.Status == "preparing")))
            {
                interrupted.Status = interrupted.Status == "submitting" ? "unknown" : "failed";
                interrupted.Error = interrupted.Status == "unknown" ? "上次提交中断，请在公众号草稿箱核实；系统不会自动重发。" : "上次素材准备中断，可以重试。";
                await SaveAsync(interrupted);
            }
            var pending = await repository.PageAsync<WeChatDraft>(x => x.AppId == settings.AppId && x.Status == "queued", 1, 10);
            foreach (var job in pending.Items)
            {
                cancellation.ThrowIfCancellationRequested();
                // Hold one account snapshot for the entire request chain; never send an old account's job to a new account.
                var account = await accountSettings.LoadAsync();
                if (!account.Enabled || account.AppId != job.AppId || WeChatSettingsService.Errors(account).Length != 0) return;
                var step = "读取网站文章";
                var assetId = "";
                try
                {
                    var content = await repository.FindAsync<Content>(job.ContentId);
                    if (content is not { Published: true, DeletedAt: null })
                    {
                        job.Status = "cancelled"; job.Error = "网站文章已下架或删除，同步已取消。";
                        await SaveAsync(job); continue;
                    }
                    job.Status = "preparing"; await SaveAsync(job);
                    step = "校验文章快照";
                    var article = JsonSerializer.Deserialize<WeChatArticle>(job.SnapshotJson)!;
                    Validate(article);
                    var document = new HtmlParser().ParseDocument(article.Html);
                    var imageIds = document.QuerySelectorAll("img").Select(x => (x.GetAttribute("src") ?? "")[7..]).Distinct().ToArray();
                    step = "读取封面文件"; assetId = article.CoverId;
                    var cover = await ImageAsync(article.CoverId, true);
                    var images = new Dictionary<string, FileView>();
                    step = "读取正文图片";
                    foreach (var id in imageIds) { assetId = id; images[id] = await ImageAsync(id, false); }
                    step = "上传微信封面"; assetId = article.CoverId;
                    var coverId = await client.UploadAsync(cover, true, account, cancellation);
                    var urls = new Dictionary<string, string>();
                    step = "上传正文图片";
                    foreach (var (id, file) in images) { assetId = id; urls[id] = await client.UploadAsync(file, false, account, cancellation); }
                    step = "转换公众号正文"; assetId = "";
                    foreach (var image in document.QuerySelectorAll("img"))
                    {
                        image.SetAttribute("src", urls[image.GetAttribute("src")![7..]]);
                    }
                    foreach (var link in document.QuerySelectorAll("a[href]"))
                    {
                        var href = link.GetAttribute("href")!;
                        if (href.StartsWith('/') && !href.StartsWith("//")) link.SetAttribute("href", new Uri(new Uri(article.SourceUrl), href).AbsoluteUri);
                    }
                    var html = WeChatArticleFormatter.Format(document.Body!);
                    if (html.Length >= 20000 || Encoding.UTF8.GetByteCount(html) >= 1_000_000) throw Bad("转换后的正文超过微信限制，请缩短文章。");
                    job.Status = "submitting"; await SaveAsync(job);
                    step = "创建微信草稿";
                    var response = await client.PostAsync("draft/add", new { articles = new[] { new {
                        article_type = "news", title = article.Title, author = article.Author, digest = article.Digest,
                        content = html, content_source_url = article.SourceUrl, thumb_media_id = coverId,
                        need_open_comment = 0, only_fans_can_comment = 0
                    } } }, account, cancellation);
                    job.MediaId = WeChatClient.Required(response, "media_id", "draft/add");
                    if (job.MediaId.Length > 128) throw new HttpRequestException("Invalid draft identifier.");
                    job.Status = "draft"; job.Error = "";
                }
                catch (CmsException error)
                {
                    job.Status = "failed"; job.Error = error.Code == "WECHAT_REJECTED" ? error.Message : $"{step}：{error.Message}";
                    LogFailure(job.Id, job.ContentId, step, assetId, error, job.Error);
                }
                catch (Exception error) when (!cancellation.IsCancellationRequested)
                {
                    var detail = Failure(step, error);
                    job.Error = job.Status == "submitting" ? $"提交结果未知，请在公众号草稿箱核实；系统不会自动重发。{detail}" : detail;
                    LogFailure(job.Id, job.ContentId, step, assetId, error, job.Error);
                    job.Status = job.Status == "submitting" ? "unknown" : "failed";
                }
                await SaveAsync(job);
            }
            await PublishAsync(settings.AppId, cancellation);
        }
        finally { Sender.Release(); }
    }

    private async Task PublishAsync(string appId, CancellationToken cancellation)
    {
        foreach (var interrupted in await repository.ListAsync<WeChatPublication>(x => x.AppId == appId && x.Status == "submitting"))
        {
            interrupted.Status = "unknown";
            interrupted.Error = "上次发布提交中断，请在微信后台核实；系统不会自动重发。";
            await SavePublicationAsync(interrupted);
        }
        // Query accepted tasks even when AutoPublish has since been switched off.
        var pending = await repository.PendingWeChatPublicationsAsync(appId);
        foreach (var job in pending)
        {
            cancellation.ThrowIfCancellationRequested();
            var account = await accountSettings.LoadAsync();
            if (!account.Enabled || account.AppId != appId || WeChatSettingsService.Errors(account).Length != 0) return;
            if (job.Status == "queued")
            {
                var draft = await repository.FindAsync<WeChatDraft>(job.Id);
                var content = draft == null ? null : await repository.FindAsync<Content>(draft.ContentId);
                if (!account.AutoPublish || content is not { Published: true, DeletedAt: null } || draft?.Status == "cancelled")
                {
                    job.Status = "cancelled"; job.Error = "自动发布已关闭或网站文章已下架，未提交微信发布；已创建草稿可在微信后台处理。";
                    await SavePublicationAsync(job); continue;
                }
                if (draft is not { Status: "draft" } || draft.MediaId == "") continue;
                job.Status = "submitting"; job.Error = "";
                await SavePublicationAsync(job);
                try
                {
                    var response = await client.PostAsync("freepublish/submit", new { media_id = draft.MediaId }, account, cancellation);
                    var id = WeChatClient.Required(response, "publish_id", "freepublish/submit");
                    if (id.Length > 128) throw new HttpRequestException("Invalid publication identifier.");
                    job.PublishId = id; job.Status = "publishing";
                }
                catch (CmsException error)
                {
                    job.Status = "failed"; job.Error = error.Message;
                    LogFailure(job.Id, draft.ContentId, "提交微信发布", "", error, job.Error);
                }
                catch (Exception error) when (!cancellation.IsCancellationRequested)
                {
                    job.Status = "unknown";
                    job.Error = "发布提交结果未知，请在微信后台核实；系统不会自动重发。" + Failure("提交微信发布", error);
                    LogFailure(job.Id, draft.ContentId, "提交微信发布", "", error, job.Error);
                }
                // A confirmed task must be durable before polling; a failed database write must not trigger another submission.
                await SavePublicationAsync(job);
                continue;
            }
            try
            {
                var response = await client.PostAsync("freepublish/get", new { publish_id = job.PublishId }, account, cancellation);
                if (!response.TryGetProperty("publish_status", out var value) || !value.TryGetInt32(out var status) || status is < 0 or > 6)
                    throw new HttpRequestException("Invalid publication status.");
                job.PublishStatus = status;
                job.Status = status == 0 ? "published" : status == 1 ? "publishing" : "failed";
                job.Error = status switch
                {
                    2 => "原创声明未通过，请在微信后台处理。", 3 => "微信发布失败，请在微信后台检查草稿。",
                    4 => "平台审核未通过，请在微信后台处理。", 5 => "发布后文章已被删除。",
                    6 => "发布后文章已被平台封禁。", _ => ""
                };
                // Deliberately retain only status; article_id, article_detail and article URLs are not stored.
            }
            catch (CmsException error)
            {
                job.Error = "状态查询失败，将继续查询：" + error.Message;
                LogFailure(job.Id, "", "查询微信发布状态", "", error, job.Error);
            }
            catch (Exception error) when (!cancellation.IsCancellationRequested)
            {
                job.Error = "将继续查询，不会重复提交发布。" + Failure("查询微信发布状态", error);
                LogFailure(job.Id, "", "查询微信发布状态", "", error, job.Error);
            }
            await SavePublicationAsync(job);
        }
    }

    private Task<int> SavePublicationAsync(WeChatPublication job)
    {
        job.UpdatedAt = DateTime.UtcNow;
        return repository.RecordTrafficAsync(repo => repo.UpdateAsync(job));
    }

    private static string Failure(string step, Exception error) => error is WeChatRequestException safe
        ? safe.Message : $"{step}失败：{WeChatClient.Diagnostic(error)}";

    private void LogFailure(string jobId, string contentId, string step, string assetId, Exception error, string detail) =>
        // Do not pass the exception object: HTTP exception messages can contain access_token query strings.
        logger?.LogWarning("WeChat operation failed. JobId={JobId} ContentId={ContentId} Step={Step} AssetId={AssetId} ExceptionType={ExceptionType} Detail={Detail} Stack={Stack}",
            jobId, contentId, error is WeChatRequestException safe ? WeChatClient.Step(safe.Endpoint) : step,
            assetId, error.GetType().Name, detail, error.StackTrace);

    private async Task<FileView> ImageAsync(string id, bool cover)
    {
        var file = await assets.ReadAsync(id, true);
        var size = new FileInfo(file.Path).Length;
        if (file.ContentType is not ("image/jpeg" or "image/png") || size <= 0 || size >= (cover ? 10_000_000 : 1_000_000))
            throw Bad(cover ? "封面请使用小于 10 MB 的 JPG 或 PNG 图片。" : "正文图片请使用小于 1 MB 的 JPG 或 PNG 图片。");
        return file;
    }

    /// <summary>Validate WeChat-specific limits without truncating editorial content.</summary>
    public static void Validate(WeChatArticle article)
    {
        if (string.IsNullOrWhiteSpace(article.Title) || article.Title.EnumerateRunes().Count() > 32) throw Bad("公众号标题须为 1–32 字，请调整网站文章标题后重新发布。");
        if (article.Digest.EnumerateRunes().Count() > 120) throw Bad("公众号摘要不能超过 120 字，请调整后重新发布。");
        if (article.Author.EnumerateRunes().Count() > 16) throw Bad("公众号作者不能超过 16 字。");
        if (Encoding.UTF8.GetByteCount(article.SourceUrl) >= 1024) throw Bad("原文地址过长，请检查站点地址配置。");
        if (!Regex.IsMatch(article.CoverId, "^[a-f0-9]{32}$")) throw Bad("公众号图文需要封面，请选择封面后重新发布。");
        var document = new HtmlParser().ParseDocument(article.Html);
        if (document.QuerySelector("video,audio,iframe") != null) throw Bad("当前公众号同步仅支持图文，请移除音视频和嵌入网页后重新发布。");
        if (document.QuerySelectorAll("img").Any(x => !Regex.IsMatch(x.GetAttribute("src") ?? "", "^/media/[a-f0-9]{32}$")))
            throw Bad("正文图片必须来自 CMS 附件库。");
        if (article.Html.Length >= 20000 || Encoding.UTF8.GetByteCount(article.Html) >= 1_000_000) throw Bad("公众号正文过长，请缩短文章。");
        if (document.Body!.TextContent.Trim() == "" && document.QuerySelector("img") == null) throw Bad("公众号正文不能为空。");
    }

    private Task<int> SaveAsync(WeChatDraft job)
    {
        job.UpdatedAt = DateTime.UtcNow;
        return repository.RecordTrafficAsync(repo => repo.UpdateAsync(job));
    }
    private async Task<WeChatOptions> RequireReadyAsync(CmsRepository repo)
    {
        var options = await accountSettings.LoadAsync(repo);
        if (!options.Enabled || WeChatSettingsService.Errors(options).Length > 0) throw Bad("公众号同步尚未启用或配置不完整。");
        return options;
    }
    private static async Task<WeChatDraftView> ViewAsync(WeChatDraft row, CmsRepository repo)
    {
        var publication = await repo.FindAsync<WeChatPublication>(row.Id);
        return new(row.Id, row.Status, row.MediaId, row.Error,
            publication != null && publication.UpdatedAt > row.UpdatedAt ? publication.UpdatedAt : row.UpdatedAt,
            publication?.Status ?? "", publication?.PublishId ?? "", publication?.Error ?? "",
            row.Status == "draft" && publication is { Status: "failed", PublishId: "" });
    }
    private static CmsException Bad(string message) => new(400, "WECHAT_INVALID", message);
}
