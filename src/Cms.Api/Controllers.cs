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
[Authorize(AuthenticationSchemes = "cms")]
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
        int page = 1)
    {
        return Result(await content.ListAsync(false, kind, q, null, null, page, 20));
    }

    /// <summary>Get draft or authenticated preview data.</summary>
    [HttpGet("contents/{id}")]
    public async Task<ApiResponse<ContentView>> GetContent(string id)
    {
        return Result(await content.GetAsync(id));
    }

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
    public async Task<ApiResponse<ContentView>> Publish(string id, VersionInput input)
    {
        return Result(await content.PublishAsync(Actor, id, input.Version, true));
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
    public async Task<ApiResponse<PageResult<AssetView>>> Assets(int page = 1)
    {
        return Result(await assets.ListAsync(page));
    }

    /// <summary>Upload one verified file.</summary>
    [HttpPost("assets")]
    [RequestSizeLimit(55_000_000)]
    public async Task<ApiResponse<AssetView>> Upload(IFormFile file, CancellationToken cancellation)
    {
        await using var stream = file.OpenReadStream();
        return Result(await assets.UploadAsync(Actor, file.FileName, stream, cancellation));
    }

    /// <summary>Delete an unreferenced file.</summary>
    [HttpDelete("assets/{id}")]
    public async Task<ApiResponse<bool>> DeleteAsset(string id)
    {
        return Result(await assets.DeleteAsync(Actor, id));
    }

    /// <summary>Read moderated and pending comments.</summary>
    [HttpGet("comments")]
    public async Task<ApiResponse<PageResult<Comment>>> Comments(int page = 1, bool pending = false)
    {
        return Result(await site.CommentsAsync(page, pending));
    }

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
    public async Task<ApiResponse<PageResult<AuditEntry>>> Audit(int page = 1)
    {
        return Result(await site.AuditAsync(page));
    }
}

/// <summary>Anonymous read-only content plus moderated comment submission.</summary>
[Route("api/v1/public")]
public sealed class PublicController(ContentService content, SiteService site, ThemeService themes) : ApiController
{
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
        var file = await service.ReadAsync(id, User.Identity?.IsAuthenticated == true);
        Response.Headers.CacheControl = "no-store";
        return file.ContentType == "application/pdf"
            ? PhysicalFile(file.Path, file.ContentType, file.Name)
            : PhysicalFile(file.Path, file.ContentType, true);
    }
}