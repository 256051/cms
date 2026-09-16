using Cms.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace Cms.Api;

/// <summary>Authenticated, CSRF-protected portable content downloads and atomic draft imports.</summary>
[Route("api/v1/admin/contents")]
[Authorize(AuthenticationSchemes = "cms", Roles = "Admin,Editor")]
public sealed class ContentTransferController(ContentService content, AssetService assets, IConfiguration configuration) : ApiController
{
    /// <summary>Download selected or filtered drafts and their required files as a ZIP package.</summary>
    [HttpPost("export")]
    public async Task<IActionResult> Export(ContentExportInput input, CancellationToken cancellation) =>
        File(await content.ExportPackageAsync(Actor, input, assets, cancellation), "application/zip",
            $"cms-{input.Kind}-{DateTime.UtcNow:yyyyMMdd-HHmmss}.zip");

    /// <summary>Import a matching content package into new drafts without replacing existing data.</summary>
    [HttpPost("import")]
    [RequestSizeLimit(55_000_000)]
    public async Task<ApiResponse<ContentImportResult>> Import([FromForm] string kind, IFormFile file, CancellationToken cancellation)
    {
        await using var stream = file.OpenReadStream();
        return Result(await content.ImportPackageAsync(Actor, kind, stream, configuration, cancellation));
    }
}
