using Cms.Data;
using FreeSql;

if (args.Contains("--login-protection")) { LoginProtectionChecks.Run(); return; }

var type = Enum.Parse<DataType>(Environment.GetEnvironmentVariable("Database__Type")!);
if (type == DataType.Sqlite) SQLitePCL.Batteries_V2.Init();
using var db = new FreeSqlBuilder().UseConnectionString(type, Environment.GetEnvironmentVariable("Database__ConnectionString")!).UseAutoSyncStructure(false).Build();
var repo = new CmsRepository(db);
const string legacyAuditId = "11111111111111111111111111111111";
const string legacyContentId = "22222222222222222222222222222222";
if (args.Contains("--create-v1"))
{
    db.CodeFirst.SyncStructure(typeof(CmsUser), typeof(Content), typeof(Taxonomy), typeof(Asset), typeof(Comment), typeof(LegacyMenu), typeof(LegacySettings), typeof(LegacyAudit), typeof(SchemaVersion));
    await repo.InsertAsync(new SchemaVersion { Id = "schema", Version = 1 });
    await repo.InsertAsync(new LegacyAudit { Id = legacyAuditId, Actor = "旧版管理员", Action = "content.save" });
    await repo.InsertAsync(new Content { Id = legacyContentId, Slug = "v1-migration-proof", Title = "升级保留文章", Html = "<p>旧版中文与 🎉 正文</p>", Version = 7 });
    Console.WriteLine("PASS: version 1 fixture created");
    return;
}
if (args.Contains("--verify-v1"))
{
    if ((await repo.FindAsync<SchemaVersion>("schema"))?.Version != 1 || db.DbFirst.GetTableByName("cms_audit").Columns.Any(x => x.Name.Equals("TargetId", StringComparison.OrdinalIgnoreCase))) throw new Exception("Normal startup modified schema.");
    Console.WriteLine("PASS: normal startup left version 1 unchanged");
    return;
}
if (args.Contains("--verify-upgrade"))
{
    var old = await repo.FindAsync<AuditEntry>(legacyAuditId);
    var content = await repo.FindAsync<Content>(legacyContentId);
    if ((await repo.FindAsync<SchemaVersion>("schema"))?.Version != 5 || (await repo.FindAsync<ThemeState>("site"))?.ActiveThemeId != "classic" || old?.Actor != "旧版管理员" || !string.IsNullOrEmpty(old.TargetId) || content?.Html != "<p>旧版中文与 🎉 正文</p>" || content.Version != 7) throw new Exception("Upgrade did not preserve version 1 data.");
    await repo.DeleteAsync<Content>(legacyContentId); // Fixture cleanup in this isolated test database only.
    Console.WriteLine("PASS: v1 through v5 upgrade preserves historical audit and content");
    return;
}
if (args.Contains("--create-v2"))
{
    db.CodeFirst.SyncStructure(typeof(CmsUser), typeof(Content), typeof(Taxonomy), typeof(Asset), typeof(Comment), typeof(LegacyMenu), typeof(LegacySettings), typeof(AuditEntry), typeof(SchemaVersion));
    await repo.InsertAsync(new SchemaVersion { Id = "schema", Version = 2 });
    await repo.InsertAsync(new LegacySettings { Id = "site", Title = "版本 2 站点" });
    return;
}
if (args.Contains("--verify-v2"))
{
    if ((await repo.FindAsync<SchemaVersion>("schema"))?.Version != 2 || db.DbFirst.ExistsTable("cms_theme")) throw new Exception("Normal startup modified version 2 schema.");
    return;
}
if (args.Contains("--verify-v2-upgrade"))
{
    if ((await repo.FindAsync<SchemaVersion>("schema"))?.Version != 5 || (await repo.FindAsync<SiteSettings>("site"))?.Title != "版本 2 站点" || (await repo.FindAsync<ThemeState>("site"))?.ActiveThemeId != "classic") throw new Exception("Version 2 upgrade failed.");
    return;
}
if (args.Contains("--create-v3"))
{
    db.CodeFirst.SyncStructure(typeof(CmsUser), typeof(Content), typeof(Taxonomy), typeof(Asset), typeof(Comment), typeof(LegacyMenu), typeof(LegacySettings), typeof(AuditEntry), typeof(SchemaVersion), typeof(ThemeState));
    await repo.InsertAsync(new SchemaVersion { Id = "schema", Version = 3 });
    await repo.InsertAsync(new LegacyMenu { Id = "old-menu", Label = "旧导航中文", Url = "/pages/about", Sort = 7 });
    await repo.InsertAsync(new ThemeState { Id = "site", ActiveThemeId = "paper", Version = 7 });
    return;
}
if (args.Contains("--verify-v3"))
{
    if ((await repo.FindAsync<SchemaVersion>("schema"))?.Version != 3 || db.DbFirst.GetTableByName("cms_menu").Columns.Any(x => x.Name.Equals("ParentId", StringComparison.OrdinalIgnoreCase))) throw new Exception("Normal startup modified version 3 schema.");
    return;
}
if (args.Contains("--verify-v3-upgrade"))
{
    var menu = (await repo.FindAsync<MenuItem>("old-menu"))!;
    var theme = (await repo.FindAsync<ThemeState>("site"))!;
    if ((await repo.FindAsync<SchemaVersion>("schema"))?.Version != 5 || menu.Label != "旧导航中文" || menu.Url != "/pages/about" || menu.Sort != 7 || menu.Type != "custom" || menu.ParentId != "" || menu.TargetId != "" || menu.OpenInNewTab || menu.Version != 0 || theme.ActiveThemeId != "paper" || theme.Version != 7) throw new Exception("Menu upgrade did not preserve data and defaults.");
    return;
}
if (args.Contains("--create-v4"))
{
    db.CodeFirst.SyncStructure(typeof(CmsUser), typeof(Content), typeof(Taxonomy), typeof(Asset), typeof(Comment), typeof(MenuItem), typeof(LegacySettings), typeof(AuditEntry), typeof(SchemaVersion), typeof(ThemeState));
    await repo.InsertAsync(new SchemaVersion { Id = "schema", Version = 4 });
    await repo.InsertAsync(new LegacySettings { Id = "site", Title = "旧站设置 🎉", Description = "保留旧介绍", LogoId = "old-logo", Keywords = "内容,旧站" });
    await repo.InsertAsync(new MenuItem { Id = "old-menu", Label = "旧导航", Version = 8 });
    await repo.InsertAsync(new ThemeState { Id = "site", ActiveThemeId = "paper", Version = 7 });
    return;
}
if (args.Contains("--verify-v4"))
{
    if ((await repo.FindAsync<SchemaVersion>("schema"))?.Version != 4 || db.DbFirst.GetTableByName("cms_settings").Columns.Any(x => x.Name.Equals("Subtitle", StringComparison.OrdinalIgnoreCase))) throw new Exception("Normal startup modified version 4 schema.");
    return;
}
if (args.Contains("--verify-v4-upgrade"))
{
    var s = (await repo.FindAsync<SiteSettings>("site"))!;
    if ((await repo.FindAsync<SchemaVersion>("schema"))?.Version != 5 || s.Title != "旧站设置 🎉" || s.Description != "保留旧介绍" || s.LogoId != "old-logo" || s.Keywords != "内容,旧站" || s.Version != 0 || s.Subtitle != "" || s.FaviconId != "" || s.FooterText != "" || s.Language != "zh-CN" || s.HomePageSize != 12 || s.CategoryPageSize != 12 || s.TagPageSize != 12 || s.SearchPageSize != 12 || !s.CommentsEnabled || !s.RequireCommentApproval || s.BlockSearchEngines || s.CommentsRequireLogin || (await repo.FindAsync<MenuItem>("old-menu"))?.Version != 8 || (await repo.FindAsync<ThemeState>("site"))?.Version != 7) throw new Exception("Settings upgrade failed to preserve original fields and defaults.");
    return;
}
var id = Guid.NewGuid().ToString("N");
var before = await repo.CountAsync<AuditEntry>();
var originalTheme = (await repo.FindAsync<ThemeState>("site"))!;
try
{
    await repo.WriteAsync<bool>("check", "theme.apply", async r => {
        var theme = (await r.FindAsync<ThemeState>("site"))!;
        theme.ActiveThemeId = "midnight"; theme.ProfilesJson = "{}";
        await r.SaveThemeAsync(theme, theme.Version);
        r.SetAuditTarget("theme", "midnight", "暗色科技");
        await r.InsertAsync(new AuditEntry { Id = id, Action = "rollback-proof" });
        throw new InvalidOperationException("intentional");
    });
}
catch (InvalidOperationException e) when (e.Message == "intentional") { }
var afterTheme = (await repo.FindAsync<ThemeState>("site"))!;
if (afterTheme.ActiveThemeId != originalTheme.ActiveThemeId || afterTheme.Version != originalTheme.Version || afterTheme.ProfilesJson != originalTheme.ProfilesJson || await repo.CountAsync<AuditEntry>() != before) throw new Exception("Theme and audit rollback failed.");
var originalSettings = (await repo.FindAsync<SiteSettings>("site"))!;
try
{
    await repo.WriteAsync<bool>("check", "settings.save", async r => {
        var settings = (await r.FindAsync<SiteSettings>("site"))!;
        settings.Subtitle = "不应写入"; settings.CommentsEnabled = !settings.CommentsEnabled;
        await r.SaveSettingsAsync(settings, settings.Version);
        r.SetAuditTarget("settings", "site", settings.Title);
        await r.InsertAsync(new AuditEntry { Action = "settings-rollback-proof" });
        throw new InvalidOperationException("intentional");
    });
}
catch (InvalidOperationException e) when (e.Message == "intentional") { }
var rolledSettings = (await repo.FindAsync<SiteSettings>("site"))!;
if (rolledSettings.Subtitle != originalSettings.Subtitle || rolledSettings.Version != originalSettings.Version || rolledSettings.CommentsEnabled != originalSettings.CommentsEnabled || await repo.CountAsync<AuditEntry>() != before) throw new Exception("Settings and audit rollback failed.");
await repo.InsertAsync(new MenuItem { Id = id, Label = "事务回滚菜单" });
try
{
    await repo.WriteAsync<bool>("check", "menu.save", async r => {
        var menu = (await r.FindAsync<MenuItem>(id))!; menu.Label = "不能保存的名称";
        await r.SaveMenuAsync(menu, 0); r.SetAuditTarget("menu", id, menu.Label);
        await r.InsertAsync(new AuditEntry { Action = "menu-rollback-proof" });
        throw new InvalidOperationException("intentional");
    });
}
catch (InvalidOperationException e) when (e.Message == "intentional") { }
var rolledMenu = (await repo.FindAsync<MenuItem>(id))!;
if (rolledMenu.Label != "事务回滚菜单" || rolledMenu.Version != 0 || await repo.CountAsync<AuditEntry>() != before) throw new Exception("Menu and audit rollback failed.");
await repo.DeleteAsync<MenuItem>(id);
try
{
    await repo.WriteAsync<bool>("check", "rollback", async r => { await r.InsertAsync(new Taxonomy { Id = id, Name = "回滚测试", Slug = id }); throw new InvalidOperationException("intentional"); });
}
catch (InvalidOperationException e) when (e.Message == "intentional") { }
if (await repo.FindAsync<Taxonomy>(id) != null || await repo.CountAsync<AuditEntry>() != before) throw new Exception("Transaction rollback failed.");
var slug = Guid.NewGuid().ToString("N");
await repo.InsertAsync(new Taxonomy { Id = id, Slug = slug, Name = "唯一约束" });
var rejected = false;
try { await repo.InsertAsync(new Taxonomy { Slug = slug, Name = "重复" }); } catch { rejected = true; }
if (!rejected) throw new Exception("Database unique index not enforced.");
await repo.DeleteAsync<Taxonomy>(id);
Console.WriteLine("PASS: database rollback, audit rollback, unique index");

/// <summary>Exact audit table shape shipped in schema version 1.</summary>
[FreeSql.DataAnnotations.Table(Name = "cms_audit")]
public class LegacyAudit : Entity
{
    /// <summary>Version 1 actor text.</summary>
    [FreeSql.DataAnnotations.Column(StringLength = 160)] public string Actor { get; set; } = "";
    /// <summary>Version 1 action text.</summary>
    [FreeSql.DataAnnotations.Column(StringLength = 120)] public string Action { get; set; } = "";
}

/// <summary>Exact flat navigation shape shipped through schema version 3.</summary>
[FreeSql.DataAnnotations.Table(Name = "cms_menu")]
public class LegacyMenu : Entity
{
    /// <summary>Original visible label.</summary>
    [FreeSql.DataAnnotations.Column(StringLength = 60)] public string Label { get; set; } = "";
    /// <summary>Original destination.</summary>
    [FreeSql.DataAnnotations.Column(StringLength = 500)] public string Url { get; set; } = "/";
    /// <summary>Original order.</summary>
    public int Sort { get; set; }
}

/// <summary>Exact site settings table shipped through schema 4.</summary>
[FreeSql.DataAnnotations.Table(Name = "cms_settings")]
public class LegacySettings : Entity
{
    /// <summary>Original title.</summary>
    [FreeSql.DataAnnotations.Column(StringLength = 100)] public string Title { get; set; } = "";
    /// <summary>Original description.</summary>
    [FreeSql.DataAnnotations.Column(StringLength = 500)] public string Description { get; set; } = "";
    /// <summary>Original logo identifier.</summary>
    [FreeSql.DataAnnotations.Column(StringLength = 32)] public string LogoId { get; set; } = "";
    /// <summary>Original search keywords.</summary>
    [FreeSql.DataAnnotations.Column(StringLength = 300)] public string Keywords { get; set; } = "";
}
