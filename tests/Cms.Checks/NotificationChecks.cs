using System.Text.Json;
using Cms.Data;
using Cms.Services;
using Microsoft.Extensions.Configuration;

/// <summary>Notification checks require loopback receivers and an explicitly isolated database.</summary>
public static class NotificationChecks
{
    /// <summary>Exercise all event sources, transport failures, retry, deduplication and obsolete alerts.</summary>
    public static async Task RunAsync(CmsRepository repo)
    {
        var config = new ConfigurationBuilder().AddEnvironmentVariables().Build();
        if (!new Uri(config["Notifications:WeCom:WebhookUrl"]!).IsLoopback || config["Notifications:Email:Host"] != "127.0.0.1")
            throw new Exception("Only local notification receivers are allowed in acceptance checks.");
        var service = new NotificationService(repo, config);
        if (service.Settings().Errors.Length != 0) throw new Exception("Notification configuration invalid.");
        await repo.InsertAsync(new NotificationState { Id = "site", CreatedAt = DateTime.UtcNow.AddDays(-1) });
        var lead = new CustomerLead { Name = "不会发送的姓名", Contact = "private@example.invalid", NextContactAt = DateTime.UtcNow.AddMinutes(-10) };
        await repo.InsertAsync(lead);
        var backupDir = Path.Combine(Path.GetDirectoryName(config["Security:KeyPath"])!, "blocked-backup");
        await File.WriteAllTextAsync(backupDir, "not a directory");
        config["Maintenance:BackupPath"] = backupDir;
        try { await new MaintenanceService(repo, config).BackupAsync("check"); throw new Exception("Expected backup failure."); }
        catch (IOException) { }
        var bad = new Content { Kind = "page", Slug = "bad-schedule", Title = "失败计划", ScheduledPublishAt = DateTime.UtcNow.AddMinutes(-1) };
        bad.ScheduledJson = JsonSerializer.Serialize(ContentService.Draft(bad) with { Layout = new PageLayout([
            new PageBlock(Guid.NewGuid().ToString("N"), "shared", SharedId: new string('f', 32))]) });
        await repo.InsertAsync(bad);
        var good = new Content { Slug = "good-schedule", Title = "正常计划", Html = "<p>正常内容</p>", ScheduledPublishAt = DateTime.UtcNow.AddMinutes(-1) };
        good.ScheduledJson = JsonSerializer.Serialize(ContentService.Draft(good));
        await repo.InsertAsync(good);
        var content = new ContentService(repo, new ContentValidator());
        await content.RunSchedulesAsync((row, _) => service.ScheduleFailureAsync(row));
        if (!(await repo.FindAsync<Content>(good.Id))!.Published) throw new Exception("One failed schedule blocked unrelated content.");
        await service.RunAsync();
        // Providers may render query cutoffs at whole-second precision; simulate the next scheduler tick.
        await Task.Delay(1100); await service.RunAsync();
        var rows = await repo.ListAsync<NotificationDelivery>();
        if (rows.Count != 8 || rows.Count(x => x.Status == "sent" && x.Channel == "email") != 4 ||
            rows.Count(x => x.Status == "failed" && x.Channel == "wecom" && x.NextAttemptAt != null) != 4)
            throw new Exception("Expected four SMTP deliveries and four retryable webhook failures: " + JsonSerializer.Serialize(rows));
        foreach (var row in rows.Where(x => x.Status == "failed")) await service.RetryAsync("check", row.Id);
        await Task.Delay(1100);
        await service.RunAsync();
        rows = await repo.ListAsync<NotificationDelivery>();
        if (rows.Any(x => x.Status != "sent") || rows.Where(x => x.Channel == "wecom").Any(x => x.Attempts != 2))
            throw new Exception("Retry did not deliver or preserve attempt totals.");
        await content.RunSchedulesAsync((row, _) => service.ScheduleFailureAsync(row));
        await service.RunAsync();
        if (await repo.CountAsync<NotificationDelivery>() != 8 || (await repo.ListAsync<NotificationDelivery>()).Sum(x => x.Attempts) != 12)
            throw new Exception("Repeated collection duplicated already delivered events.");
        try { await service.RetryAsync("check", rows[0].Id); throw new Exception("Sent event was resendable."); }
        catch (CmsException e) when (e.Code == "NOT_RETRYABLE") { }
        var stale = new NotificationDelivery { EventKey = "obsolete-overdue", Channel = "wecom", Kind = "lead-overdue", TargetId = lead.Id,
            OccurredAt = lead.NextContactAt!.Value, Title = "过期提醒", Path = "/admin/leads" };
        await repo.InsertAsync(stale);
        lead.Status = "completed"; await repo.UpdateAsync(lead);
        config["Notifications:Email:Enabled"] = "false";
        var dormant = Enumerable.Range(0, 10).Select(i => new NotificationDelivery { EventKey = "disabled-" + i, Channel = "email",
            Kind = "lead-new", TargetId = lead.Id, CreatedAt = DateTime.UtcNow.AddMinutes(1), NextAttemptAt = DateTime.UtcNow.AddMinutes(-1) }).ToArray();
        foreach (var row in dormant) await repo.InsertAsync(row);
        await Task.Delay(1100);
        await service.RunAsync();
        if ((await repo.FindAsync<NotificationDelivery>(stale.Id))!.Status != "cancelled") throw new Exception("Disabled channels blocked active delivery or resolved lead was notified.");
        foreach (var row in dormant) await repo.DeleteAsync<NotificationDelivery>(row.Id);
        config["Notifications:Enabled"] = "false";
        var before = await repo.CountAsync<NotificationDelivery>();
        await repo.InsertAsync(new CustomerLead()); await service.RunAsync();
        if (await repo.CountAsync<NotificationDelivery>() != before) throw new Exception("Disabled notifications queued new events.");
        Console.WriteLine("PASS: notifications all four sources, SMTP, WeCom errors/retry, deduplication, cancelled alerts and schedule failure isolation");
    }
}
