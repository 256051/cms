using FreeSql.DataAnnotations;

namespace Cms.Data;

/// <summary>First-party browser profile and latest observed network; administrator access only.</summary>
[Table(Name = "cms_visitors")]
[Index("ix_visitor_seen", nameof(LastSeenAt), false)]
public class VisitorProfile : Entity
{
    /// <summary>Most recent accepted page visit in UTC.</summary>
    public DateTime LastSeenAt { get; set; }
    /// <summary>Accepted page views.</summary>
    public long Views { get; set; }
    /// <summary>First observed acquisition channel.</summary>
    [Column(StringLength = 160)]
    public string Source { get; set; } = "";
    /// <summary>Most recent coarse device category.</summary>
    [Column(StringLength = 16)]
    public string Device { get; set; } = "";
    /// <summary>Normalized IP of the most recent accepted visit; empty for historical records.</summary>
    [Column(StringLength = 45)]
    public string IpAddress { get; set; } = "";
    /// <summary>Approximate country, province and city, or a local/unknown address label.</summary>
    [Column(StringLength = 200)]
    public string Location { get; set; } = "";
}

/// <summary>One visible page lifecycle; its primary key also deduplicates retries.</summary>
[Table(Name = "cms_page_visits")]
[Index("ix_visit_time", nameof(CreatedAt), false)]
[Index("ix_visit_content_time", "ContentId,CreatedAt", false)]
[Index("ix_visit_visitor_time", "VisitorId,CreatedAt", false)]
public class PageVisit : Entity
{
    /// <summary>Server-issued browser identity.</summary>
    [Column(StringLength = 32)]
    public string VisitorId { get; set; } = "";
    /// <summary>Published content identity, empty for listing pages.</summary>
    [Column(StringLength = 32)]
    public string ContentId { get; set; } = "";
    /// <summary>Canonical local page path without query strings.</summary>
    [Column(StringLength = 500)]
    public string Path { get; set; } = "";
    /// <summary>Public title when the visit was accepted.</summary>
    [Column(StringLength = 200)]
    public string Title { get; set; } = "";
    /// <summary>Calendar day in Asia/Shanghai.</summary>
    [Column(StringLength = 10)]
    public string Day { get; set; } = "";
    /// <summary>Campaign label or external referring hostname, never the full referring URL.</summary>
    [Column(StringLength = 160)]
    public string Source { get; set; } = "";
    /// <summary>Coarse device category.</summary>
    [Column(StringLength = 16)]
    public string Device { get; set; } = "";
    /// <summary>Normalized server-observed IP at the time of this visit; empty for historical records.</summary>
    [Column(StringLength = 45)]
    public string IpAddress { get; set; } = "";
    /// <summary>Approximate region resolved when the visit was recorded; never backfilled from a later visit.</summary>
    [Column(StringLength = 200)]
    public string Location { get; set; } = "";
    /// <summary>Cumulative visible seconds, bounded by elapsed server time and four hours.</summary>
    public int ActiveSeconds { get; set; }
    /// <summary>Maximum visible article depth, between zero and one hundred.</summary>
    public int Depth { get; set; }
}

/// <summary>Lifetime article counter independent of editorial versions and snapshots.</summary>
[Table(Name = "cms_content_traffic")]
public class ContentTraffic : Entity
{
    /// <summary>Accepted page views of this content.</summary>
    public long Views { get; set; }
}

/// <summary>Deduplicated download or consultation click attributed to an owned visit.</summary>
[Table(Name = "cms_visit_events")]
[Index("ix_event_time", nameof(CreatedAt), false)]
[Index("ix_event_visit", nameof(VisitId), false)]
public class VisitEvent : Entity
{
    /// <summary>Parent page view.</summary>
    [Column(StringLength = 32)]
    public string VisitId { get; set; } = "";
    /// <summary>download or consultation.</summary>
    [Column(StringLength = 16)]
    public string Kind { get; set; } = "";
    /// <summary>Attachment identity for download clicks.</summary>
    [Column(StringLength = 32)]
    public string TargetId { get; set; } = "";
}

/// <summary>Private customer inquiry with optimistic follow-up state.</summary>
[Table(Name = "cms_customer_leads")]
[Index("ix_lead_time", nameof(CreatedAt), false)]
[Index("ix_lead_status", "Status,CreatedAt", false)]
public class CustomerLead : Entity
{
    /// <summary>Submitted additional fields with their labels at submission time.</summary>
    [Column(StringLength = -2)] public string FieldsJson { get; set; } = "[]";
    /// <summary>Assigned enabled administrator.</summary>
    [Column(StringLength = 32)]
    public string OwnerId { get; set; } = "";
    /// <summary>Next planned contact, in UTC.</summary>
    public DateTime? NextContactAt { get; set; }
    /// <summary>Browser identity for retry ownership; not a verified person.</summary>
    [Column(StringLength = 32)]
    public string VisitorId { get; set; } = "";
    /// <summary>Optional originating view.</summary>
    [Column(StringLength = 32)]
    public string VisitId { get; set; } = "";
    /// <summary>Originating content, when submitted from an article or page.</summary>
    [Column(StringLength = 32)]
    public string ContentId { get; set; } = "";
    /// <summary>Originating public path.</summary>
    [Column(StringLength = 500)]
    public string Path { get; set; } = "";
    /// <summary>Acquisition channel.</summary>
    [Column(StringLength = 160)]
    public string Source { get; set; } = "";
    /// <summary>Customer-provided name.</summary>
    [Column(StringLength = 60)]
    public string Name { get; set; } = "";
    /// <summary>Phone, email or WeChat handle provided for a reply.</summary>
    [Column(StringLength = 160)]
    public string Contact { get; set; } = "";
    /// <summary>Optional company or school.</summary>
    [Column(StringLength = 200)]
    public string Organization { get; set; } = "";
    /// <summary>Requested assistance.</summary>
    [Column(StringLength = 2000)]
    public string Need { get; set; } = "";
    /// <summary>new, following, completed or invalid.</summary>
    [Column(StringLength = 16)]
    public string Status { get; set; } = "new";
    /// <summary>Private follow-up notes.</summary>
    [Column(StringLength = 4000)]
    public string Notes { get; set; } = "";
    /// <summary>Customer agreed to use the provided details for this inquiry.</summary>
    public DateTime ConsentedAt { get; set; }
    /// <summary>Last follow-up edit.</summary>
    public DateTime UpdatedAt { get; set; }
    /// <summary>Prevents concurrent follow-up overwrites.</summary>
    public int Version { get; set; }
}

/// <summary>Database aggregate of page counts and cumulative reading samples.</summary>
public record TrafficTotals(long Views, long Visitors, long ActiveSeconds, long DepthSum);
/// <summary>Counts for one dimension or calendar day.</summary>
public record TrafficBucket(string Name, long Views, long Visitors);
/// <summary>Popular article with period reading metrics.</summary>
public record PopularContent(string ContentId, string Path, string Title, long Views, long Visitors, long ActiveSeconds, long DepthSum);
/// <summary>Totals for one article shown in the editorial list.</summary>
public record ContentMetrics(string ContentId, long Views, long TodayViews, long Visitors);
/// <summary>Database-side daily inquiry count before presentation formatting.</summary>
public record LeadDayTotals(DateTime Day, long Leads);
