using Cms.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace Cms.Api;

/// <summary>Private administrative backup operations.</summary>
[Route("api/v1/admin/maintenance")]
[Authorize(AuthenticationSchemes = "cms", Roles = "Admin")]
public sealed class MaintenanceController(MaintenanceService maintenance) : ApiController
{
    /// <summary>Read schedule settings and the latest backup result.</summary>
    [HttpGet]
    public async Task<ApiResponse<MaintenanceView>> Status() => Result(await maintenance.StatusAsync());
    /// <summary>Create a complete portable backup.</summary>
    [HttpPost("backup")]
    public async Task<ApiResponse<MaintenanceView>> Backup() => Result(await maintenance.BackupAsync(Actor));
    /// <summary>List retained private backup archives.</summary>
    [HttpGet("files")]
    public async Task<ApiResponse<IReadOnlyList<BackupFile>>> Files() => Result(await maintenance.FilesAsync());
    /// <summary>Download a named archive or the last successful archive.</summary>
    [HttpGet("download")]
    public async Task<PhysicalFileResult> Download(string? name = null)
    {
        var file = await maintenance.DownloadAsync(name);
        Response.Headers.CacheControl = "no-store";
        return PhysicalFile(file.Path, file.ContentType, file.Name);
    }
}
