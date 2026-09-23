using Cms.Data;
using FluentValidation;
using Mapster;

namespace Cms.Services;

/// <summary>Account information safe for the browser.</summary>
public record UserView(string Id, string Username, string DisplayName, string Role, bool Enabled, string Email = "");

/// <summary>Login credentials.</summary>
public record LoginInput(string Username, string Password, string CaptchaId, string CaptchaCode);

/// <summary>Single-use login challenge, image and validity period; never includes its answer.</summary>
public record CaptchaView(string Id, string Image, int ExpiresInSeconds);

/// <summary>Editorial input with optimistic version.</summary>
public record ContentInput(
    string Kind,
    string Slug,
    string Title,
    string Summary,
    string Html,
    string CoverId,
    string CategoryId,
    string[] TagIds,
    int Version,
    PageLayout? Layout = null, ContentSeo? Seo = null, ContentField[]? Fields = null);

/// <summary>Immutable sanitized content snapshot.</summary>
public record ContentView(
    string Id,
    string Kind,
    string Slug,
    string Title,
    string Summary,
    string Html,
    string CoverId,
    string CategoryId,
    string[] TagIds,
    int Version,
    bool Published,
    DateTime? PublishedAt,
    long Views = 0,
    long TodayViews = 0,
    long Visitors = 0,
    DateTime? UpdatedAt = null,
    DateTime? LastPublishedAt = null,
    DateTime? DeletedAt = null,
    DateTime? ScheduledPublishAt = null,
    DateTime? ScheduledUnpublishAt = null,
    PageLayout? Layout = null, ContentSeo? Seo = null, ContentField[]? Fields = null, string PublicSlug = "");

/// <summary>Ordered plain-text business attribute, with a stable key and historical display label.</summary>
public record ContentField(string Key, string Label, string Value);

/// <summary>Optional page metadata; empty values fall back to visible title, summary and cover.</summary>
public record ContentSeo(string Title = "", string Description = "", string ImageId = "", bool NoIndex = false);

/// <summary>Frozen publication and withdrawal times; null cancels the corresponding schedule.</summary>
public record ContentScheduleInput(int Version, DateTime? PublishAt, DateTime? UnpublishAt);
/// <summary>One selected expected revision in a batch.</summary>
public record ContentSelection(string Id, int Version);
/// <summary>Atomic category change or withdrawal of at most one hundred items.</summary>
public record ContentBatchInput(string Action, ContentSelection[] Items, string CategoryId = "");
/// <summary>Compact history entry without transferring the full body.</summary>
public record RevisionView(string Id, int Version, string Action, string Actor, string Title, DateTime CreatedAt);
/// <summary>Public navigation around one published article.</summary>
public record ContentDiscovery(ContentView? Previous, ContentView? Next, IReadOnlyList<ContentView> Related);

/// <summary>Version required for publish, unpublish and delete.</summary>
public record VersionInput(int Version);

/// <summary>Human-readable attachment reference location.</summary>
public record AssetReference(string ContentId, string Kind, string Title, string Source, int? Version, bool Deleted = false);

/// <summary>Category/tag input.</summary>
public record TaxonomyInput(string Kind, string Name, string Slug);

/// <summary>Menu input.</summary>
public record MenuInput(
    string Label,
    string Url,
    int Sort,
    string ParentId = "",
    string Type = "custom",
    string TargetId = "",
    bool OpenInNewTab = false,
    int Version = 0);

/// <summary>Resolved navigation destination; unavailable items are administrative only.</summary>
public record MenuView(
    string Id,
    string Label,
    string Url,
    int Sort,
    string ParentId,
    string Type,
    string TargetId,
    bool OpenInNewTab,
    int Version,
    bool Available);

/// <summary>One selectable published content or archive destination.</summary>
public record MenuTarget(string Id, string Label, string Url);

/// <summary>Public comment input.</summary>
public record CommentInput(string ContentId, string Author, string Body);

/// <summary>Comment moderation input.</summary>
public record ModerateInput(bool Approved);

/// <summary>One official plain-text reply.</summary>
public record CommentReplyInput(string Reply);
/// <summary>Atomic moderation of at most one hundred comments.</summary>
public record CommentBatchInput(string[] Ids, string Action);
/// <summary>Comment with its editorial context.</summary>
public record ManagedComment(string Id, string ContentId, string Author, string Body, bool Approved, DateTime CreatedAt,
    string Reply, string ReplyBy, DateTime? RepliedAt, string ContentTitle, string ContentUrl, string EditorUrl);
/// <summary>Audit record with a resolved display name, preserving the original identity.</summary>
public record AuditView(string Id, DateTime CreatedAt, string Actor, string ActorName, string Action,
    string TargetType, string TargetId, string TargetName, string TokenId, string TokenName);

/// <summary>Account administration input; password optional on edit.</summary>
public record UserInput(string Username, string DisplayName, string Role, bool Enabled, string? Password, string Email = "");

/// <summary>Password rotation request.</summary>
public record PasswordInput(string CurrentPassword, string NewPassword);

/// <summary>Public site settings input.</summary>
public record SettingsInput(
    string Title,
    string Description,
    string LogoId,
    string Keywords,
    string Subtitle = "",
    string FaviconId = "",
    string Language = "zh-CN",
    int HomePageSize = 12,
    int CategoryPageSize = 12,
    int TagPageSize = 12,
    int SearchPageSize = 12,
    bool BlockSearchEngines = false,
    bool CommentsEnabled = true,
    bool RequireCommentApproval = true,
    bool CommentsRequireLogin = false,
    string FooterText = "",
    int Version = 0,
    string HomePageId = "");

/// <summary>Validate bounded, non-executable site settings.</summary>
public sealed class SettingsValidator : AbstractValidator<SettingsInput>
{
    /// <summary>Define safe site fields and portable list limits.</summary>
    public SettingsValidator()
    {
        RuleFor(x => x.Title).NotEmpty().MaximumLength(100).Must(Plain);
        RuleFor(x => x.Subtitle).NotNull().MaximumLength(100).Must(Plain);
        RuleFor(x => x.Description).NotNull().MaximumLength(500).Must(Plain);
        RuleFor(x => x.Keywords).NotNull().MaximumLength(300).Must(Plain);
        RuleFor(x => x.FooterText).NotNull().MaximumLength(500).Must(Plain);
        RuleFor(x => x.LogoId).NotNull().MaximumLength(32);
        RuleFor(x => x.FaviconId).NotNull().MaximumLength(32);
        RuleFor(x => x.HomePageId).NotNull().Must(x => x == "" || System.Text.RegularExpressions.Regex.IsMatch(x, "^[a-f0-9]{32}$"));
        RuleFor(x => x.Language).Must(x => x is "zh-CN" or "zh-TW" or "en");
        RuleFor(x => x.HomePageSize).InclusiveBetween(1, 50);
        RuleFor(x => x.CategoryPageSize).InclusiveBetween(1, 50);
        RuleFor(x => x.TagPageSize).InclusiveBetween(1, 50);
        RuleFor(x => x.SearchPageSize).InclusiveBetween(1, 50);
        RuleFor(x => x.Version).InclusiveBetween(0, int.MaxValue - 1);
    }

    private static bool Plain(string? value)
    {
        return value != null &&
               !value.Any(c => c is '<' or '>' || (char.IsControl(c) && c is not ('\r' or '\n' or '\t')));
    }
}

/// <summary>File response with verified metadata.</summary>
public record FileView(string Path, string ContentType, string Name);

/// <summary>Browser-visible file metadata.</summary>
public record AssetView(string Id, string Name, string ContentType, long Size, DateTime CreatedAt, string Url, string Group = "", int Version = 1);

/// <summary>Rename or regroup metadata without changing attachment content.</summary>
public record AssetMetadataInput(string Name, string Group, int Version);

/// <summary>Live overview counts.</summary>
public record StatsView(long Posts, long Published, long Pages, long PendingComments, long Assets);

/// <summary>Explicit entity-to-browser mappings shared by the application.</summary>
public static class MappingConfiguration
{
    /// <summary>Validate and compile mappings before the application starts serving requests.</summary>
    public static TypeAdapterConfig Create()
    {
        var config = new TypeAdapterConfig { RequireExplicitMapping = true, RequireDestinationMemberSource = true };
        config.NewConfig<CmsUser, UserView>();
        config.Compile();
        return config;
    }
}

/// <summary>Editorial trust-boundary validation.</summary>
public class ContentValidator : AbstractValidator<ContentInput>
{
    /// <summary>Define portable content constraints.</summary>
    public ContentValidator()
    {
        RuleFor(x => x.Kind).Must(x => x is "post" or "page" or "template" or "block" or "product" or "case");
        RuleFor(x => x.Layout).Null().When(x => x.Kind == "post");
        RuleFor(x => x.Layout).NotNull().When(x => x.Kind is "template" or "block");
        RuleFor(x => x.Slug).NotEmpty().MaximumLength(160).Matches("^[a-z0-9]+(?:-[a-z0-9]+)*$");
        RuleFor(x => x.Title).NotEmpty().MaximumLength(200);
        RuleFor(x => x.Summary).NotNull().MaximumLength(500);
        RuleFor(x => x.Html).NotNull().MaximumLength(500_000);
        RuleFor(x => x.CoverId).NotNull().MaximumLength(32);
        RuleFor(x => x.CategoryId).NotNull().MaximumLength(32);
        RuleFor(x => x.TagIds).NotNull().Must(x => x is { Length: <= 30 });
        RuleForEach(x => x.TagIds).Matches("^[a-f0-9]{32}$");
    }
}
