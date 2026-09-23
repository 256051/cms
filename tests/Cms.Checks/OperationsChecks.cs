using Cms.Data;
using Cms.Services;
using Microsoft.AspNetCore.Identity;
using Microsoft.Extensions.Configuration;

/// <summary>Prior-schema fixture for operational feature migrations.</summary>
public static class OperationsChecks
{
    /// <summary>Verify absent maintenance settings, explicit zero and deployment overrides.</summary>
    public static async Task CheckDefaultsAsync(CmsRepository repo)
    {
        await repo.InitializeSchemaAsync(allowCreate: true);
        var config = new ConfigurationBuilder().AddInMemoryCollection().Build();
        var service = new MaintenanceService(repo, config);
        var defaults = await service.StatusAsync();
        if ((defaults.BackupIntervalHours, defaults.BackupKeepCount, defaults.BackupRetentionDays) != (24, 14, 30))
            throw new Exception("Missing maintenance settings did not use defaults.");
        foreach (var key in new[] { "BackupIntervalHours", "BackupKeepCount", "BackupRetentionDays" })
            config["Maintenance:" + key] = "0";
        var disabled = await service.StatusAsync();
        if ((disabled.BackupIntervalHours, disabled.BackupKeepCount, disabled.BackupRetentionDays) != (0, 0, 0))
            throw new Exception("Explicit zero must disable the corresponding policy.");
        config["Maintenance:BackupIntervalHours"] = "12";
        config["Maintenance:BackupKeepCount"] = "3";
        config["Maintenance:BackupRetentionDays"] = "7";
        var custom = await service.StatusAsync();
        if ((custom.BackupIntervalHours, custom.BackupKeepCount, custom.BackupRetentionDays) != (12, 3, 7))
            throw new Exception("Configured maintenance values must override defaults.");
        Console.WriteLine("PASS: missing maintenance defaults, explicit zero and configured overrides");
    }

    /// <summary>Create schema 14 without reply or staff-email columns, retaining a real account and comment.</summary>
    public static async Task CreateV14Async(CmsRepository repo, IFreeSql db)
    {
        db.CodeFirst.ConfigEntity<CmsUser>(table => table.Property(x => x.Email).IsIgnore(true));
        db.CodeFirst.ConfigEntity<Comment>(table => {
            table.Property(x => x.Reply).IsIgnore(true); table.Property(x => x.ReplyBy).IsIgnore(true);
            table.Property(x => x.RepliedAt).IsIgnore(true);
        });
        db.CodeFirst.SyncStructure(typeof(CmsUser), typeof(Content), typeof(Taxonomy), typeof(Asset), typeof(Comment),
            typeof(MenuItem), typeof(SiteSettings), typeof(AuditEntry), typeof(SchemaVersion), typeof(ThemeState),
            typeof(AccessToken), typeof(IntegrationRequest), typeof(VisitorProfile), typeof(PageVisit), typeof(ContentTraffic),
            typeof(VisitEvent), typeof(CustomerLead), typeof(ContentRevision), typeof(LeadFollowUp), typeof(ContentAudience),
            typeof(MaintenanceState), typeof(NotificationDelivery), typeof(NotificationState), typeof(ContentRedirect), typeof(InquiryFormSettings));
        await repo.InsertAsync(new SchemaVersion { Id = "schema", Version = 14 });
        await repo.InsertAsync(new ThemeState { Id = "site" });
        var user = new CmsUser { Id = new string('a', 32), Username = "opsadmin", DisplayName = "原管理员", Role = "Admin" };
        user.PasswordHash = new PasswordHasher<CmsUser>().HashPassword(user, Environment.GetEnvironmentVariable("Setup__Password")!);
        await repo.InsertAsync(user);
        await repo.InsertAsync(new SiteSettings { Id = "site", Title = "原有站点" });
        await repo.InsertAsync(new Content { Id = new string('f', 32), Title = "迁移前文章", Slug = "legacy-operations" });
        await repo.InsertAsync(new Comment { Id = new string('c', 32), ContentId = new string('f', 32), Author = "原读者", Body = "原评论保持不变" });
        if (db.DbFirst.GetTableByName("cms_comments").Columns.Any(x => x.Name.Equals("Reply", StringComparison.OrdinalIgnoreCase)) ||
            db.DbFirst.GetTableByName("cms_users").Columns.Any(x => x.Name.Equals("Email", StringComparison.OrdinalIgnoreCase)))
            throw new Exception("Fixture unexpectedly includes schema 15 columns.");
    }
}
