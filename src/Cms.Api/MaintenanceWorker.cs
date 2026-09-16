using Cms.Services;

namespace Cms.Api;

/// <summary>Single-instance publication and maintenance scheduler.</summary>
public sealed class MaintenanceWorker(IServiceScopeFactory scopes, ILogger<MaintenanceWorker> logger) : BackgroundService
{
    /// <summary>Check elapsed publication times every thirty seconds, isolating maintenance failures.</summary>
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        using var timer = new PeriodicTimer(TimeSpan.FromSeconds(30));
        do
        {
            using var scope = scopes.CreateScope();
            var notifications = scope.ServiceProvider.GetRequiredService<NotificationService>();
            try { await scope.ServiceProvider.GetRequiredService<ContentService>().RunSchedulesAsync(async (row, error) => {
                logger.LogError(error, "Content schedule failed for {ContentId}.", row.Id);
                await notifications.ScheduleFailureAsync(row);
            }); }
            catch (Exception e) { logger.LogError(e, "Publication schedule failed."); }
            try { await scope.ServiceProvider.GetRequiredService<MaintenanceService>().RunAsync(); }
            catch (Exception e) { logger.LogError(e, "Site maintenance failed."); }
        } while (await timer.WaitForNextTickAsync(stoppingToken));
    }
}

/// <summary>Keep slow external delivery independent of publication and backup scheduling.</summary>
public sealed class NotificationWorker(IServiceScopeFactory scopes, ILogger<NotificationWorker> logger) : BackgroundService
{
    /// <summary>Collect and retry queued notifications without delaying publication checks.</summary>
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        using var timer = new PeriodicTimer(TimeSpan.FromSeconds(30));
        do
        {
            using var scope = scopes.CreateScope();
            try { await scope.ServiceProvider.GetRequiredService<NotificationService>().RunAsync(stoppingToken); }
            catch (Exception error) when (!stoppingToken.IsCancellationRequested) { logger.LogError(error, "Notification processing failed."); }
        } while (await timer.WaitForNextTickAsync(stoppingToken));
    }
}
