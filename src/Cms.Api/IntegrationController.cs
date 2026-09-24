using System.Security.Claims;
using Cms.Data;
using Cms.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;

namespace Cms.Api;

/// <summary>Header-authenticated content automation; every mutation requires an idempotency key.</summary>
[Route("api/v1/integration")]
[Authorize(AuthenticationSchemes = IntegrationAuthenticationHandler.SchemeName)]
[EnableRateLimiting("integration")]
[RequestSizeLimit(2_100_000)]
public sealed class IntegrationController(IntegrationService service) : ApiController
{
    private string TokenId => User.FindFirstValue("token_id")!;

    /// <summary>List drafts; requires content:read.</summary>
    [HttpGet("contents")]
    [Authorize(Policy = IntegrationScopes.Read)]
    public async Task<ApiResponse<PageResult<ContentView>>> List(string kind = "post", string? q = null, int page = 1)
    {
        return Result(await service.ListAsync(kind, q, page));
    }

    /// <summary>Get a draft and its version; requires content:read.</summary>
    [HttpGet("contents/{id}")]
    [Authorize(Policy = IntegrationScopes.Read)]
    public async Task<ApiResponse<ContentView>> Get(string id)
    {
        return Result(await service.GetAsync(id));
    }

    /// <summary>Read category and tag identifiers; requires content:read.</summary>
    [HttpGet("taxonomy")]
    [Authorize(Policy = IntegrationScopes.Read)]
    public async Task<ApiResponse<List<Taxonomy>>> Taxonomy()
    {
        return Result(await service.TaxonomyAsync());
    }

    /// <summary>Create a draft once; requires content:write and Idempotency-Key.</summary>
    [HttpPost("contents")]
    [Authorize(Policy = IntegrationScopes.Write)]
    public async Task<ApiResponse<ContentView>> Create(ContentInput input,
        [FromHeader(Name = "Idempotency-Key")] string? key)
    {
        return Result(await service.SaveAsync(TokenId, key ?? "", null, input));
    }

    /// <summary>Update the expected draft version once; requires content:write and Idempotency-Key.</summary>
    [HttpPut("contents/{id}")]
    [Authorize(Policy = IntegrationScopes.Write)]
    public async Task<ApiResponse<ContentView>> Save(string id, ContentInput input,
        [FromHeader(Name = "Idempotency-Key")] string? key)
    {
        return Result(await service.SaveAsync(TokenId, key ?? "", id, input));
    }

    /// <summary>Publish the expected version once; requires content:publish and Idempotency-Key.</summary>
    [HttpPost("contents/{id}/publish")]
    [Authorize(Policy = IntegrationScopes.Publish)]
    public async Task<ApiResponse<IntegrationPublication>> Publish(string id, ContentPublishInput input,
        [FromHeader(Name = "Idempotency-Key")] string? key)
    {
        return Result(await service.PublishAsync(TokenId, key ?? "", id, input));
    }

    /// <summary>Upload one validated file once; requires asset:upload and Idempotency-Key.</summary>
    [HttpPost("assets")]
    [Authorize(Policy = IntegrationScopes.Upload)]
    [RequestSizeLimit(55_000_000)]
    public async Task<ApiResponse<AssetView>> Upload(IFormFile file, [FromHeader(Name = "Idempotency-Key")] string? key,
        CancellationToken cancellation)
    {
        await using var stream = file.OpenReadStream();
        return Result(await service.UploadAsync(TokenId, key ?? "", file.FileName, stream, cancellation));
    }
}

/// <summary>Cookie-authenticated administrator management of machine credentials.</summary>
[Route("api/v1/admin/access-tokens")]
[Authorize(AuthenticationSchemes = "cms", Roles = "Admin")]
public sealed class AccessTokensController(AccessTokenService service) : ApiController
{
    /// <summary>Read paged token metadata; never returns the credential secret or hash.</summary>
    [HttpGet]
    public async Task<ApiResponse<PageResult<AccessTokenView>>> List(int page = 1)
    {
        return Result(await service.ListAsync(page));
    }

    /// <summary>Issue a credential and return its plaintext once.</summary>
    [HttpPost]
    public async Task<ApiResponse<IssuedAccessToken>> Create(AccessTokenInput input)
    {
        return Result(await service.CreateAsync(Actor, input));
    }

    /// <summary>Irreversibly revoke a token.</summary>
    [HttpPost("{id}/revoke")]
    public async Task<ApiResponse<bool>> Revoke(string id)
    {
        return Result(await service.RevokeAsync(Actor, id));
    }
}
