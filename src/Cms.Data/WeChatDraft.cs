using FreeSql.DataAnnotations;

namespace Cms.Data;

/// <summary>Encrypted administrator-managed official account configuration.</summary>
[Table(Name = "cms_wechat_settings")]
public class WeChatAccountSettings : Entity
{
    /// <summary>Data Protection ciphertext, never plaintext account credentials.</summary>
    [Column(StringLength = -2)] public string ProtectedJson { get; set; } = "";
    /// <summary>Optimistic configuration revision.</summary>
    public int Version { get; set; }
}

/// <summary>A frozen website publication and its independent WeChat draft delivery.</summary>
[Table(Name = "cms_wechat_drafts")]
[Index("ux_wechat_draft", "AppId,ContentId,Fingerprint", true)]
public class WeChatDraft : Entity
{
    /// <summary>Destination account, never its secret.</summary>
    [Column(StringLength = 32)] public string AppId { get; set; } = "";
    /// <summary>Source article.</summary>
    [Column(StringLength = 32)] public string ContentId { get; set; } = "";
    /// <summary>Hash of the actual delivery content and source URL.</summary>
    [Column(StringLength = 64)] public string Fingerprint { get; set; } = "";
    /// <summary>Immutable delivery payload before image conversion.</summary>
    [Column(StringLength = -2)] public string SnapshotJson { get; set; } = "";
    /// <summary>Queued, preparing, submitting, draft, failed, unknown or cancelled.</summary>
    [Column(StringLength = 16)] public string Status { get; set; } = "queued";
    /// <summary>Confirmed WeChat draft identifier.</summary>
    [Column(StringLength = 128)] public string MediaId { get; set; } = "";
    /// <summary>Safe error without credentials or raw upstream responses.</summary>
    [Column(StringLength = 500)] public string Error { get; set; } = "";
    /// <summary>Most recent state transition.</summary>
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}

/// <summary>Optional publication of one draft; Id equals its WeChatDraft Id. No article URL is stored.</summary>
[Table(Name = "cms_wechat_publications")]
public class WeChatPublication : Entity
{
    /// <summary>Account captured when the synchronization was requested.</summary>
    [Column(StringLength = 32)] public string AppId { get; set; } = "";
    /// <summary>Queued, submitting, publishing, published, failed, unknown or cancelled.</summary>
    [Column(StringLength = 16)] public string Status { get; set; } = "queued";
    /// <summary>Confirmed task identifier, retained across restarts for status queries.</summary>
    [Column(StringLength = 128)] public string PublishId { get; set; } = "";
    /// <summary>Latest WeChat publication status, or -1 before a valid status response.</summary>
    public int PublishStatus { get; set; } = -1;
    /// <summary>Safe failure or query error without raw upstream content.</summary>
    [Column(StringLength = 500)] public string Error { get; set; } = "";
    /// <summary>Most recent attempt or status update.</summary>
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}
