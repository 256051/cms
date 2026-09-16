using FreeSql.DataAnnotations;

namespace Cms.Data;

/// <summary>Durable per-channel delivery with bounded retries and event deduplication.</summary>
[Table(Name = "cms_notifications")]
[Index("ux_notification_key", "EventKey,Channel", true)]
public class NotificationDelivery : Entity
{
    /// <summary>Stable source event identity, without credentials or customer contact details.</summary>
    [Column(StringLength = 160)] public string EventKey { get; set; } = "";
    /// <summary>Delivery transport.</summary>
    [Column(StringLength = 16)] public string Channel { get; set; } = "";
    /// <summary>Event classification.</summary>
    [Column(StringLength = 32)] public string Kind { get; set; } = "";
    /// <summary>Source object.</summary>
    [Column(StringLength = 32)] public string TargetId { get; set; } = "";
    /// <summary>Safe event heading.</summary>
    [Column(StringLength = 200)] public string Title { get; set; } = "";
    /// <summary>Relative administrator destination; never an arbitrary external URL.</summary>
    [Column(StringLength = 200)] public string Path { get; set; } = "";
    /// <summary>Original source occurrence used to detect resolved or superseded alerts.</summary>
    public DateTime OccurredAt { get; set; }
    /// <summary>Lifetime delivery attempts.</summary>
    public int Attempts { get; set; }
    /// <summary>Remaining attempts in the current retry round.</summary>
    public int RemainingAttempts { get; set; } = 5;
    /// <summary>Next retry, or null when completed or exhausted.</summary>
    public DateTime? NextAttemptAt { get; set; } = DateTime.UtcNow;
    /// <summary>Latest transport attempt.</summary>
    public DateTime? LastAttemptAt { get; set; }
    /// <summary>Confirmed successful delivery.</summary>
    public DateTime? SentAt { get; set; }
    /// <summary>Queued, sent, failed or cancelled.</summary>
    [Column(StringLength = 16)] public string Status { get; set; } = "queued";
    /// <summary>Redacted error safe for the administrative UI.</summary>
    [Column(StringLength = 500)] public string Error { get; set; } = "";
}

/// <summary>Activation boundary avoids replaying old inquiries on first notification setup.</summary>
[Table(Name = "cms_notification_state")]
public class NotificationState : Entity { }
