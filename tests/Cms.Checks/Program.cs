using Cms.Data;
using Cms.Services;
using FreeSql;
using FreeSql.DataAnnotations;
using SQLitePCL;

if (args.Contains("--ai-writing"))
{
    await AiWritingChecks.RunAsync();
    return;
}

if (args.Contains("--wechat"))
{
    WeChatFormattingChecks.Run();
    await WeChatChecks.RunAsync();
    return;
}

if (args.Contains("--wechat-layout-preview"))
{
    Console.Write(WeChatFormattingChecks.Run());
    return;
}

if (args.Contains("--geolocation"))
{
    IpLocationChecks.Run();
    return;
}

if (args.Contains("--login-protection"))
{
    LoginProtectionChecks.Run();
    return;
}

if (args.Contains("--rich-text"))
{
    const string sample =
        "<p><span style=\"color: #c026d3\">color</span><mark data-color=\"#fef08a\" style=\"background-color: #fef08a; color: inherit\">highlight</mark></p>";
    var safe = ContentHtml.Sanitize(sample);
    if (!safe.Contains("color: rgba(192, 38, 211, 1)") || !safe.Contains("background-color: rgba(254, 240, 138, 1)") ||
        ContentHtml.Sanitize(safe) != safe)
        throw new Exception("Colors did not survive the sanitizer round trip: " + safe);
    var unsafeStyle =
        ContentHtml.Sanitize(
            "<span style=\"color: rgba(999, 0, 0, 0); background: url(https://example.com); position: fixed\">text</span>");
    if (unsafeStyle.Contains("style=")) throw new Exception("Unsafe or transparent styles retained.");
    if (!ContentHtml.IsEmbedUrl("https://example.com/path") || ContentHtml.IsEmbedUrl("https://host.local.") ||
        ContentHtml.IsEmbedUrl("https://local.") ||
        ContentHtml.IsEmbedUrl("https://127.0.0.1")) throw new Exception("Embed URL validation failed.");
    Console.WriteLine(
        "PASS: opaque colors and highlight survive repeated sanitization; unsafe CSS and local embed URLs rejected");
    return;
}

var type = Enum.Parse<DataType>(Environment.GetEnvironmentVariable("Database__Type")!);
if (type == DataType.Sqlite) Batteries_V2.Init();
using var db = new FreeSqlBuilder()
    .UseConnectionString(type, Environment.GetEnvironmentVariable("Database__ConnectionString")!)
    .UseAutoSyncStructure(false).Build();
var repo = new CmsRepository(db);
if (args.Contains("--commerce"))
{
    await CommerceChecks.RunAsync(repo);
    return;
}
if (args.Contains("--maintenance-defaults"))
{
    await OperationsChecks.CheckDefaultsAsync(repo);
    return;
}
if (args.Contains("--create-v14-operations"))
{
    await OperationsChecks.CreateV14Async(repo, db);
    return;
}
if (args.Contains("--notifications"))
{
    await NotificationChecks.RunAsync(repo);
    return;
}
if (args.Contains("--create-v9"))
{
    await PageLayoutChecks.CreateV9Async(repo, db);
    return;
}
if (args.Contains("--create-v8"))
{
    await EditorialChecks.CreateV8Async(repo, db);
    return;
}
if (args.Contains("--verify-v8-upgrade"))
{
    await EditorialChecks.VerifyV8Async(repo);
    return;
}
if (args.Contains("--editorial-maintenance"))
{
    await EditorialChecks.RunAsync(repo);
    return;
}
if (args.Contains("--create-v7"))
{
    await IpLocationChecks.CreateV7Async(repo, db);
    return;
}
if (args.Contains("--verify-v7-upgrade"))
{
    await IpLocationChecks.VerifyV7Async(repo);
    return;
}
if (args.Contains("--create-v6"))
{
    db.CodeFirst.SyncStructure(typeof(CmsUser), typeof(Content), typeof(Taxonomy), typeof(Asset), typeof(Comment),
        typeof(MenuItem), typeof(SiteSettings), typeof(AuditEntry), typeof(SchemaVersion), typeof(ThemeState),
        typeof(AccessToken), typeof(IntegrationRequest));
    await repo.InsertAsync(new SchemaVersion { Id = "schema", Version = 6 });
    await repo.InsertAsync(new Content { Id = "v6-original", Slug = "v6-original", Html = "<p>原文章保留</p>", Version = 17 });
    return;
}
if (args.Contains("--verify-v6-upgrade"))
{
    if (!await repo.ReadyAsync() || (await repo.FindAsync<Content>("v6-original"))?.Version != 17 ||
        (await repo.FindAsync<Content>("v6-original"))?.Html != "<p>原文章保留</p>" || await repo.CountAsync<PageVisit>() != 0 ||
        await repo.CountAsync<CustomerLead>() != 0) throw new Exception("v6 upgrade failed to preserve content.");
    Console.WriteLine("PASS: repeatable additive v6 to v8 upgrade");
    return;
}
if (args.Contains("--integration"))
{
    await IntegrationChecks.RunAsync(repo);
    return;
}

if (args.Contains("--create-v5"))
{
    db.CodeFirst.SyncStructure(typeof(CmsUser), typeof(Content), typeof(Taxonomy), typeof(Asset), typeof(Comment),
        typeof(MenuItem), typeof(SiteSettings), typeof(LegacyV5Audit), typeof(SchemaVersion), typeof(ThemeState));
    await repo.InsertAsync(new SchemaVersion { Id = "schema", Version = 5 });
    await repo.InsertAsync(new SiteSettings
    {
        Id = "site", Title = "v5 站点", Subtitle = "不可重置", FooterText = "自定义版权", CommentsEnabled = false,
        HomePageSize = 7, Version = 19
    });
    await repo.InsertAsync(new CmsUser
    {
        Id = "v5-admin", Username = "original", DisplayName = "原管理员", PasswordHash = "preserve-this-hash",
        SecurityStamp = "original-stamp", Role = "Admin"
    });
    await repo.InsertAsync(new Content { Id = "v5-content", Slug = "v5-original", Html = "<p>保留正文</p>", Version = 12 });
    await repo.InsertAsync(new LegacyV5Audit
    {
        Id = "v5-audit", Actor = "原管理员", Action = "content.save", TargetType = "post", TargetId = "v5-content",
        TargetName = "原文章"
    });
    return;
}

if (args.Contains("--verify-v5"))
{
    if ((await repo.FindAsync<SchemaVersion>("schema"))?.Version != 5 || db.DbFirst.ExistsTable("cms_access_tokens") ||
        db.DbFirst.GetTableByName("cms_audit").Columns
            .Any(x => x.Name.Equals("TokenId", StringComparison.OrdinalIgnoreCase)))
        throw new Exception("Normal startup changed v5 schema.");
    return;
}

if (args.Contains("--verify-v5-upgrade"))
{
    var settings = (await repo.FindAsync<SiteSettings>("site"))!;
    var account = (await repo.FindAsync<CmsUser>("v5-admin"))!;
    var audit = (await repo.FindAsync<AuditEntry>("v5-audit"))!;
    if ((await repo.FindAsync<SchemaVersion>("schema"))?.Version != CmsRepository.CurrentSchemaVersion || settings.Subtitle != "不可重置" ||
        settings.FooterText != "自定义版权" || settings.CommentsEnabled || settings.HomePageSize != 7 ||
        settings.Version != 19 || account.PasswordHash != "preserve-this-hash" ||
        account.SecurityStamp != "original-stamp" || audit.TargetName != "原文章" ||
        !string.IsNullOrEmpty(audit.TokenId) || !string.IsNullOrEmpty(audit.TokenName) ||
        (await repo.FindAsync<Content>("v5-content"))?.Version != 12 || await repo.CountAsync<AccessToken>() != 0 ||
        await repo.CountAsync<IntegrationRequest>() != 0) throw new Exception("v5 to v8 did not preserve data.");
    return;
}

const string legacyAuditId = "11111111111111111111111111111111";
const string legacyContentId = "22222222222222222222222222222222";
if (args.Contains("--create-v1"))
{
    db.CodeFirst.SyncStructure(typeof(CmsUser), typeof(Content), typeof(Taxonomy), typeof(Asset), typeof(Comment),
        typeof(LegacyMenu), typeof(LegacySettings), typeof(LegacyAudit), typeof(SchemaVersion));
    await repo.InsertAsync(new SchemaVersion { Id = "schema", Version = 1 });
    await repo.InsertAsync(new LegacyAudit { Id = legacyAuditId, Actor = "旧版管理员", Action = "content.save" });
    await repo.InsertAsync(new Content
    {
        Id = legacyContentId, Slug = "v1-migration-proof", Title = "升级保留文章", Html = "<p>旧版中文与 🎉 正文</p>", Version = 7
    });
    Console.WriteLine("PASS: version 1 fixture created");
    return;
}

if (args.Contains("--verify-v1"))
{
    if ((await repo.FindAsync<SchemaVersion>("schema"))?.Version != 1 || db.DbFirst.GetTableByName("cms_audit").Columns
            .Any(x => x.Name.Equals("TargetId", StringComparison.OrdinalIgnoreCase)))
        throw new Exception("Normal startup modified schema.");
    Console.WriteLine("PASS: normal startup left version 1 unchanged");
    return;
}

if (args.Contains("--verify-upgrade"))
{
    var old = await repo.FindAsync<AuditEntry>(legacyAuditId);
    var content = await repo.FindAsync<Content>(legacyContentId);
    if ((await repo.FindAsync<SchemaVersion>("schema"))?.Version != CmsRepository.CurrentSchemaVersion ||
        (await repo.FindAsync<ThemeState>("site"))?.ActiveThemeId != "classic" || old?.Actor != "旧版管理员" ||
        !string.IsNullOrEmpty(old.TargetId) || content?.Html != "<p>旧版中文与 🎉 正文</p>" ||
        content.Version != 7) throw new Exception("Upgrade did not preserve version 1 data.");
    await repo.DeleteAsync<Content>(legacyContentId); // Fixture cleanup in this isolated test database only.
    Console.WriteLine("PASS: v1 through v7 upgrade preserves historical audit and content");
    return;
}

if (args.Contains("--create-v2"))
{
    db.CodeFirst.SyncStructure(typeof(CmsUser), typeof(Content), typeof(Taxonomy), typeof(Asset), typeof(Comment),
        typeof(LegacyMenu), typeof(LegacySettings), typeof(AuditEntry), typeof(SchemaVersion));
    await repo.InsertAsync(new SchemaVersion { Id = "schema", Version = 2 });
    await repo.InsertAsync(new LegacySettings { Id = "site", Title = "版本 2 站点" });
    return;
}

if (args.Contains("--verify-v2"))
{
    if ((await repo.FindAsync<SchemaVersion>("schema"))?.Version != 2 || db.DbFirst.ExistsTable("cms_theme"))
        throw new Exception("Normal startup modified version 2 schema.");
    return;
}

if (args.Contains("--verify-v2-upgrade"))
{
    if ((await repo.FindAsync<SchemaVersion>("schema"))?.Version != CmsRepository.CurrentSchemaVersion ||
        (await repo.FindAsync<SiteSettings>("site"))?.Title != "版本 2 站点" ||
        (await repo.FindAsync<ThemeState>("site"))?.ActiveThemeId != "classic")
        throw new Exception("Version 2 upgrade failed.");
    return;
}

if (args.Contains("--create-v3"))
{
    db.CodeFirst.SyncStructure(typeof(CmsUser), typeof(Content), typeof(Taxonomy), typeof(Asset), typeof(Comment),
        typeof(LegacyMenu), typeof(LegacySettings), typeof(AuditEntry), typeof(SchemaVersion), typeof(ThemeState));
    await repo.InsertAsync(new SchemaVersion { Id = "schema", Version = 3 });
    await repo.InsertAsync(new LegacyMenu { Id = "old-menu", Label = "旧导航中文", Url = "/pages/about", Sort = 7 });
    await repo.InsertAsync(new ThemeState { Id = "site", ActiveThemeId = "paper", Version = 7 });
    return;
}

if (args.Contains("--verify-v3"))
{
    if ((await repo.FindAsync<SchemaVersion>("schema"))?.Version != 3 || db.DbFirst.GetTableByName("cms_menu").Columns
            .Any(x => x.Name.Equals("ParentId", StringComparison.OrdinalIgnoreCase)))
        throw new Exception("Normal startup modified version 3 schema.");
    return;
}

if (args.Contains("--verify-v3-upgrade"))
{
    var menu = (await repo.FindAsync<MenuItem>("old-menu"))!;
    var theme = (await repo.FindAsync<ThemeState>("site"))!;
    if ((await repo.FindAsync<SchemaVersion>("schema"))?.Version != CmsRepository.CurrentSchemaVersion || menu.Label != "旧导航中文" ||
        menu.Url != "/pages/about" || menu.Sort != 7 || menu.Type != "custom" || menu.ParentId != "" ||
        menu.TargetId != "" || menu.OpenInNewTab || menu.Version != 0 || theme.ActiveThemeId != "paper" ||
        theme.Version != 7) throw new Exception("Menu upgrade did not preserve data and defaults.");
    return;
}

if (args.Contains("--create-v4"))
{
    db.CodeFirst.SyncStructure(typeof(CmsUser), typeof(Content), typeof(Taxonomy), typeof(Asset), typeof(Comment),
        typeof(MenuItem), typeof(LegacySettings), typeof(AuditEntry), typeof(SchemaVersion), typeof(ThemeState));
    await repo.InsertAsync(new SchemaVersion { Id = "schema", Version = 4 });
    await repo.InsertAsync(new LegacySettings
        { Id = "site", Title = "旧站设置 🎉", Description = "保留旧介绍", LogoId = "old-logo", Keywords = "内容,旧站" });
    await repo.InsertAsync(new MenuItem { Id = "old-menu", Label = "旧导航", Version = 8 });
    await repo.InsertAsync(new ThemeState { Id = "site", ActiveThemeId = "paper", Version = 7 });
    return;
}

if (args.Contains("--verify-v4"))
{
    if ((await repo.FindAsync<SchemaVersion>("schema"))?.Version != 4 || db.DbFirst.GetTableByName("cms_settings")
            .Columns.Any(x => x.Name.Equals("Subtitle", StringComparison.OrdinalIgnoreCase)))
        throw new Exception("Normal startup modified version 4 schema.");
    return;
}

if (args.Contains("--verify-v4-upgrade"))
{
    var s = (await repo.FindAsync<SiteSettings>("site"))!;
    if ((await repo.FindAsync<SchemaVersion>("schema"))?.Version != CmsRepository.CurrentSchemaVersion || s.Title != "旧站设置 🎉" ||
        s.Description != "保留旧介绍" || s.LogoId != "old-logo" || s.Keywords != "内容,旧站" || s.Version != 0 ||
        s.Subtitle != "" || s.FaviconId != "" || s.FooterText != "" || s.Language != "zh-CN" || s.HomePageSize != 12 ||
        s.CategoryPageSize != 12 || s.TagPageSize != 12 || s.SearchPageSize != 12 || !s.CommentsEnabled ||
        !s.RequireCommentApproval || s.BlockSearchEngines || s.CommentsRequireLogin ||
        (await repo.FindAsync<MenuItem>("old-menu"))?.Version != 8 ||
        (await repo.FindAsync<ThemeState>("site"))?.Version != 7)
        throw new Exception("Settings upgrade failed to preserve original fields and defaults.");
    return;
}

var id = Guid.NewGuid().ToString("N");
var before = await repo.CountAsync<AuditEntry>();
var originalTheme = (await repo.FindAsync<ThemeState>("site"))!;
try
{
    await repo.WriteAsync<bool>("check", "theme.apply", async r =>
    {
        var theme = (await r.FindAsync<ThemeState>("site"))!;
        theme.ActiveThemeId = "midnight";
        theme.ProfilesJson = "{}";
        await r.SaveThemeAsync(theme, theme.Version);
        r.SetAuditTarget("theme", "midnight", "暗色科技");
        await r.InsertAsync(new AuditEntry { Id = id, Action = "rollback-proof" });
        throw new InvalidOperationException("intentional");
    });
}
catch (InvalidOperationException e) when (e.Message == "intentional")
{
}

var afterTheme = (await repo.FindAsync<ThemeState>("site"))!;
if (afterTheme.ActiveThemeId != originalTheme.ActiveThemeId || afterTheme.Version != originalTheme.Version ||
    afterTheme.ProfilesJson != originalTheme.ProfilesJson ||
    await repo.CountAsync<AuditEntry>() != before) throw new Exception("Theme and audit rollback failed.");
var originalSettings = (await repo.FindAsync<SiteSettings>("site"))!;
try
{
    await repo.WriteAsync<bool>("check", "settings.save", async r =>
    {
        var settings = (await r.FindAsync<SiteSettings>("site"))!;
        settings.Subtitle = "不应写入";
        settings.CommentsEnabled = !settings.CommentsEnabled;
        await r.SaveSettingsAsync(settings, settings.Version);
        r.SetAuditTarget("settings", "site", settings.Title);
        await r.InsertAsync(new AuditEntry { Action = "settings-rollback-proof" });
        throw new InvalidOperationException("intentional");
    });
}
catch (InvalidOperationException e) when (e.Message == "intentional")
{
}

var rolledSettings = (await repo.FindAsync<SiteSettings>("site"))!;
if (rolledSettings.Subtitle != originalSettings.Subtitle || rolledSettings.Version != originalSettings.Version ||
    rolledSettings.CommentsEnabled != originalSettings.CommentsEnabled ||
    await repo.CountAsync<AuditEntry>() != before) throw new Exception("Settings and audit rollback failed.");
await repo.InsertAsync(new MenuItem { Id = id, Label = "事务回滚菜单" });
try
{
    await repo.WriteAsync<bool>("check", "menu.save", async r =>
    {
        var menu = (await r.FindAsync<MenuItem>(id))!;
        menu.Label = "不能保存的名称";
        await r.SaveMenuAsync(menu, 0);
        r.SetAuditTarget("menu", id, menu.Label);
        await r.InsertAsync(new AuditEntry { Action = "menu-rollback-proof" });
        throw new InvalidOperationException("intentional");
    });
}
catch (InvalidOperationException e) when (e.Message == "intentional")
{
}

var rolledMenu = (await repo.FindAsync<MenuItem>(id))!;
if (rolledMenu.Label != "事务回滚菜单" || rolledMenu.Version != 0 || await repo.CountAsync<AuditEntry>() != before)
    throw new Exception("Menu and audit rollback failed.");
await repo.DeleteAsync<MenuItem>(id);
try
{
    await repo.WriteAsync<bool>("check", "rollback", async r =>
    {
        await r.InsertAsync(new Taxonomy { Id = id, Name = "回滚测试", Slug = id });
        throw new InvalidOperationException("intentional");
    });
}
catch (InvalidOperationException e) when (e.Message == "intentional")
{
}

if (await repo.FindAsync<Taxonomy>(id) != null || await repo.CountAsync<AuditEntry>() != before)
    throw new Exception("Transaction rollback failed.");
var slug = Guid.NewGuid().ToString("N");
await repo.InsertAsync(new Taxonomy { Id = id, Slug = slug, Name = "唯一约束" });
var rejected = false;
try
{
    await repo.InsertAsync(new Taxonomy { Slug = slug, Name = "重复" });
}
catch
{
    rejected = true;
}

if (!rejected) throw new Exception("Database unique index not enforced.");
await repo.DeleteAsync<Taxonomy>(id);
Console.WriteLine("PASS: database rollback, audit rollback, unique index");
await IntegrationChecks.RunAsync(repo);

/// <summary>Audit shape before integration attribution was added.</summary>
[Table(Name = "cms_audit")]
public class LegacyV5Audit : Entity
{
    /// <summary>Original actor.</summary>
    [Column(StringLength = 160)]
    public string Actor { get; set; } = "";

    /// <summary>Original action.</summary>
    [Column(StringLength = 120)]
    public string Action { get; set; } = "";

    /// <summary>Original target kind.</summary>
    [Column(StringLength = 24)]
    public string TargetType { get; set; } = "";

    /// <summary>Original target id.</summary>
    [Column(StringLength = 32)]
    public string TargetId { get; set; } = "";

    /// <summary>Original target name.</summary>
    [Column(StringLength = 300)]
    public string TargetName { get; set; } = "";
}

/// <summary>Exact audit table shape shipped in schema version 1.</summary>
[Table(Name = "cms_audit")]
public class LegacyAudit : Entity
{
    /// <summary>Version 1 actor text.</summary>
    [Column(StringLength = 160)]
    public string Actor { get; set; } = "";

    /// <summary>Version 1 action text.</summary>
    [Column(StringLength = 120)]
    public string Action { get; set; } = "";
}

/// <summary>Exact flat navigation shape shipped through schema version 3.</summary>
[Table(Name = "cms_menu")]
public class LegacyMenu : Entity
{
    /// <summary>Original visible label.</summary>
    [Column(StringLength = 60)]
    public string Label { get; set; } = "";

    /// <summary>Original destination.</summary>
    [Column(StringLength = 500)]
    public string Url { get; set; } = "/";

    /// <summary>Original order.</summary>
    public int Sort { get; set; }
}

/// <summary>Exact site settings table shipped through schema 4.</summary>
[Table(Name = "cms_settings")]
public class LegacySettings : Entity
{
    /// <summary>Original title.</summary>
    [Column(StringLength = 100)]
    public string Title { get; set; } = "";

    /// <summary>Original description.</summary>
    [Column(StringLength = 500)]
    public string Description { get; set; } = "";

    /// <summary>Original logo identifier.</summary>
    [Column(StringLength = 32)]
    public string LogoId { get; set; } = "";

    /// <summary>Original search keywords.</summary>
    [Column(StringLength = 300)]
    public string Keywords { get; set; } = "";
}
