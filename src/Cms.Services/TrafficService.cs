using System.Globalization;
using System.Text.RegularExpressions;
using Cms.Data;

namespace Cms.Services;

/// <summary>Public telemetry and private customer inquiries through the repository boundary.</summary>
public sealed class TrafficService(CmsRepository repository)
{
    /// <summary>Calendar boundary used consistently by all public and administrative traffic counts.</summary>
    public static DateTime TodayUtc() => DateTime.UtcNow.AddHours(8).Date.AddHours(-8);

    /// <summary>Record a visible navigation once, excluding known crawlers and authenticated staff.</summary>
    public async Task<PageVisitReceipt> VisitAsync(string visitor, VisitInput input, string userAgent, string host, bool staff)
    {
        Id(input.Id);
        Text(input.Path, 500, true);
        Text(input.Referrer, 2048);
        Text(input.Campaign, 100);
        if (staff || string.IsNullOrWhiteSpace(userAgent) || Regex.IsMatch(userAgent, "bot|spider|crawler|curl|wget", RegexOptions.IgnoreCase))
            return new PageVisitReceipt("", 0);
        return await repository.RecordTrafficAsync(async repo =>
        {
            var prior = await repo.FindAsync<PageVisit>(input.Id);
            if (prior != null)
            {
                if (prior.VisitorId != visitor || prior.Path != input.Path) throw Conflict();
                return new PageVisitReceipt(prior.Id, (await repo.FindAsync<ContentTraffic>(prior.ContentId))?.Views ?? 0);
            }
            var page = await ResolvePageAsync(repo, input.Path);
            var now = DateTime.UtcNow;
            if (await repo.CountAsync<PageVisit>(x => x.VisitorId == visitor && x.CreatedAt >= now.AddMinutes(-1)) >= 30)
                throw new CmsException(429, "RATE_LIMITED", "访问过于频繁，请稍后重试。", 60);
            var source = Source(input.Referrer, input.Campaign, host);
            var device = Regex.IsMatch(userAgent, "iPad|Tablet", RegexOptions.IgnoreCase) ? "平板" :
                Regex.IsMatch(userAgent, "Mobile|Android|iPhone", RegexOptions.IgnoreCase) ? "手机" : "电脑";
            var profile = await repo.FindAsync<VisitorProfile>(visitor);
            var fresh = profile == null;
            profile ??= new VisitorProfile { Id = visitor, Source = source, CreatedAt = now };
            profile.Views++;
            profile.LastSeenAt = now;
            profile.Device = device;
            if (fresh) await repo.InsertAsync(profile); else await repo.UpdateAsync(profile);
            await repo.InsertAsync(new PageVisit
            {
                Id = input.Id, VisitorId = visitor, ContentId = page.Id, Path = input.Path, Title = page.Title,
                CreatedAt = now, Day = now.AddHours(8).ToString("yyyy-MM-dd", CultureInfo.InvariantCulture),
                Source = source, Device = device
            });
            long views = 0;
            if (page.Id != "")
            {
                var counter = await repo.FindAsync<ContentTraffic>(page.Id);
                if (counter == null) await repo.InsertAsync(new ContentTraffic { Id = page.Id, Views = 1 });
                else { counter.Views++; await repo.UpdateAsync(counter); }
                views = counter?.Views ?? 1;
            }
            return new PageVisitReceipt(input.Id, views);
        });
    }

    /// <summary>Apply cumulative reading samples monotonically, so retries and late arrivals cannot inflate them.</summary>
    public Task<bool> ReadingAsync(string visitor, string id, ReadingInput input)
    {
        Id(id);
        if (input.ActiveSeconds is < 0 or > 14400 || input.Depth is < 0 or > 100) throw Invalid();
        return repository.RecordTrafficAsync(async repo =>
        {
            var row = await OwnedVisitAsync(repo, visitor, id);
            var elapsed = (int)Math.Clamp((DateTime.UtcNow - row.CreatedAt).TotalSeconds, 0, 14400);
            row.ActiveSeconds = Math.Max(row.ActiveSeconds, Math.Min(input.ActiveSeconds, elapsed));
            row.Depth = row.ContentId == "" ? 0 : Math.Max(row.Depth, input.Depth);
            await repo.UpdateAsync(row);
            return true;
        });
    }

    /// <summary>Record a deduplicated user click on consultation or an existing attachment.</summary>
    public Task<bool> EventAsync(string visitor, string visitId, VisitEventInput input)
    {
        Id(visitId); Id(input.Id);
        if (input.Kind is not ("download" or "consultation")) throw Invalid();
        if (input.Kind == "download") Id(input.TargetId);
        else if (input.TargetId != "") throw Invalid();
        return repository.RecordTrafficAsync(async repo =>
        {
            await OwnedVisitAsync(repo, visitor, visitId);
            var prior = await repo.FindAsync<VisitEvent>(input.Id);
            if (prior != null)
            {
                if (prior.VisitId != visitId || prior.Kind != input.Kind || prior.TargetId != input.TargetId) throw Conflict();
                return true;
            }
            if (input.Kind == "download" && (await repo.FindAsync<Asset>(input.TargetId) == null ||
                await repo.CountAsync<Content>(x => x.Published && x.PublishedJson.Contains("/media/" + input.TargetId)) == 0)) throw Missing();
            await repo.InsertAsync(new VisitEvent { Id = input.Id, VisitId = visitId, Kind = input.Kind, TargetId = input.TargetId });
            return true;
        });
    }

    /// <summary>Accept a private inquiry once and return only a non-sensitive receipt.</summary>
    public Task<VisitReceipt> SubmitLeadAsync(string visitor, LeadInput input, string host)
    {
        Id(input.Id);
        Text(input.Path, 500, true); Text(input.Name, 60, true); Text(input.Contact, 160, true);
        Text(input.Organization, 200); Text(input.Need, 2000, true); Text(input.Referrer, 2048); Text(input.Campaign, 100);
        if (!input.Consent || input.Website != "") throw Invalid();
        if (input.VisitId != "") Id(input.VisitId);
        return repository.WriteAsync("visitor", "lead.submit", async repo =>
        {
            var prior = await repo.FindAsync<CustomerLead>(input.Id);
            if (prior != null)
            {
                if (prior.VisitorId != visitor || prior.Name != input.Name.Trim() || prior.Contact != input.Contact.Trim() ||
                    prior.Need != input.Need.Trim() || prior.Organization != input.Organization.Trim() || prior.Path != input.Path)
                    throw Conflict();
                repo.SetAuditTarget("lead", prior.Id, "客户咨询");
                return new VisitReceipt(prior.Id);
            }
            var page = await ResolvePageAsync(repo, input.Path);
            var visit = input.VisitId == "" ? null : await OwnedVisitAsync(repo, visitor, input.VisitId);
            if (visit != null && visit.Path != input.Path) throw Invalid();
            var now = DateTime.UtcNow;
            if (await repo.CountAsync<CustomerLead>(x => x.VisitorId == visitor && x.CreatedAt >= now.AddHours(-1)) >= 5)
                throw new CmsException(429, "RATE_LIMITED", "咨询提交过于频繁，请稍后再试。", 3600);
            var row = new CustomerLead
            {
                Id = input.Id, VisitorId = visitor, VisitId = input.VisitId, ContentId = page.Id, Path = input.Path,
                Source = visit?.Source ?? Source(input.Referrer, input.Campaign, host), Name = input.Name.Trim(),
                Contact = input.Contact.Trim(), Organization = input.Organization.Trim(), Need = input.Need.Trim(),
                CreatedAt = now, ConsentedAt = now, UpdatedAt = now
            };
            repo.SetAuditTarget("lead", row.Id, "客户咨询");
            await repo.InsertAsync(row);
            return new VisitReceipt(row.Id);
        });
    }

    /// <summary>Return private inquiries filtered by state or supplied contact information.</summary>
    public Task<PageResult<CustomerLead>> LeadsAsync(string status, string query, int page)
    {
        Status(status, true); Text(query, 200);
        return repository.LeadsAsync(status, query.Trim(), page);
    }

    /// <summary>Update follow-up status and notes with an audit and revision check.</summary>
    public Task<CustomerLead> UpdateLeadAsync(string actor, string id, LeadUpdateInput input)
    {
        Id(id); Status(input.Status); Text(input.Notes, 4000);
        return repository.WriteAsync(actor, "lead.followup", async repo =>
        {
            var row = await repo.FindAsync<CustomerLead>(id) ?? throw Missing();
            row.Status = input.Status; row.Notes = input.Notes.Trim();
            repo.SetAuditTarget("lead", row.Id, "客户咨询");
            await repo.SaveLeadAsync(row, input.Version);
            return row;
        });
    }

    /// <summary>Delete private contact information at an expected revision.</summary>
    public Task<bool> DeleteLeadAsync(string actor, string id, int version) => repository.WriteAsync(actor, "lead.delete", async repo =>
    {
        var row = await repo.FindAsync<CustomerLead>(id) ?? throw Missing();
        if (row.Version != version) throw Conflict();
        repo.SetAuditTarget("lead", row.Id, "客户咨询");
        await repo.DeleteAsync<CustomerLead>(id);
        return true;
    });

    /// <summary>List pseudonymous visitors by latest accepted navigation.</summary>
    public Task<PageResult<VisitorProfile>> VisitorsAsync(int page) =>
        repository.PageAsync<VisitorProfile>(x => true, page, 20, x => x.LastSeenAt);

    /// <summary>Page a browser's navigation history without exposing customer contacts.</summary>
    public Task<PageResult<PageVisit>> VisitorHistoryAsync(string id, int page)
    {
        Id(id);
        return repository.PageAsync<PageVisit>(x => x.VisitorId == id, page, 20);
    }

    /// <summary>Build consistent Shanghai-day traffic and inquiry summaries for at most ninety days.</summary>
    public async Task<TrafficReport> ReportAsync(string? from, string? to)
    {
        var today = TodayUtc();
        var start = from == null ? today.AddDays(-6) : Day(from);
        var end = to == null ? today.AddDays(1) : Day(to).AddDays(1);
        if (end <= start || (end - start).TotalDays > 90 || end > today.AddDays(1)) throw Invalid();
        var daily = (await repository.TrafficBucketsAsync(start, end, x => x.Day)).ToDictionary(x => x.Name);
        var leads = (await repository.LeadDaysAsync(start, end))
            .ToDictionary(x => x.Day.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture));
        var days = Enumerable.Range(0, (int)(end - start).TotalDays).Select(i =>
        {
            var name = start.AddDays(i).AddHours(8).ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);
            return new TrafficDay(name, daily.GetValueOrDefault(name)?.Views ?? 0,
                daily.GetValueOrDefault(name)?.Visitors ?? 0, leads.GetValueOrDefault(name)?.Leads ?? 0);
        }).ToList();
        return new TrafficReport(start, end, await repository.TrafficTotalsAsync(today, today.AddDays(1)),
            await repository.TrafficTotalsAsync(start, end), await repository.CountAsync<PageVisit>(),
            await repository.CountAsync<VisitorProfile>(), await repository.CountAsync<CustomerLead>(x => x.CreatedAt >= today),
            await repository.CountAsync<CustomerLead>(x => x.CreatedAt >= start && x.CreatedAt < end),
            await repository.CountAsync<VisitEvent>(x => x.CreatedAt >= start && x.CreatedAt < end && x.Kind == "download"),
            await repository.CountAsync<VisitEvent>(x => x.CreatedAt >= start && x.CreatedAt < end && x.Kind == "consultation"),
            days, await repository.TrafficBucketsAsync(start, end, x => x.Source),
            await repository.TrafficBucketsAsync(start, end, x => x.Device), await repository.PopularContentsAsync(start, end));
    }

    private static async Task<PageVisit> OwnedVisitAsync(CmsRepository repo, string visitor, string id)
    {
        var row = await repo.FindAsync<PageVisit>(id);
        if (row == null || row.VisitorId != visitor) throw Missing();
        return row;
    }

    private static async Task<(string Id, string Title)> ResolvePageAsync(CmsRepository repo, string path)
    {
        if (path is "/" or "/search") return ("", path == "/" ? "首页" : "站内搜索");
        var match = Regex.Match(path, "^/(posts|pages|category|tag)/([^/?#]+)$");
        if (!match.Success) throw Missing();
        var kind = match.Groups[1].Value;
        var slug = Uri.UnescapeDataString(match.Groups[2].Value);
        if (kind is "category" or "tag")
        {
            var taxonomy = await repo.FirstAsync<Taxonomy>(x => x.Kind == kind && x.Slug == slug) ?? throw Missing();
            return ("", taxonomy.Name);
        }
        var contentKind = kind == "posts" ? "post" : "page";
        var row = await repo.FirstAsync<Content>(x => x.Kind == contentKind && x.Slug == slug && x.Published) ?? throw Missing();
        return (row.Id, row.PublishedTitle);
    }

    private static string Source(string referrer, string campaign, string host)
    {
        if (!string.IsNullOrWhiteSpace(campaign)) return "推广：" + campaign.Trim();
        if (!Uri.TryCreate(referrer, UriKind.Absolute, out var uri) || uri.Scheme is not ("http" or "https")) return "直接 / 未知";
        if (uri.Host.Equals(host, StringComparison.OrdinalIgnoreCase)) return "站内";
        return uri.Host.Length <= 160 ? uri.Host : "其他来源";
    }
    private static DateTime Day(string value)
    {
        if (!DateTime.TryParseExact(value, "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out var day) ||
            day == DateTime.MinValue.Date || day == DateTime.MaxValue.Date) throw Invalid();
        return DateTime.SpecifyKind(day.AddHours(-8), DateTimeKind.Utc);
    }
    private static void Id(string value) { if (value == null || !Regex.IsMatch(value, "^[a-f0-9]{32}$")) throw Invalid(); }
    private static void Text(string value, int max, bool required = false)
    {
        if (value == null || value.Length > max || (required && string.IsNullOrWhiteSpace(value)) || value.Any(c => char.IsControl(c) && c is not ('\r' or '\n' or '\t')))
            throw Invalid();
    }
    private static void Status(string value, bool empty = false)
    {
        if (value is not ("new" or "following" or "completed" or "invalid") && !(empty && value == "")) throw Invalid();
    }
    private static CmsException Invalid() => new(400, "INVALID_INPUT", "请检查输入内容、日期范围和联系授权。");
    private static CmsException Missing() => new(404, "NOT_FOUND", "记录不存在或内容尚未发布。");
    private static CmsException Conflict() => new(409, "VERSION_CONFLICT", "记录已更新或请求编号已被使用，请刷新后重试。");
}
