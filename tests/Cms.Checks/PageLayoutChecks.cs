using System.Text.Json;
using Cms.Data;
using Cms.Services;

/// <summary>Exact prior-schema fixture for isolated page-builder migration checks.</summary>
public static class PageLayoutChecks
{
    /// <summary>Create schema 9 with neither layout nor home-page columns.</summary>
    public static async Task CreateV9Async(CmsRepository repo, IFreeSql db)
    {
        db.CodeFirst.ConfigEntity<Content>(table => { table.Property(x => x.LayoutJson).IsIgnore(true); table.Property(x => x.DraftSlug).IsIgnore(true); table.Property(x => x.SeoJson).IsIgnore(true); table.Property(x => x.FieldsJson).IsIgnore(true); });
        db.CodeFirst.ConfigEntity<Asset>(table => { table.Property(x => x.Group).IsIgnore(true); table.Property(x => x.Version).IsIgnore(true); });
        db.CodeFirst.ConfigEntity<CustomerLead>(table => table.Property(x => x.FieldsJson).IsIgnore(true));
        db.CodeFirst.ConfigEntity<SiteSettings>(table => table.Property(x => x.HomePageId).IsIgnore(true));
        db.CodeFirst.SyncStructure(typeof(CmsUser), typeof(Content), typeof(Taxonomy), typeof(Asset), typeof(Comment),
            typeof(MenuItem), typeof(SiteSettings), typeof(AuditEntry), typeof(SchemaVersion), typeof(ThemeState),
            typeof(AccessToken), typeof(IntegrationRequest), typeof(VisitorProfile), typeof(PageVisit), typeof(ContentTraffic),
            typeof(VisitEvent), typeof(CustomerLead), typeof(ContentRevision), typeof(LeadFollowUp), typeof(ContentAudience), typeof(MaintenanceState));
        await repo.InsertAsync(new SchemaVersion { Id = "schema", Version = 9 });
        var content = new Content { Id = new string('9', 32), Kind = "page", Slug = "before-builder", Title = "原有独立页面",
            Html = "<p>原有正文</p>", Version = 7, Published = true, PublishedTitle = "原有独立页面", PublishedAt = DateTime.UtcNow };
        content.PublishedJson = JsonSerializer.Serialize(ContentService.Draft(content));
        await repo.InsertAsync(content);
        if (db.DbFirst.GetTableByName("cms_content").Columns.Any(x => x.Name.Equals("LayoutJson", StringComparison.OrdinalIgnoreCase)) ||
            db.DbFirst.GetTableByName("cms_settings").Columns.Any(x => x.Name.Equals("HomePageId", StringComparison.OrdinalIgnoreCase)))
            throw new Exception("Fixture unexpectedly includes page-builder columns.");
    }
}
