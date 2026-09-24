using Cms.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace Cms.Api;

/// <summary>Authenticated editorial operations for the configured WeChat account.</summary>
[Route("api/v1/admin/wechat")]
[Authorize(AuthenticationSchemes = "cms", Roles = "Admin,Editor")]
public sealed class WeChatController(WeChatDraftService service, WeChatSettingsService settings) : ApiController
{
    /// <summary>Read safe effective configuration status.</summary>
    [HttpGet("settings")]
    public async Task<ApiResponse<WeChatSettings>> Settings() => Result(await service.SettingsAsync());
    /// <summary>Read the administrator's redacted account configuration.</summary>
    [HttpGet("configuration"), Authorize(Roles = "Admin")]
    public async Task<ApiResponse<WeChatConfigurationView>> Configuration() => Result(await settings.ViewAsync());
    /// <summary>Encrypt and persist account settings; ordinary editors cannot change credentials.</summary>
    [HttpPut("configuration"), Authorize(Roles = "Admin")]
    public async Task<ApiResponse<WeChatConfigurationView>> Save(WeChatOptions input) => Result(await settings.SaveAsync(Actor, input));
    /// <summary>Read the article's recent synchronization results.</summary>
    [HttpGet("contents/{id}")]
    public async Task<ApiResponse<IReadOnlyList<WeChatDraftView>>> History(string id) => Result(await service.HistoryAsync(id));
    /// <summary>Queue one frozen website version for synchronization and optional configured automatic publication.</summary>
    [HttpPost("contents/{id}")]
    public async Task<ApiResponse<WeChatDraftView>> Queue(string id, VersionInput input) => Result(await service.QueueAsync(Actor, id, input.Version));
    /// <summary>Retry a definitively failed operation.</summary>
    [HttpPost("{id}/retry")]
    public async Task<ApiResponse<bool>> Retry(string id) => Result(await service.RetryAsync(Actor, id));
}

/// <summary>Isolate WeChat network delays from website publication and maintenance.</summary>
public sealed class WeChatWorker(IServiceScopeFactory scopes, ILogger<WeChatWorker> logger) : BackgroundService
{
    /// <summary>Process a bounded batch every thirty seconds.</summary>
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        using var timer = new PeriodicTimer(TimeSpan.FromSeconds(30));
        do
        {
            using var scope = scopes.CreateScope();
            try { await scope.ServiceProvider.GetRequiredService<WeChatDraftService>().RunAsync(stoppingToken); }
            catch (Exception) when (!stoppingToken.IsCancellationRequested) { logger.LogError("WeChat processing failed; inspect delivery records and database availability."); }
        } while (await timer.WaitForNextTickAsync(stoppingToken));
    }
}
