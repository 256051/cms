using Cms.Data;
using FluentValidation;
using Mapster;

namespace Cms.Services;

/// <summary>Account information safe for the browser.</summary>
public record UserView(string Id, string Username, string DisplayName, string Role, bool Enabled);

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
    int Version);

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
    DateTime? PublishedAt);

/// <summary>Version required for publish, unpublish and delete.</summary>
public record VersionInput(int Version);

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

/// <summary>Account administration input; password optional on edit.</summary>
public record UserInput(string Username, string DisplayName, string Role, bool Enabled, string? Password);

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
    int Version = 0);

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
public record AssetView(string Id, string Name, string ContentType, long Size, DateTime CreatedAt, string Url);

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
        RuleFor(x => x.Kind).Must(x => x is "post" or "page");
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