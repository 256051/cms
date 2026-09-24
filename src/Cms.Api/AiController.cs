using Cms.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;

namespace Cms.Api;

/// <summary>Authenticated AI proposals and administrator-only provider settings.</summary>
[Route("api/v1/admin/ai")]
[Authorize(AuthenticationSchemes = "cms", Roles = "Admin,Editor")]
[RequestSizeLimit(650_000)]
public sealed class AiController(AiSettingsService settings, AiWritingService writing) : ApiController
{
    /// <summary>Read editor-safe availability.</summary>
    [HttpGet("status")]
    public async Task<ApiResponse<AiStatus>> Status() => Result(await settings.StatusAsync());
    /// <summary>Read redacted provider settings.</summary>
    [HttpGet("configuration"), Authorize(Roles = "Admin")]
    public async Task<ApiResponse<AiConfigurationView>> Configuration() => Result(await settings.ViewAsync());
    /// <summary>Save encrypted provider settings to the database.</summary>
    [HttpPut("configuration"), Authorize(Roles = "Admin")]
    public async Task<ApiResponse<AiConfigurationView>> Save(AiOptions input) => Result(await settings.SaveAsync(Actor, input));
    /// <summary>Test saved settings by requesting actual text.</summary>
    [HttpPost("test"), Authorize(Roles = "Admin"), EnableRateLimiting("ai")]
    public async Task<ApiResponse<AiWritingResult>> Test(CancellationToken cancellation) => Result(await writing.TestAsync(cancellation));
    /// <summary>Generate a preview only; never saves or publishes content.</summary>
    [HttpPost("generate"), EnableRateLimiting("ai")]
    public async Task<ApiResponse<AiWritingResult>> Generate(AiWritingInput input, CancellationToken cancellation) => Result(await writing.GenerateAsync(input, cancellation));
}
