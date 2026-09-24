using System.IO.Compression;
using System.Net;
using System.Text;
using System.Text.Json;
using Cms.Data;
using Cms.Services;
using FreeSql;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.Extensions.Configuration;
using SQLitePCL;

/// <summary>Isolated database and fake provider checks; never sends content or credentials to a real AI service.</summary>
public static class AiWritingChecks
{
    /// <summary>Check additive migration, protected settings, provider failures and proposal-only semantics.</summary>
    public static async Task RunAsync()
    {
        Batteries_V2.Init();
        var root = Path.Combine(Path.GetTempPath(), "cms-ai-check-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(root);
        using var db = Database(Path.Combine(root, "source.db"));
        var repo = new CmsRepository(db);
        await repo.InitializeSchemaAsync();
        await repo.InsertAsync(new SiteSettings { Id = "site", Title = "原站点" });
        await db.Ado.ExecuteNonQueryAsync("DROP TABLE cms_ai_settings");
        await repo.UpdateAsync(new SchemaVersion { Id = "schema", Version = 19 });
        using var migrationDb = Database(Path.Combine(root, "source.db"));
        repo = new CmsRepository(migrationDb);
        await repo.InitializeSchemaAsync(); await repo.InitializeSchemaAsync();
        Check(await repo.ReadyAsync() && (await repo.FindAsync<SiteSettings>("site"))!.Title == "原站点", "v19 upgrade preserves existing data and creates AI table");
        var config = Config(root);
        var protector = DataProtectionProvider.Create(new DirectoryInfo(Path.Combine(root, "keys")));
        var settings = new AiSettingsService(repo, config, protector);
        Check(!(await settings.StatusAsync()).Ready, "disabled by default");
        var options = new AiOptions(true, "https://provider.example.com/v1/", "isolated-ai-secret", "fixture-model");
        var saved = await settings.SaveAsync("check", options);
        Check(saved.HasSecret && saved.Values.ApiKey == "" && saved.Values.ApiUrl.EndsWith("/v1"), "redacted normalized view");
        var encrypted = (await repo.FindAsync<AiSettings>("site"))!.ProtectedJson;
        Check(!encrypted.Contains("isolated-ai-secret") && !encrypted.Contains("fixture-model"), "encrypted database row");
        saved = await settings.SaveAsync("check", saved.Values with { Model = "fixture-model-2" });
        Check((await settings.LoadAsync()).ApiKey == options.ApiKey, "blank key preserved for same URL");
        await Reject(() => settings.SaveAsync("check", options), 409);
        await Reject(() => settings.SaveAsync("check", saved.Values with { ApiUrl = "https://other.example.com/v1" }), 400);
        await Reject(() => settings.SaveAsync("check", saved.Values with { ApiUrl = "https://user:pass@example.com/v1" }), 400);
        await Reject(() => settings.SaveAsync("check", saved.Values with { ApiKey = "bad\nkey" }), 400);
        config["AI:Model"] = "consul-model";
        Check((await settings.LoadAsync()).Model == "consul-model" && (await settings.ViewAsync()).DeploymentManaged, "Consul configuration chain takes precedence");
        await Reject(() => settings.SaveAsync("check", saved.Values), 409);
        config["AI:ApiUrl"] = "https://changed.example.com/v1";
        Check((await settings.LoadAsync()).ApiKey == "", "override URL never receives old provider key");
        config["AI:Model"] = null; config["AI:ApiUrl"] = null;
        Check(AiSettingsService.Endpoint(options.ApiUrl).AbsolutePath == "/v1/chat/completions" &&
            AiSettingsService.Endpoint("https://provider.example.com/v1/chat/completions/").AbsolutePath == "/v1/chat/completions", "base and full endpoint accepted");
        foreach (var address in new[] { "127.0.0.1", "10.0.0.1", "169.254.169.254", "172.16.0.1", "192.168.1.1", "100.100.100.200", "::1", "::ffff:127.0.0.1", "fc00::1", "fe80::1", "2002:7f00:1::", "64:ff9b::7f00:1" })
            Check(!AiWritingService.IsPublicAddress(IPAddress.Parse(address)), "private network rejected: " + address);
        Check(AiWritingService.IsPublicAddress(IPAddress.Parse("8.8.8.8")) && AiWritingService.IsPublicAddress(IPAddress.Parse("2606:4700:4700::1111")), "public IPv4/IPv6 accepted");
        using var transport = new FakeProvider(); using var http = new HttpClient(transport);
        var writing = new AiWritingService(repo, settings, http);
        var before = await repo.CountAsync<Content>();
        Check((await writing.TestAsync(default)).Text == "连接成功", "test requires generated text");
        await repo.InsertAsync(new Taxonomy { Id = "tag-ai", Kind = "tag", Name = "人工智能", Slug = "ai" });
        foreach (var action in new[] { "summary", "title", "tags", "polish", "translate", "write" })
        {
            transport.Text = action switch { "summary" => "<b>简短摘要</b>", "title" => "优化标题", "tags" => "```json\n[\"人工智能\",\"不存在\"]\n```", _ => "```html\n<p onclick=\"alert(1)\">新正文</p><script>alert(1)</script>\n```" };
            var result = await writing.GenerateAsync(new(action, "旧标题", "<p>原正文</p>", "写作要求"), default);
            Check(action == "tags" ? result.TagIds.SequenceEqual(new[] { "tag-ai" }) : action is "title" or "summary" ? !result.Text.Contains('<') :
                result.Html.Contains("新正文") && !result.Html.Contains("script") && !result.Html.Contains("onclick"), action + " usable sanitized proposal");
        }
        Check(await repo.CountAsync<Content>() == before, "generation never saves or publishes articles");
        Check(transport.LastRequest.Contains("原正文") && transport.LastRequest.Contains("fixture-model-2") && transport.Key == "isolated-ai-secret", "server passes current draft and saved model/key");
        await Reject(() => writing.GenerateAsync(new("summary", Html: ""), default), 400);
        await Reject(() => writing.GenerateAsync(new("write"), default), 400);
        await Reject(() => writing.GenerateAsync(new("unknown", Html: "正文"), default), 400);
        await Reject(() => writing.GenerateAsync(new("polish", Html: new string('x', 100001)), default), 400);
        transport.Status = HttpStatusCode.Unauthorized;
        await Reject(() => writing.TestAsync(default), 502);
        transport.Status = HttpStatusCode.Redirect;
        await Reject(() => writing.TestAsync(default), 502);
        transport.Status = HttpStatusCode.OK; transport.Raw = "{}";
        await Reject(() => writing.TestAsync(default), 502);
        transport.Raw = "{\"choices\":[{\"finish_reason\":\"length\",\"message\":{\"content\":\"truncated\"}}]}";
        await Reject(() => writing.TestAsync(default), 502);
        transport.Raw = null; transport.Text = "";
        await Reject(() => writing.TestAsync(default), 502);
        transport.Text = new string('x', 501);
        await Reject(() => writing.GenerateAsync(new("summary", Html: "正文"), default), 502);
        transport.Raw = new string('x', 1_048_577);
        await Reject(() => writing.TestAsync(default), 502);
        transport.Raw = null; transport.Timeout = true;
        await Reject(() => writing.TestAsync(default), 504);
        transport.Timeout = false;
        config["AI:Enabled"] = "false";
        await Reject(() => writing.TestAsync(default), 409);
        config["AI:Enabled"] = null;

        var backup = await new MaintenanceService(repo, config).BackupAsync("check");
        var archive = Path.Combine(root, "backups", backup.State.FileName);
        using (var zip = ZipFile.OpenRead(archive)) Check(zip.GetEntry("database/AiSettings.json") != null, "logical backup includes AI settings");
        var restoredRoot = Path.Combine(root, "restored"); Directory.CreateDirectory(restoredRoot);
        using var restoredDb = Database(Path.Combine(restoredRoot, "restore.db")); var restoredRepo = new CmsRepository(restoredDb);
        await restoredRepo.InitializeSchemaAsync();
        await new MaintenanceService(restoredRepo, Config(restoredRoot)).RestoreAsync(archive);
        var restoredSettings = new AiSettingsService(restoredRepo, Config(restoredRoot), DataProtectionProvider.Create(new DirectoryInfo(Path.Combine(restoredRoot, "keys"))));
        Check((await restoredSettings.LoadAsync()).ApiKey == options.ApiKey, "backup restores encrypted settings with matching keys");
        var legacyArchive = Path.Combine(root, "schema19.zip"); File.Copy(archive, legacyArchive);
        using (var zip = ZipFile.Open(legacyArchive, ZipArchiveMode.Update))
        {
            BackupManifest manifest;
            using (var stream = zip.GetEntry("manifest.json")!.Open()) manifest = JsonSerializer.Deserialize<BackupManifest>(stream)!;
            zip.GetEntry("database/AiSettings.json")!.Delete(); manifest.Sha256.Remove("database/AiSettings.json");
            var schema = JsonSerializer.SerializeToUtf8Bytes(new[] { new SchemaVersion { Id = "schema", Version = 19 } });
            zip.GetEntry("database/SchemaVersion.json")!.Delete();
            using (var stream = zip.CreateEntry("database/SchemaVersion.json").Open()) stream.Write(schema);
            manifest.Sha256["database/SchemaVersion.json"] = Convert.ToHexString(System.Security.Cryptography.SHA256.HashData(schema));
            zip.GetEntry("manifest.json")!.Delete();
            using var output = zip.CreateEntry("manifest.json").Open(); JsonSerializer.Serialize(output, manifest with { Schema = 19 });
        }
        var legacyRoot = Path.Combine(root, "legacy"); Directory.CreateDirectory(legacyRoot);
        using var legacyDb = Database(Path.Combine(legacyRoot, "restore.db")); var legacyRepo = new CmsRepository(legacyDb);
        await legacyRepo.InitializeSchemaAsync();
        await new MaintenanceService(legacyRepo, Config(legacyRoot)).RestoreAsync(legacyArchive);
        Check(await legacyRepo.CountAsync<AiSettings>() == 0 && (await legacyRepo.FindAsync<SiteSettings>("site"))!.Title == "原站点", "v19 backups restore with empty AI settings");
        Console.WriteLine("PASS: AI migration, encrypted settings, overrides, public network guard, six actions, failure handling, draft isolation and backup restore. " + root);
    }

    private static IFreeSql Database(string path) => new FreeSqlBuilder().UseConnectionString(DataType.Sqlite, "Data Source=" + path).UseAutoSyncStructure(false).Build();
    private static IConfigurationRoot Config(string root) => new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?> {
        ["Storage:Path"] = Path.Combine(root, "uploads"), ["Security:KeyPath"] = Path.Combine(root, "keys"), ["Maintenance:BackupPath"] = Path.Combine(root, "backups") }).Build();
    private static void Check(bool value, string message) { if (!value) throw new Exception(message); }
    private static async Task Reject(Func<Task> action, int status)
    {
        try { await action(); } catch (CmsException e) when (e.Status == status) { Check(!e.Message.Contains("isolated-ai-secret"), "error redaction"); return; }
        throw new Exception("Expected AI rejection: " + status);
    }
    private sealed class FakeProvider : HttpMessageHandler
    {
        public string Text = "连接成功", LastRequest = "", Key = "";
        public string? Raw;
        public bool Timeout;
        public HttpStatusCode Status = HttpStatusCode.OK;
        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            if (Timeout) throw new TaskCanceledException();
            Check(request.RequestUri!.AbsolutePath == "/v1/chat/completions", "request endpoint");
            Check(request.Content!.Headers.ContentLength > 0, "explicit request length for compatible gateways");
            LastRequest = await request.Content!.ReadAsStringAsync(cancellationToken);
            using var parsed = JsonDocument.Parse(LastRequest);
            LastRequest = parsed.RootElement.GetProperty("messages")[1].GetProperty("content").GetString()! + parsed.RootElement.GetProperty("model").GetString();
            LastRequest = System.Text.RegularExpressions.Regex.Unescape(LastRequest);
            Key = request.Headers.Authorization!.Parameter!;
            return new(Status) { Content = new StringContent(Raw ?? JsonSerializer.Serialize(new { choices = new[] { new { finish_reason = "stop", message = new { content = Text } } } }), Encoding.UTF8, "application/json") };
        }
    }
}
