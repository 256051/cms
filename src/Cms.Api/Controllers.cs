using System.Security.Claims;
using System.Security.Cryptography;
using Cms.Data;
using Cms.Services;
using Microsoft.AspNetCore.Antiforgery;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;

namespace Cms.Api;

/// <summary>Cookie session HTTP endpoints.</summary>
[Route("api/v1/auth")]
public sealed class AuthController(
    AuthService service,
    LoginProtection protection,
    IAntiforgery antiforgery,
    IWebHostEnvironment environment) : ApiController
{
    /// <summary>Issue the request verification token.</summary>
    [HttpGet("csrf")]
    public object Csrf()
    {
        return Result(new { token = antiforgery.GetAndStoreTokens(HttpContext).RequestToken });
    }

    /// <summary>Issue a browser-bound login image challenge; refreshing invalidates the previous image.</summary>
    [HttpGet("captcha")]
    [EnableRateLimiting("captcha")]
    public ApiResponse<CaptchaView> Captcha()
    {
        var browser = Request.Cookies["cms.login"];
        if (browser is not { Length: 64 } || !browser.All(char.IsAsciiHexDigit))
            browser = RandomNumberGenerator.GetHexString(64);
        var captcha = protection.Create(browser);
        Response.Cookies.Append("cms.login", browser,
            new CookieOptions
            {
                HttpOnly = true, Secure = !environment.IsDevelopment() || Request.IsHttps,
                SameSite = SameSiteMode.Strict, Path = "/api/v1/auth", MaxAge = TimeSpan.FromMinutes(3),
                IsEssential = true
            });
        return Result(captcha);
    }

    /// <summary>Establish an authenticated session.</summary>
    [HttpPost("login")]
    [EnableRateLimiting("login")]
    public async Task<ApiResponse<UserView>> Login(LoginInput input)
    {
        var user = await service.LoginAsync(input, Request.Cookies["cms.login"]);
        var claims = new[]
        {
            new Claim(ClaimTypes.NameIdentifier, user.Id), new Claim(ClaimTypes.Name, user.Username),
            new Claim(ClaimTypes.Role, user.Role), new Claim("stamp", user.SecurityStamp)
        };
        await HttpContext.SignInAsync("cms", new ClaimsPrincipal(new ClaimsIdentity(claims, "cms")));
        return Result(service.View(user));
    }

    /// <summary>Read the current account.</summary>
    [HttpGet("me")]
    [Authorize]
    public async Task<ApiResponse<UserView>> Me()
    {
        return Result(service.View((await service.FindAsync(Actor))!));
    }

    /// <summary>End the current session.</summary>
    [HttpPost("logout")]
    [Authorize]
    public async Task<ApiResponse<bool>> Logout()
    {
        await HttpContext.SignOutAsync("cms");
        return Result(true);
    }

    /// <summary>Change password and invalidate the current session.</summary>
    [HttpPost("password")]
    [Authorize]
    public async Task<ApiResponse<bool>> Password(PasswordInput input)
    {
        var result = await service.ChangePasswordAsync(Actor, input);
        await HttpContext.SignOutAsync("cms");
        return Result(result);
    }
}

/// <summary>Editorial HTTP endpoints; all business rules live in services.</summary>
[Route("api/v1/admin")]
[Authorize(AuthenticationSchemes = "cms", Roles = "Admin,Editor")]
public sealed class AdminController(
    ContentService content,
    SiteService site,
    AssetService assets,
    AuthService users,
    ThemeService themes) : ApiController
{
    /// <summary>Read packaged themes and independent saved profiles.</summary>
    [HttpGet("themes")]
    [Authorize(Roles = "Admin")]
    public async Task<ApiResponse<ThemesView>> Themes()
    {
        return Result(await themes.ListAsync());
    }

    /// <summary>Validate a non-persistent appearance preview.</summary>
    [HttpGet("themes/preview")]
    [Authorize(Roles = "Admin")]
    public async Task<ApiResponse<ThemeView>> PreviewTheme(string themeId, string? accentColor, string? heroTitle,
        string? heroDescription)
    {
        return Result(await themes.PreviewAsync(themeId, accentColor, heroTitle, heroDescription));
    }

    /// <summary>Atomically save and activate a packaged theme.</summary>
    [HttpPut("themes/active")]
    [Authorize(Roles = "Admin")]
    public async Task<ApiResponse<ThemesView>> ApplyTheme(ThemeApplyInput input)
    {
        return Result(await themes.ApplyAsync(Actor, input));
    }

    /// <summary>Dashboard counts.</summary>
    [HttpGet("stats")]
    public async Task<ApiResponse<StatsView>> Stats()
    {
        return Result(await site.StatsAsync());
    }

    /// <summary>List content drafts.</summary>
    [HttpGet("contents")]
    public async Task<ApiResponse<PageResult<ContentView>>> Contents(string kind = "post", string? q = null,
        int page = 1, string sort = "recent", string status = "", string? categoryId = null, string? tagId = null)
    {
        return Result(await content.ListAsync(false, kind, q, categoryId, tagId, page, 20, sort, status));
    }

    /// <summary>Get draft or authenticated preview data.</summary>
    [HttpGet("contents/{id}")]
    public async Task<ApiResponse<ContentView>> GetContent(string id)
    {
        return Result(await content.GetAsync(id));
    }

    /// <summary>Read a published reusable layout through an authenticated editorial session.</summary>
    [HttpGet("templates/{id}")]
    public async Task<ApiResponse<ContentView>> Template(string id) => Result(await content.TemplateAsync(id));

    /// <summary>Read a published reusable block for the page builder.</summary>
    [HttpGet("blocks/{id}")]
    public async Task<ApiResponse<ContentView>> Block(string id) => Result(await content.BlockAsync(id));

    /// <summary>List retained uses of a synchronized block.</summary>
    [HttpGet("blocks/{id}/references")]
    public async Task<ApiResponse<IReadOnlyList<BlockReference>>> BlockReferences(string id) => Result(await content.BlockReferencesAsync(id));

    /// <summary>Resolve an unsaved layout using only published reusable blocks.</summary>
    [HttpPost("layout-preview")]
    public async Task<ApiResponse<PageLayout>> LayoutPreview(PageLayout layout) => Result(await content.PreviewLayoutAsync(layout));

    /// <summary>Create a draft.</summary>
    [HttpPost("contents")]
    public async Task<ApiResponse<ContentView>> Create(ContentInput input)
    {
        return Result(await content.SaveAsync(Actor, null, input));
    }

    /// <summary>Save an expected draft version.</summary>
    [HttpPut("contents/{id}")]
    public async Task<ApiResponse<ContentView>> Save(string id, ContentInput input)
    {
        return Result(await content.SaveAsync(Actor, id, input));
    }

    /// <summary>Publish the expected version.</summary>
    [HttpPost("contents/{id}/publish")]
    public async Task<ApiResponse<ContentView>> Publish(string id, ContentPublishInput input)
    {
        return Result(await content.PublishAsync(Actor, id, input.Version, true, input.SyncToWeChat));
    }

    /// <summary>Withdraw public content.</summary>
    [HttpPost("contents/{id}/unpublish")]
    public async Task<ApiResponse<ContentView>> Unpublish(string id, VersionInput input)
    {
        return Result(await content.PublishAsync(Actor, id, input.Version, false));
    }

    /// <summary>Delete the expected version.</summary>
    [HttpDelete("contents/{id}")]
    public async Task<ApiResponse<bool>> DeleteContent(string id, [FromBody] VersionInput input)
    {
        return Result(await content.DeleteAsync(Actor, id, input.Version));
    }

    /// <summary>Read taxonomy.</summary>
    [HttpGet("taxonomy")]
    public async Task<ApiResponse<List<Taxonomy>>> Taxonomy()
    {
        return Result(await site.TaxonomyAsync());
    }

    /// <summary>Create taxonomy.</summary>
    [HttpPost("taxonomy")]
    public async Task<ApiResponse<Taxonomy>> CreateTaxonomy(TaxonomyInput input)
    {
        return Result(await site.SaveTaxonomyAsync(Actor, null, input));
    }

    /// <summary>Update taxonomy.</summary>
    [HttpPut("taxonomy/{id}")]
    public async Task<ApiResponse<Taxonomy>> SaveTaxonomy(string id, TaxonomyInput input)
    {
        return Result(await site.SaveTaxonomyAsync(Actor, id, input));
    }

    /// <summary>Delete unused taxonomy.</summary>
    [HttpDelete("taxonomy/{id}")]
    public async Task<ApiResponse<bool>> DeleteTaxonomy(string id)
    {
        return Result(await site.DeleteTaxonomyAsync(Actor, id));
    }

    /// <summary>Read uploaded file metadata.</summary>
    [HttpGet("assets")]
    public async Task<ApiResponse<PageResult<AssetView>>> Assets(int page = 1, string q = "", string type = "", string group = "")
    {
        return Result(await assets.ListAsync(page, q, type, group));
    }

    /// <summary>List existing attachment groups for pickers.</summary>
    [HttpGet("assets/groups")]
    public async Task<ApiResponse<List<string>>> AssetGroups() => Result(await assets.GroupsAsync());

    /// <summary>Rename or regroup an attachment without changing its media URL.</summary>
    [HttpPut("assets/{id}")]
    public async Task<ApiResponse<AssetView>> UpdateAsset(string id, AssetMetadataInput input) => Result(await assets.UpdateAsync(Actor, id, input));

    /// <summary>Locate retained attachment references.</summary>
    [HttpGet("assets/{id}/references")]
    public async Task<ApiResponse<IReadOnlyList<AssetReference>>> AssetReferences(string id) => Result(await assets.ReferencesAsync(id));

    /// <summary>Read content history.</summary>
    [HttpGet("contents/{id}/revisions")]
    public async Task<ApiResponse<PageResult<RevisionView>>> Revisions(string id, int page = 1) => Result(await content.RevisionsAsync(id, page));

    /// <summary>Read a historical snapshot.</summary>
    [HttpGet("contents/{id}/revisions/{revision}")]
    public async Task<ApiResponse<ContentView>> Revision(string id, string revision) => Result(await content.RevisionAsync(id, revision));

    /// <summary>Restore history to the current draft.</summary>
    [HttpPost("contents/{id}/revisions/{revision}/restore")]
    public async Task<ApiResponse<ContentView>> RestoreRevision(string id, string revision, VersionInput input) =>
        Result(await content.RestoreRevisionAsync(Actor, id, revision, input.Version));

    /// <summary>Recover a recycled item as a draft.</summary>
    [HttpPost("contents/{id}/restore")]
    public async Task<ApiResponse<bool>> Restore(string id, VersionInput input) => Result(await content.RecycleAsync(Actor, id, input.Version, false));

    /// <summary>Permanently remove a recycled item and its comments and history.</summary>
    [HttpDelete("contents/{id}/purge")]
    public async Task<ApiResponse<bool>> Purge(string id, [FromBody] VersionInput input) => Result(await content.RecycleAsync(Actor, id, input.Version, true));

    /// <summary>Duplicate editorial content as a new draft.</summary>
    [HttpPost("contents/{id}/duplicate")]
    public async Task<ApiResponse<ContentView>> Duplicate(string id) => Result(await content.DuplicateAsync(Actor, id));

    /// <summary>Perform an atomic content batch operation.</summary>
    [HttpPost("contents/batch")]
    public async Task<ApiResponse<bool>> Batch(ContentBatchInput input) => Result(await content.BatchAsync(Actor, input));

    /// <summary>Set or cancel publication and withdrawal schedules.</summary>
    [HttpPut("contents/{id}/schedule")]
    public async Task<ApiResponse<ContentView>> Schedule(string id, ContentScheduleInput input) => Result(await content.ScheduleAsync(Actor, id, input));

    /// <summary>Upload one verified file.</summary>
    [HttpPost("assets")]
    [RequestSizeLimit(55_000_000)]
    public async Task<ApiResponse<AssetView>> Upload(IFormFile file, CancellationToken cancellation, [FromForm] string group = "")
    {
        await using var stream = file.OpenReadStream();
        return Result(await assets.UploadAsync(Actor, file.FileName, stream, cancellation, group));
    }

    /// <summary>Delete an unreferenced file.</summary>
    [HttpDelete("assets/{id}")]
    public async Task<ApiResponse<bool>> DeleteAsset(string id)
    {
        return Result(await assets.DeleteAsync(Actor, id));
    }

    /// <summary>Read moderated and pending comments.</summary>
    [HttpGet("comments")]
    public async Task<ApiResponse<PageResult<ManagedComment>>> Comments(int page = 1, bool pending = false, string contentId = "", string q = "")
    {
        return Result(await site.CommentsAsync(page, pending, contentId, q));
    }

    /// <summary>Save or clear an administrator reply.</summary>
    [HttpPut("comments/{id}/reply")]
    [Authorize(Roles = "Admin")]
    public async Task<ApiResponse<Comment>> Reply(string id, CommentReplyInput input) => Result(await site.ReplyAsync(Actor, id, input.Reply));

    /// <summary>Moderate an explicit comment selection atomically.</summary>
    [HttpPost("comments/batch")]
    public async Task<ApiResponse<bool>> BatchComments(CommentBatchInput input) => Result(await site.BatchCommentsAsync(Actor, input));

    /// <summary>Approve or hide a comment.</summary>
    [HttpPut("comments/{id}")]
    public async Task<ApiResponse<Comment>> Moderate(string id, ModerateInput input)
    {
        return Result(await site.ModerateAsync(Actor, id, input.Approved));
    }

    /// <summary>Delete a comment.</summary>
    [HttpDelete("comments/{id}")]
    public async Task<ApiResponse<bool>> DeleteComment(string id)
    {
        return Result(await site.DeleteCommentAsync(Actor, id));
    }

    /// <summary>Read menu configuration.</summary>
    [HttpGet("menu")]
    [Authorize(Roles = "Admin")]
    public async Task<ApiResponse<IReadOnlyList<MenuView>>> Menu()
    {
        return Result(await site.MenuAsync());
    }

    /// <summary>Search published content and taxonomy for automatic menu destinations.</summary>
    [HttpGet("menu/targets")]
    [Authorize(Roles = "Admin")]
    public async Task<ApiResponse<PageResult<MenuTarget>>> MenuTargets(string type, string? q = null, int page = 1)
    {
        return Result(await site.MenuTargetsAsync(type, q, page));
    }

    /// <summary>Create menu entry.</summary>
    [HttpPost("menu")]
    [Authorize(Roles = "Admin")]
    public async Task<ApiResponse<MenuView>> CreateMenu(MenuInput input)
    {
        return Result(await site.SaveMenuAsync(Actor, null, input));
    }

    /// <summary>Update menu entry.</summary>
    [HttpPut("menu/{id}")]
    [Authorize(Roles = "Admin")]
    public async Task<ApiResponse<MenuView>> SaveMenu(string id, MenuInput input)
    {
        return Result(await site.SaveMenuAsync(Actor, id, input));
    }

    /// <summary>Delete menu entry.</summary>
    [HttpDelete("menu/{id}")]
    [Authorize(Roles = "Admin")]
    public async Task<ApiResponse<bool>> DeleteMenu(string id, int? version = null)
    {
        return Result(await site.DeleteMenuAsync(Actor, id, version));
    }

    /// <summary>Read footer friend links.</summary>
    [HttpGet("friend-links")]
    [Authorize(Roles = "Admin")]
    public async Task<ApiResponse<IReadOnlyList<MenuView>>> FriendLinks()
    {
        return Result(await site.MenuAsync(friendLinks: true));
    }

    /// <summary>Create a footer friend link.</summary>
    [HttpPost("friend-links")]
    [Authorize(Roles = "Admin")]
    public async Task<ApiResponse<MenuView>> CreateFriendLink(MenuInput input)
    {
        return Result(await site.SaveMenuAsync(Actor, null, input, friendLinks: true));
    }

    /// <summary>Update a footer friend link.</summary>
    [HttpPut("friend-links/{id}")]
    [Authorize(Roles = "Admin")]
    public async Task<ApiResponse<MenuView>> SaveFriendLink(string id, MenuInput input)
    {
        return Result(await site.SaveMenuAsync(Actor, id, input, friendLinks: true));
    }

    /// <summary>Delete a footer friend link.</summary>
    [HttpDelete("friend-links/{id}")]
    [Authorize(Roles = "Admin")]
    public async Task<ApiResponse<bool>> DeleteFriendLink(string id, int? version = null)
    {
        return Result(await site.DeleteMenuAsync(Actor, id, version, friendLinks: true));
    }

    /// <summary>Read site settings.</summary>
    [HttpGet("settings")]
    [Authorize(Roles = "Admin")]
    public async Task<ApiResponse<SiteSettings>> Settings()
    {
        return Result(await site.SettingsAsync());
    }

    /// <summary>Update site settings.</summary>
    [HttpPut("settings")]
    [Authorize(Roles = "Admin")]
    public async Task<ApiResponse<SiteSettings>> SaveSettings(SettingsInput input)
    {
        return Result(await site.SaveSettingsAsync(Actor, input));
    }

    /// <summary>List safe account records.</summary>
    [HttpGet("users")]
    [Authorize(Roles = "Admin")]
    public async Task<ApiResponse<IReadOnlyList<UserView>>> Users()
    {
        return Result(await users.ListAsync());
    }

    /// <summary>Create an account.</summary>
    [HttpPost("users")]
    [Authorize(Roles = "Admin")]
    public async Task<ApiResponse<UserView>> CreateUser(UserInput input)
    {
        return Result(await users.SaveAsync(Actor, null, input));
    }

    /// <summary>Update account and revoke existing sessions.</summary>
    [HttpPut("users/{id}")]
    [Authorize(Roles = "Admin")]
    public async Task<ApiResponse<UserView>> SaveUser(string id, UserInput input)
    {
        return Result(await users.SaveAsync(Actor, id, input));
    }

    /// <summary>Delete account.</summary>
    [HttpDelete("users/{id}")]
    [Authorize(Roles = "Admin")]
    public async Task<ApiResponse<bool>> DeleteUser(string id)
    {
        return Result(await users.DeleteAsync(Actor, id));
    }

    /// <summary>Page administrative audit events.</summary>
    [HttpGet("audit")]
    [Authorize(Roles = "Admin")]
    public async Task<ApiResponse<PageResult<AuditView>>> Audit(int page = 1, string actor = "", string action = "", string target = "", DateTime? from = null, DateTime? to = null)
    {
        return Result(await site.AuditAsync(page, actor, action, target, from, to));
    }
}

/// <summary>Anonymous read-only content plus moderated comment submission.</summary>
[Route("api/v1/public")]
public sealed class PublicController(ContentService content, SiteService site, ThemeService themes) : ApiController
{
    /// <summary>Read the selected published home page, or null for the built-in blog home.</summary>
    [HttpGet("home")]
    public async Task<ApiResponse<ContentView?>> Home() => Result(await content.HomeAsync());
    /// <summary>Discover related content and chronological neighbors using published snapshots only.</summary>
    [HttpGet("contents/{slug}/discovery")]
    public async Task<ApiResponse<ContentDiscovery>> Discovery(string slug) => Result(await content.DiscoveryAsync(slug));

    /// <summary>Read only the current effective appearance.</summary>
    [HttpGet("theme")]
    public async Task<ApiResponse<ThemeView>> Theme()
    {
        return Result(await themes.PublicAsync());
    }

    /// <summary>List public content.</summary>
    [HttpGet("contents")]
    public async Task<ApiResponse<PageResult<ContentView>>> Contents(string kind = "post", string? q = null,
        string? categoryId = null, string? tagId = null, int page = 1, int? pageSize = null, bool search = false)
    {
        return Result(await content.PublicListAsync(kind, q, categoryId, tagId, page, pageSize, search));
    }

    /// <summary>Read one published snapshot.</summary>
    [HttpGet("contents/{slug}")]
    public async Task<ApiResponse<ContentView>> GetContent(string slug)
    {
        return Result(await content.PublicAsync(slug));
    }

    /// <summary>Read site metadata.</summary>
    [HttpGet("settings")]
    public async Task<ApiResponse<SiteSettings>> Settings()
    {
        return Result(await site.SettingsAsync());
    }

    /// <summary>Read public taxonomy.</summary>
    [HttpGet("taxonomy")]
    public async Task<ApiResponse<List<Taxonomy>>> Taxonomy()
    {
        return Result(await site.TaxonomyAsync());
    }

    /// <summary>Read public navigation.</summary>
    [HttpGet("menu")]
    public async Task<ApiResponse<IReadOnlyList<MenuView>>> Menu()
    {
        return Result(await site.MenuAsync(true));
    }

    /// <summary>Read public footer friend links in display order.</summary>
    [HttpGet("friend-links")]
    public async Task<ApiResponse<IReadOnlyList<MenuView>>> FriendLinks()
    {
        return Result(await site.MenuAsync(true, friendLinks: true));
    }

    /// <summary>List all published sitemap records.</summary>
    [HttpGet("sitemap")]
    public async Task<ApiResponse<IReadOnlyList<ContentView>>> Sitemap()
    {
        return Result(await content.SitemapAsync());
    }

    /// <summary>Read approved comments.</summary>
    [HttpGet("comments")]
    public async Task<ApiResponse<PageResult<Comment>>> Comments(string contentId, int page = 1)
    {
        return Result(await site.PublicCommentsAsync(contentId, page));
    }

    /// <summary>Queue a comment for review.</summary>
    [HttpPost("comments")]
    [EnableRateLimiting("comments")]
    public async Task<ApiResponse<Comment>> AddComment(CommentInput input)
    {
        return Result(await site.AddCommentAsync(input, User.FindFirstValue(ClaimTypes.NameIdentifier)));
    }
}

/// <summary>Authorized local media delivery.</summary>
public sealed class MediaController(AssetService service) : ControllerBase
{
    /// <summary>Stream a verified file after checking visibility.</summary>
    [HttpGet("/media/{id}")]
    public async Task<IActionResult> Read(string id)
    {
        var file = await service.ReadAsync(id, User.IsInRole("Admin") || User.IsInRole("Editor"));
        Response.Headers.CacheControl = "no-store";
        return file.ContentType == "application/pdf"
            ? PhysicalFile(file.Path, file.ContentType, file.Name)
            : PhysicalFile(file.Path, file.ContentType, true);
    }
}
