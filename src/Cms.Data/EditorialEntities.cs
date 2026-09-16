using FreeSql.DataAnnotations;

namespace Cms.Data;

/// <summary>An old public address resolves directly to its content, avoiding redirect chains and cycles.</summary>
[Table(Name = "cms_content_redirects")]
[Index("ux_redirect_slug", "Slug", true)]
public class ContentRedirect : Entity
{
    /// <summary>Previously published address.</summary>
    [Column(StringLength = 160)] public string Slug { get; set; } = "";
    /// <summary>Destination identity; the current public address is looked up at request time.</summary>
    [Column(StringLength = 32)] public string ContentId { get; set; } = "";
}

/// <summary>Immutable editorial version retained until its content is permanently removed.</summary>
[Table(Name = "cms_content_revisions")]
[Index("ix_revision_content", "ContentId,CreatedAt", false)]
public class ContentRevision : Entity
{
    /// <summary>Parent content identifier.</summary>
    [Column(StringLength = 32)] public string ContentId { get; set; } = "";
    /// <summary>Saved content version.</summary>
    public int Version { get; set; }
    /// <summary>Save or publication action.</summary>
    [Column(StringLength = 32)] public string Action { get; set; } = "";
    /// <summary>Account or scheduler identity.</summary>
    [Column(StringLength = 100)] public string Actor { get; set; } = "";
    /// <summary>Title at this revision.</summary>
    [Column(StringLength = 200)] public string Title { get; set; } = "";
    /// <summary>Complete sanitized snapshot including attachment references.</summary>
    [Column(StringLength = -2)] public string SnapshotJson { get; set; } = "";
}

/// <summary>Append-only private inquiry follow-up.</summary>
[Table(Name = "cms_lead_followups")]
[Index("ix_followup_lead", "LeadId,CreatedAt", false)]
public class LeadFollowUp : Entity
{
    /// <summary>Parent inquiry.</summary>
    [Column(StringLength = 32)] public string LeadId { get; set; } = "";
    /// <summary>Operator display name.</summary>
    [Column(StringLength = 100)] public string Actor { get; set; } = "";
    /// <summary>State at this follow-up.</summary>
    [Column(StringLength = 16)] public string Status { get; set; } = "";
    /// <summary>Recorded notes.</summary>
    [Column(StringLength = 4000)] public string Notes { get; set; } = "";
    /// <summary>Assigned administrator.</summary>
    [Column(StringLength = 32)] public string OwnerId { get; set; } = "";
    /// <summary>Planned next contact.</summary>
    public DateTime? NextContactAt { get; set; }
}

/// <summary>Backup attempts and retention boundary for the administration panel.</summary>
[Table(Name = "cms_maintenance")]
public class MaintenanceState : Entity
{
    /// <summary>Last backup attempt.</summary>
    public DateTime? LastAttemptAt { get; set; }
    /// <summary>Last fully written archive.</summary>
    public DateTime? LastSuccessAt { get; set; }
    /// <summary>Failure summary without secrets.</summary>
    [Column(StringLength = 500)] public string Error { get; set; } = "";
    /// <summary>Archive basename.</summary>
    [Column(StringLength = 100)] public string FileName { get; set; } = "";
    /// <summary>Oldest retained traffic detail time.</summary>
    public DateTime? TrafficSince { get; set; }
}

/// <summary>Lifetime content audience independent of expiring visit details.</summary>
[Table(Name = "cms_content_audience")]
[Index("ux_audience_pair", "ContentId,VisitorId", true)]
public class ContentAudience : Entity
{
    /// <summary>Content identity.</summary>
    [Column(StringLength = 32)] public string ContentId { get; set; } = "";
    /// <summary>Pseudonymous browser identity.</summary>
    [Column(StringLength = 32)] public string VisitorId { get; set; } = "";
}
