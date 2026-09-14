using System.Security.Claims;
using System.Text.Encodings.Web;
using Cms.Services;
using Microsoft.AspNetCore.Authentication;
using Microsoft.Extensions.Options;

namespace Cms.Api;

/// <summary>Header-only machine authentication, with no cookie fallback.</summary>
public sealed class IntegrationAuthenticationHandler(IOptionsMonitor<AuthenticationSchemeOptions> options, ILoggerFactory logger, UrlEncoder encoder, AccessTokenService tokens, IWebHostEnvironment environment)
    : AuthenticationHandler<AuthenticationSchemeOptions>(options, logger, encoder)
{
    /// <summary>Name used by integration endpoint policies.</summary>
    public const string SchemeName = "integration";
    /// <summary>Validate a bearer credential and construct only content automation claims.</summary>
    protected override async Task<AuthenticateResult> HandleAuthenticateAsync()
    {
        if (!Request.IsHttps && !environment.IsDevelopment()) return AuthenticateResult.Fail("HTTPS required");
        var header = Request.Headers.Authorization;
        if (header.Count != 1 || header[0] is not { } value || !value.StartsWith("Bearer ", StringComparison.OrdinalIgnoreCase)) return AuthenticateResult.NoResult();
        var token = await tokens.AuthenticateAsync(value[7..]);
        if (token == null) return AuthenticateResult.Fail("Invalid access token");
        var claims = new List<Claim> { new(ClaimTypes.NameIdentifier, token.UserId), new("token_id", token.Id), new("token_name", token.Name) };
        claims.AddRange(token.Scopes.Split(' ').Select(scope => new Claim("scope", scope)));
        return AuthenticateResult.Success(new AuthenticationTicket(new ClaimsPrincipal(new ClaimsIdentity(claims, SchemeName)), SchemeName));
    }
    /// <summary>Return a machine-readable challenge without redirecting to the login page.</summary>
    protected override async Task HandleChallengeAsync(AuthenticationProperties properties)
    {
        Response.StatusCode = 401; Response.Headers.WWWAuthenticate = "Bearer";
        await Response.WriteAsJsonAsync(new ApiResponse<object>("INVALID_ACCESS_TOKEN", "请通过 HTTPS 提供有效的访问令牌。", null, Context.TraceIdentifier));
    }
    /// <summary>Explain a missing integration permission without exposing credentials.</summary>
    protected override async Task HandleForbiddenAsync(AuthenticationProperties properties)
    {
        Response.StatusCode = 403;
        await Response.WriteAsJsonAsync(new ApiResponse<object>("INSUFFICIENT_SCOPE", "访问令牌没有执行此操作的权限。", null, Context.TraceIdentifier));
    }
}
