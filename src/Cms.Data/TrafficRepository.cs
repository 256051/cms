using System.Linq.Expressions;
using FreeSql;

namespace Cms.Data;

public sealed partial class CmsRepository
{
    /// <summary>Serialize telemetry changes without writing one administrative audit per page view.</summary>
    public Task<T> RecordTrafficAsync<T>(Func<CmsRepository, Task<T>> work) => TransactionAsync(work);

    /// <summary>Return database-side period counts without loading raw visits.</summary>
    public Task<TrafficTotals> TrafficTotalsAsync(DateTime start, DateTime end) => db.Select<PageVisit>()
        .Where(x => x.CreatedAt >= start && x.CreatedAt < end)
        .ToAggregateAsync(a => new TrafficTotals(a.Count(), SqlExt.DistinctCount(a.Key.VisitorId),
            (long)a.Sum((long)a.Key.ActiveSeconds), (long)a.Sum((long)a.Key.Depth)));

    /// <summary>Aggregate visits by one bounded dimension.</summary>
    public Task<List<TrafficBucket>> TrafficBucketsAsync(DateTime start, DateTime end,
        Expression<Func<PageVisit, string>> dimension) => db.Select<PageVisit>()
        .Where(x => x.CreatedAt >= start && x.CreatedAt < end).GroupBy(dimension)
        .OrderByDescending(a => a.Count()).Limit(100)
        .ToListAsync(a => new TrafficBucket(a.Key, a.Count(), SqlExt.DistinctCount(a.Value.VisitorId)));

    /// <summary>Rank articles and standalone content by accepted views in the selected period.</summary>
    public Task<List<PopularContent>> PopularContentsAsync(DateTime start, DateTime end) => db.Select<PageVisit>()
        .Where(x => x.CreatedAt >= start && x.CreatedAt < end && x.ContentId != "")
        .GroupBy(x => new { x.ContentId, x.Path }).OrderByDescending(a => a.Count()).Limit(20)
        .ToListAsync(a => new PopularContent(a.Key.ContentId, a.Key.Path, a.Max(a.Value.Title), a.Count(),
            SqlExt.DistinctCount(a.Value.VisitorId), (long)a.Sum((long)a.Value.ActiveSeconds), (long)a.Sum((long)a.Value.Depth)));

    /// <summary>Aggregate lifetime and today's article counts for only the requested page of content.</summary>
    public async Task<List<ContentMetrics>> ContentMetricsAsync(string[] ids, DateTime today)
    {
        var counters = await ListAsync<ContentTraffic>(x => ids.Contains(x.Id));
        var daily = await db.Select<PageVisit>().Where(x => ids.Contains(x.ContentId) && x.CreatedAt >= today)
            .GroupBy(x => x.ContentId).ToListAsync(a => new { Id = a.Key, Count = a.Count() });
        var audience = await db.Select<ContentAudience>().Where(x => ids.Contains(x.ContentId)).GroupBy(x => x.ContentId)
            .ToListAsync(a => new { Id = a.Key, Count = a.Count() });
        return counters.Select(x => new ContentMetrics(x.Id, x.Views, daily.FirstOrDefault(d => d.Id == x.Id)?.Count ?? 0,
            audience.FirstOrDefault(d => d.Id == x.Id)?.Count ?? 0)).ToList();
    }

    /// <summary>Sort the editorial list by independently stored lifetime counters, including unread drafts.</summary>
    public async Task<PageResult<Content>> ContentByViewsAsync(string kind, string query, int page, int size,
        string status = "", string category = "", string tag = "")
    {
        page = Math.Max(1, page);
        size = Math.Clamp(size, 1, 100);
        var rows = db.Select<Content, ContentTraffic>().LeftJoin((c, t) => c.Id == t.Id)
            .Where((c, t) => c.Kind == kind && (query == "" || c.Title.Contains(query) || c.Summary.Contains(query)) &&
                (status == "trash" ? c.DeletedAt != null : c.DeletedAt == null) &&
                (status != "draft" || !c.Published) && (status != "published" || c.Published) &&
                (category == "" || c.CategoryId == category) && (tag == "" || c.TagIds.Contains(tag)));
        var total = await rows.CountAsync();
        var items = await rows.OrderByDescending((c, t) => (long?)t.Views ?? 0).OrderBy((c, t) => c.Id)
            .Page(page, size).ToListAsync((c, t) => c);
        return new PageResult<Content>(items, total, page, size);
    }

    /// <summary>Group successful inquiries by Shanghai calendar date.</summary>
    public Task<List<LeadDayTotals>> LeadDaysAsync(DateTime start, DateTime end) => db.Select<CustomerLead>()
        .Where(x => x.CreatedAt >= start && x.CreatedAt < end).GroupBy(x => x.CreatedAt.AddHours(8).Date)
        .ToListAsync(a => new LeadDayTotals(a.Key, a.Count()));

    /// <summary>Page private inquiries using a bounded query and optional state.</summary>
    public Task<PageResult<CustomerLead>> LeadsAsync(string status, string query, int page, string owner = "", bool overdue = false) =>
        PageAsync<CustomerLead>(x => (status == "" || x.Status == status) &&
            (query == "" || x.Name.Contains(query) || x.Contact.Contains(query) || x.Organization.Contains(query)) &&
            (owner == "" || x.OwnerId == owner) && (!overdue || (x.NextContactAt < DateTime.UtcNow && x.Status != "completed" && x.Status != "invalid")), page, 20);

    /// <summary>Update follow-up data only at the expected revision.</summary>
    public async Task SaveLeadAsync(CustomerLead lead, int expected)
    {
        lead.Version = checked(expected + 1);
        lead.UpdatedAt = DateTime.UtcNow;
        if (await db.Update<CustomerLead>().SetSource(lead).Where(x => x.Version == expected).ExecuteAffrowsAsync() != 1)
            throw new CmsException(409, "VERSION_CONFLICT", "咨询已被其他管理员修改，请重新加载。");
    }
}
