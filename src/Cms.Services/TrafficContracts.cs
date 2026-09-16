using Cms.Data;

namespace Cms.Services;

/// <summary>Visible browser navigation with a client-generated retry identifier.</summary>
public record VisitInput(string Id, string Path, string Referrer = "", string Campaign = "");
/// <summary>Absolute, monotonic reading observations for one page lifecycle.</summary>
public record ReadingInput(int ActiveSeconds, int Depth);
/// <summary>One user-initiated action with a retry identifier.</summary>
public record VisitEventInput(string Id, string Kind, string TargetId = "");
/// <summary>Accepted visit identifier; empty means intentionally excluded from telemetry.</summary>
public record VisitReceipt(string Id);
/// <summary>Accepted navigation and current public article count.</summary>
public record PageVisitReceipt(string Id, long Views);
/// <summary>Customer-supplied inquiry; contact data never appears in its receipt.</summary>
public record LeadInput(string Id, string Path, string Name, string Contact, string Organization, string Need,
    bool Consent, string VisitId = "", string Referrer = "", string Campaign = "", string Website = "");
/// <summary>Private follow-up changes with optimistic concurrency.</summary>
public record LeadUpdateInput(string Status, string Notes, int Version);
/// <summary>Daily traffic and successful inquiries.</summary>
public record TrafficDay(string Day, long Views, long Visitors, long Leads);
/// <summary>Period and lifetime metrics plus database-aggregated chart series.</summary>
public record TrafficReport(DateTime Start, DateTime End, TrafficTotals Today, TrafficTotals Period,
    long TotalViews, long TotalVisitors, long TodayLeads, long PeriodLeads, long DownloadClicks,
    long ConsultationClicks, IReadOnlyList<TrafficDay> Days, IReadOnlyList<TrafficBucket> Sources,
    IReadOnlyList<TrafficBucket> Devices, IReadOnlyList<PopularContent> Popular);
