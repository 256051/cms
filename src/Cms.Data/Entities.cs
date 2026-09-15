using FreeSql.DataAnnotations;

namespace Cms.Data;

/// <summary>Common persistent identity.</summary>
public abstract class Entity
{
    /// <summary>Opaque portable identifier.</summary>
    [Column(IsPrimary = true, StringLength = 32)]
    public string Id { get; set; } = Guid.NewGuid().ToString("N");

    /// <summary>UTC creation timestamp.</summary>
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}

/// <summary>Administrator or editor account.</summary>
[Table(Name = "cms_users")]
[Index("ux_user_name", nameof(Username), true)]
public class CmsUser : Entity
{
    /// <summary>Normalized login name.</summary>
    [Column(StringLength = 64)]
    public string Username { get; set; } = "";

    /// <summary>Display name.</summary>
    [Column(StringLength = 100)]
    public string DisplayName { get; set; } = "";

    /// <summary>ASP.NET password hash.</summary>
    [Column(StringLength = 512)]
    public string PasswordHash { get; set; } = "";

    /// <summary>Admin or Editor role.</summary>
    [Column(StringLength = 16)]
    public string Role { get; set; } = "Editor";

    /// <summary>Whether login is allowed.</summary>
    public bool Enabled { get; set; } = true;

    /// <summary>Revokes existing cookies after account changes.</summary>
    [Column(StringLength = 32)]
    public string SecurityStamp { get; set; } = Guid.NewGuid().ToString("N");
}

/// <summary>Editorial content with a separate public snapshot.</summary>
[Table(Name = "cms_content")]
[Index("ux_content_slug", nameof(Slug), true)]
public class Content : Entity
{
    /// <summary>post or page.</summary>
    [Column(StringLength = 16)]
    public string Kind { get; set; } = "post";

    /// <summary>Stable URL segment.</summary>
    [Column(StringLength = 160)]
    public string Slug { get; set; } = "";

    /// <summary>Draft title.</summary>
    [Column(StringLength = 200)]
    public string Title { get; set; } = "";

    /// <summary>Draft summary.</summary>
    [Column(StringLength = 500)]
    public string Summary { get; set; } = "";

    /// <summary>Sanitized draft HTML.</summary>
    [Column(StringLength = -2)]
    public string Html { get; set; } = "";

    /// <summary>Optional cover identifier.</summary>
    [Column(StringLength = 32)]
    public string CoverId { get; set; } = "";

    /// <summary>Optional category.</summary>
    [Column(StringLength = 32)]
    public string CategoryId { get; set; } = "";

    /// <summary>Pipe-delimited tag identifiers.</summary>
    [Column(StringLength = 1500)]
    public string TagIds { get; set; } = "";

    /// <summary>Optimistic edit version.</summary>
    public int Version { get; set; } = 1;

    /// <summary>Last editorial update.</summary>
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;

    /// <summary>Publication visibility.</summary>
    public bool Published { get; set; }

    /// <summary>Sanitized published snapshot as ordinary text.</summary>
    [Column(StringLength = -2)]
    public string PublishedJson { get; set; } = "";

    /// <summary>Published title used for queries.</summary>
    [Column(StringLength = 200)]
    public string PublishedTitle { get; set; } = "";

    /// <summary>Published summary used for queries.</summary>
    [Column(StringLength = 500)]
    public string PublishedSummary { get; set; } = "";

    /// <summary>Published category used for archives.</summary>
    [Column(StringLength = 32)]
    public string PublishedCategoryId { get; set; } = "";

    /// <summary>Published tags used for archives.</summary>
    [Column(StringLength = 1500)]
    public string PublishedTagIds { get; set; } = "";

    /// <summary>Most recent publication time.</summary>
    public DateTime? PublishedAt { get; set; }
}

/// <summary>A category or tag.</summary>
[Table(Name = "cms_taxonomy")]
[Index("ux_taxonomy_slug", "Kind,Slug", true)]
public class Taxonomy : Entity
{
    /// <summary>category or tag.</summary>
    [Column(StringLength = 16)]
    public string Kind { get; set; } = "category";

    /// <summary>Visible label.</summary>
    [Column(StringLength = 100)]
    public string Name { get; set; } = "";

    /// <summary>Archive URL segment.</summary>
    [Column(StringLength = 100)]
    public string Slug { get; set; } = "";
}

/// <summary>Uploaded file metadata.</summary>
[Table(Name = "cms_assets")]
public class Asset : Entity
{
    /// <summary>Original display filename.</summary>
    [Column(StringLength = 200)]
    public string Name { get; set; } = "";

    /// <summary>Verified content type.</summary>
    [Column(StringLength = 100)]
    public string ContentType { get; set; } = "";

    /// <summary>Generated disk filename.</summary>
    [Column(StringLength = 80)]
    public string StorageName { get; set; } = "";

    /// <summary>Byte count.</summary>
    public long Size { get; set; }
}

/// <summary>Moderated plain-text visitor comment.</summary>
[Table(Name = "cms_comments")]
public class Comment : Entity
{
    /// <summary>Parent article identifier.</summary>
    [Column(StringLength = 32)]
    public string ContentId { get; set; } = "";

    /// <summary>Visitor display name.</summary>
    [Column(StringLength = 60)]
    public string Author { get; set; } = "";

    /// <summary>Plain text only.</summary>
    [Column(StringLength = 2000)]
    public string Body { get; set; } = "";

    /// <summary>Moderator approval.</summary>
    public bool Approved { get; set; }
}

/// <summary>Flat navigation entry.</summary>
[Table(Name = "cms_menu")]
public class MenuItem : Entity
{
    /// <summary>Visible label.</summary>
    [Column(StringLength = 200)]
    public string Label { get; set; } = "";

    /// <summary>Safe relative or HTTPS address.</summary>
    [Column(StringLength = 500)]
    public string Url { get; set; } = "/";

    /// <summary>Ascending display order.</summary>
    public int Sort { get; set; }

    /// <summary>Empty for a top-level item.</summary>
    [Column(StringLength = 32)]
    public string ParentId { get; set; } = "";

    /// <summary>Custom link, post, page, category or tag.</summary>
    [Column(StringLength = 16)]
    public string Type { get; set; } = "custom";

    /// <summary>Stable content or taxonomy identifier for an automatic link.</summary>
    [Column(StringLength = 32)]
    public string TargetId { get; set; } = "";

    /// <summary>Open the destination in a separate tab.</summary>
    public bool OpenInNewTab { get; set; }

    /// <summary>Optimistic menu item revision.</summary>
    public int Version { get; set; }
}

/// <summary>Site metadata stored in the selected database.</summary>
[Table(Name = "cms_settings")]
public class SiteSettings : Entity
{
    /// <summary>Website title.</summary>
    [Column(StringLength = 100)]
    public string Title { get; set; } = "我的内容站";

    /// <summary>Website introduction.</summary>
    [Column(StringLength = 500)]
    public string Description { get; set; } = "记录想法，分享值得阅读的内容。";

    /// <summary>Logo asset identifier.</summary>
    [Column(StringLength = 32)]
    public string LogoId { get; set; } = "";

    /// <summary>SEO keywords.</summary>
    [Column(StringLength = 300)]
    public string Keywords { get; set; } = "";

    /// <summary>Short introduction displayed with the site identity.</summary>
    [Column(StringLength = 100)]
    public string Subtitle { get; set; } = "";

    /// <summary>Browser icon asset identifier.</summary>
    [Column(StringLength = 32)]
    public string FaviconId { get; set; } = "";

    /// <summary>Primary content language, not an interface translation setting.</summary>
    [Column(StringLength = 16)]
    public string Language { get; set; } = "zh-CN";

    /// <summary>Home page list size.</summary>
    public int HomePageSize { get; set; } = 12;

    /// <summary>Category archive list size.</summary>
    public int CategoryPageSize { get; set; } = 12;

    /// <summary>Tag archive list size.</summary>
    public int TagPageSize { get; set; } = 12;

    /// <summary>Search result list size.</summary>
    public int SearchPageSize { get; set; } = 12;

    /// <summary>Request search engines to exclude public pages from indexing.</summary>
    public bool BlockSearchEngines { get; set; }

    /// <summary>Whether public comments can be read and submitted.</summary>
    public bool CommentsEnabled { get; set; } = true;

    /// <summary>Whether new comments await approval.</summary>
    public bool RequireCommentApproval { get; set; } = true;

    /// <summary>Require an existing enabled account for comment submission.</summary>
    public bool CommentsRequireLogin { get; set; }

    /// <summary>Plain-text footer information.</summary>
    [Column(StringLength = 500)]
    public string FooterText { get; set; } = "";

    /// <summary>Optimistic revision for all settings.</summary>
    public int Version { get; set; }
}

/// <summary>Successful write audit; never stores passwords or content.</summary>
[Table(Name = "cms_audit")]
public class AuditEntry : Entity
{
    /// <summary>Integration credential identifier, never its secret.</summary>
    [Column(StringLength = 32)]
    public string TokenId { get; set; } = "";

    /// <summary>Integration name retained after revocation.</summary>
    [Column(StringLength = 100)]
    public string TokenName { get; set; } = "";

    /// <summary>Actor identity.</summary>
    [Column(StringLength = 160)]
    public string Actor { get; set; } = "";

    /// <summary>Business action.</summary>
    [Column(StringLength = 120)]
    public string Action { get; set; } = "";

    /// <summary>Stable kind of the affected business object; blank on historical v1 entries.</summary>
    [Column(StringLength = 24)]
    public string TargetType { get; set; } = "";

    /// <summary>Identifier retained even after the target is deleted.</summary>
    [Column(StringLength = 32)]
    public string TargetId { get; set; } = "";

    /// <summary>Safe object name at the time of the operation; never credentials or body text.</summary>
    [Column(StringLength = 300)]
    public string TargetName { get; set; } = "";
}

/// <summary>Revocable machine credential; plaintext secrets are never persisted.</summary>
[Table(Name = "cms_access_tokens")]
[Index("ix_token_user", nameof(UserId), false)]
public class AccessToken : Entity
{
    /// <summary>Human-readable integration name.</summary>
    [Column(StringLength = 100)]
    public string Name { get; set; } = "";

    /// <summary>Account whose content permissions bound this token.</summary>
    [Column(StringLength = 32)]
    public string UserId { get; set; } = "";

    /// <summary>SHA-256 of the cryptographically random secret.</summary>
    [Column(StringLength = 64)]
    public string SecretHash { get; set; } = "";

    /// <summary>Space-separated allowlisted permissions.</summary>
    [Column(StringLength = 200)]
    public string Scopes { get; set; } = "";

    /// <summary>UTC expiry, always required.</summary>
    public DateTime ExpiresAt { get; set; }

    /// <summary>UTC last successful authentication, updated at most once per minute.</summary>
    public DateTime? LastUsedAt { get; set; }

    /// <summary>UTC revocation timestamp; revocation cannot be undone.</summary>
    public DateTime? RevokedAt { get; set; }
}

/// <summary>Committed integration response for bounded retry deduplication.</summary>
[Table(Name = "cms_integration_requests")]
[Index("ux_token_request", "TokenId,KeyHash", true)]
[Index("ix_request_expiry", nameof(ExpiresAt), false)]
public class IntegrationRequest : Entity
{
    /// <summary>Credential namespace for the idempotency key.</summary>
    [Column(StringLength = 32)]
    public string TokenId { get; set; } = "";

    /// <summary>Hash of the caller's idempotency key.</summary>
    [Column(StringLength = 64)]
    public string KeyHash { get; set; } = "";

    /// <summary>Hash of operation, target and logical request body.</summary>
    [Column(StringLength = 64)]
    public string RequestHash { get; set; } = "";

    /// <summary>Sanitized business response committed with the original write.</summary>
    [Column(StringLength = -1)]
    public string ResponseJson { get; set; } = "";

    /// <summary>UTC end of the retry window.</summary>
    public DateTime ExpiresAt { get; set; }
}

/// <summary>Versioned appearance with independent built-in theme profiles.</summary>
[Table(Name = "cms_theme")]
public class ThemeState : Entity
{
    /// <summary>Built-in theme currently visible to visitors.</summary>
    [Column(StringLength = 32)]
    public string ActiveThemeId { get; set; } = "classic";

    /// <summary>Per-theme options as portable text, never executable templates.</summary>
    [Column(StringLength = -1)]
    public string ProfilesJson { get; set; } = "{}";

    /// <summary>Optimistic version covering configuration and activation.</summary>
    public int Version { get; set; }
}

/// <summary>Explicit schema version.</summary>
[Table(Name = "cms_schema")]
public class SchemaVersion : Entity
{
    /// <summary>Applied schema revision.</summary>
    public int Version { get; set; }
}