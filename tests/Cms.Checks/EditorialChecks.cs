using Cms.Data;
using Cms.Services;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging.Abstractions;

/// <summary>Focused data-loss checks using only the explicitly configured isolated test database.</summary>
public static class EditorialChecks
{
    /// <summary>Create the actual previous schema without any newly introduced columns or tables.</summary>
    public static async Task CreateV8Async(CmsRepository repo, IFreeSql db)
    {
        db.CodeFirst.ConfigEntity<Content>(table =>
        {
            table.Property(x => x.DeletedAt).IsIgnore(true); table.Property(x => x.LastPublishedAt).IsIgnore(true);
            table.Property(x => x.ScheduledPublishAt).IsIgnore(true); table.Property(x => x.ScheduledUnpublishAt).IsIgnore(true);
            table.Property(x => x.ScheduledJson).IsIgnore(true); table.Property(x => x.PublishedText).IsIgnore(true);
            table.Property(x => x.LayoutJson).IsIgnore(true); table.Property(x => x.DraftSlug).IsIgnore(true); table.Property(x => x.SeoJson).IsIgnore(true); table.Property(x => x.FieldsJson).IsIgnore(true);
        });
        db.CodeFirst.ConfigEntity<SiteSettings>(table => table.Property(x => x.HomePageId).IsIgnore(true));
        db.CodeFirst.ConfigEntity<CustomerLead>(table =>
        {
            table.Property(x => x.FieldsJson).IsIgnore(true);
            table.Property(x => x.OwnerId).IsIgnore(true); table.Property(x => x.NextContactAt).IsIgnore(true);
        });
        db.CodeFirst.SyncStructure(typeof(CmsUser), typeof(Content), typeof(Taxonomy), typeof(Asset), typeof(Comment),
            typeof(MenuItem), typeof(SiteSettings), typeof(AuditEntry), typeof(SchemaVersion), typeof(ThemeState),
            typeof(AccessToken), typeof(IntegrationRequest), typeof(VisitorProfile), typeof(PageVisit), typeof(ContentTraffic),
            typeof(VisitEvent), typeof(CustomerLead));
        await repo.InsertAsync(new SchemaVersion { Id = "schema", Version = 8 });
        var row = new Content { Id = new string('4', 32), Slug = "v8-fixture", Title = "旧稿", Html = "<p>升级前正文关键词</p>",
            Published = true, PublishedAt = new DateTime(2020, 1, 1, 0, 0, 0, DateTimeKind.Utc), PublishedTitle = "旧稿", Version = 7 };
        row.PublishedJson = System.Text.Json.JsonSerializer.Serialize(ContentService.Draft(row));
        await repo.InsertAsync(row);
        await repo.InsertAsync(new VisitorProfile { Id = new string('5', 32), Views = 1 });
        await repo.InsertAsync(new ContentTraffic { Id = row.Id, Views = 1 });
        await repo.InsertAsync(new PageVisit { Id = new string('6', 32), ContentId = row.Id, VisitorId = new string('5', 32) });
        if (db.DbFirst.GetTableByName("cms_content").Columns.Any(x => x.Name.Equals("DeletedAt", StringComparison.OrdinalIgnoreCase)) ||
            db.DbFirst.ExistsTable("cms_content_revisions")) throw new Exception("Legacy fixture includes new schema.");
    }

    /// <summary>Check backfills and then remove only the known isolated fixture records.</summary>
    public static async Task VerifyV8Async(CmsRepository repo)
    {
        var id = new string('4', 32);
        var row = (await repo.FindAsync<Content>(id))!;
        if (!await repo.ReadyAsync() || row.Version != 7 || row.LastPublishedAt != row.PublishedAt ||
            !row.PublishedText.Contains("升级前正文关键词") || await repo.CountAsync<ContentAudience>(x => x.ContentId == id) != 1)
            throw new Exception("v8 upgrade failed to preserve and backfill content.");
        foreach (var audience in await repo.ListAsync<ContentAudience>(x => x.ContentId == id)) await repo.DeleteAsync<ContentAudience>(audience.Id);
        await repo.DeleteAsync<PageVisit>(new string('6', 32)); await repo.DeleteAsync<VisitorProfile>(new string('5', 32));
        await repo.DeleteAsync<ContentTraffic>(id); await repo.DeleteAsync<Content>(id);
        Console.WriteLine("PASS: actual v8 schema upgrades with published body, first date and lifetime audience preserved");
    }

    /// <summary>Verify retention, elapsed publication windows and durable backup failures.</summary>
    public static async Task RunAsync(CmsRepository repo)
    {
        var root = Environment.GetEnvironmentVariable("CMS_TEST_MAINTENANCE_ROOT") ?? throw new InvalidOperationException("Explicit test storage required.");
        Directory.CreateDirectory(root);
        var old = TrafficService.TodayUtc().AddDays(-100);
        var visitor = new VisitorProfile { Views = 5, LastSeenAt = old, IpAddress = "1.1.1.1", Location = "历史地区" };
        var content = new Content { Slug = "retention-" + Guid.NewGuid().ToString("N"), Title = "保留累计阅读" };
        await repo.InsertAsync(visitor); await repo.InsertAsync(content);
        await repo.InsertAsync(new ContentTraffic { Id = content.Id, Views = 5 });
        await repo.InsertAsync(new ContentAudience { ContentId = content.Id, VisitorId = visitor.Id });
        var visit = new PageVisit { ContentId = content.Id, VisitorId = visitor.Id, CreatedAt = old, Day = old.ToString("yyyy-MM-dd") };
        await repo.InsertAsync(visit);
        var evt = new VisitEvent { VisitId = visit.Id, Kind = "download", CreatedAt = old };
        await repo.InsertAsync(evt);
        var baselineViews = await repo.LifetimeViewsAsync();
        var config = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["Maintenance:BackupPath"] = Path.Combine(root, "blocked"),
            ["Maintenance:BackupIntervalHours"] = "0",
            ["Maintenance:TrafficRetentionDays"] = "90", ["Storage:Path"] = Path.Combine(root, "uploads"),
            ["Security:KeyPath"] = Path.Combine(root, "keys")
        }).Build();
        var maintenance = new MaintenanceService(repo, config);
        await maintenance.RunAsync();
        if (await repo.FindAsync<PageVisit>(visit.Id) != null || await repo.FindAsync<VisitEvent>(evt.Id) != null ||
            (await repo.FindAsync<VisitorProfile>(visitor.Id))!.IpAddress != "" || await repo.LifetimeViewsAsync() != baselineViews)
            throw new Exception("Retention lost lifetime counters or kept expired details.");
        var metrics = (await repo.ContentMetricsAsync([content.Id], TrafficService.TodayUtc())).Single();
        if (metrics.Views != 5 || metrics.Visitors != 1 || metrics.TodayViews != 0) throw new Exception("Lifetime content counters changed after cleanup.");
        var traffic = new TrafficService(repo, new IpLocationService(config, NullLogger<IpLocationService>.Instance));
        try { await traffic.ReportAsync(old.AddHours(8).ToString("yyyy-MM-dd"), old.AddHours(8).ToString("yyyy-MM-dd")); throw new Exception("Expired dates appeared as zero statistics."); }
        catch (CmsException e) when (e.Code == "TRAFFIC_EXPIRED") { }
        // A service that was down for the entire publication window must not briefly expose expired content.
        content.ScheduledPublishAt = DateTime.UtcNow.AddMinutes(-2);
        content.ScheduledUnpublishAt = DateTime.UtcNow.AddMinutes(-1);
        content.ScheduledJson = System.Text.Json.JsonSerializer.Serialize(ContentService.Draft(content));
        await repo.UpdateAsync(content);
        await new ContentService(repo, new ContentValidator()).RunSchedulesAsync();
        content = (await repo.FindAsync<Content>(content.Id))!;
        if (content.Published || content.ScheduledPublishAt != null || content.ScheduledUnpublishAt != null)
            throw new Exception("Expired publication window was not safely consumed.");
        await File.WriteAllTextAsync(Path.Combine(root, "blocked"), "not a directory");
        try { await maintenance.BackupAsync("test"); throw new Exception("Backup unexpectedly succeeded on a file path."); }
        catch (IOException) { }
        var state = (await maintenance.StatusAsync()).State;
        if (state.LastAttemptAt == null || state.Error == "") throw new Exception("Backup failure was not persisted.");
        config["Maintenance:BackupPath"] = Path.Combine(root, "scheduled");
        config["Maintenance:BackupIntervalHours"] = "24";
        config["Storage:Path"] = Environment.GetEnvironmentVariable("Storage__Path");
        config["Security:KeyPath"] = Environment.GetEnvironmentVariable("Security__KeyPath");
        state.LastAttemptAt = DateTime.UtcNow.AddDays(-2);
        await repo.UpdateAsync(state);
        maintenance = new MaintenanceService(repo, config);
        await maintenance.RunAsync();
        state = (await maintenance.StatusAsync()).State;
        if (state.Error != "" || state.LastSuccessAt < DateTime.UtcNow.AddMinutes(-1)) throw new Exception("Due backup did not run.");
        await maintenance.RunAsync();
        if (Directory.GetFiles(config["Maintenance:BackupPath"]!, "*.zip").Length != 1) throw new Exception("Backup interval was ignored.");
        Console.WriteLine("PASS: retention preserves lifetime counts, expired windows stay private, backup failure is visible");
    }
}
