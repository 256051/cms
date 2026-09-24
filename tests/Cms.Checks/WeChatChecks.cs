using System.Net;
using System.Text.Json;
using Cms.Data;
using Cms.Services;
using FreeSql;
using Microsoft.Extensions.Configuration;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.Extensions.Logging;
using SQLitePCL;

/// <summary>Isolated draft-delivery checks; no real WeChat account or network is used.</summary>
public static class WeChatChecks
{
    private static readonly byte[] ImageBytes = Convert.FromBase64String("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a7S8AAAAASUVORK5CYII=");
    /// <summary>Exercise publication boundaries, media replacement, deduplication and uncertain outcomes.</summary>
    public static async Task RunAsync()
    {
        Batteries_V2.Init();
        var directory = Path.Combine(Path.GetTempPath(), "cms-wechat-check-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(directory);
        using var db = new FreeSqlBuilder().UseConnectionString(DataType.Sqlite, "Data Source=" + Path.Combine(directory, "test.db"))
            .UseAutoSyncStructure(false).Build();
        var repo = new CmsRepository(db);
        await repo.InitializeSchemaAsync();
        // Simulate the additive v16 upgrade and its repeat execution without touching a development database.
        await repo.InsertAsync(new SiteSettings { Id = "site", Title = "升级保留" });
        await repo.UpdateAsync(new SchemaVersion { Id = "schema", Version = 16 });
        await repo.InitializeSchemaAsync(); await repo.InitializeSchemaAsync();
        Check((await repo.FindAsync<SiteSettings>("site"))!.Title == "升级保留", "upgrade preserves site data");
        var config = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?> {
            ["Storage:Path"] = directory
        }).Build();
        var protection = DataProtectionProvider.Create(new DirectoryInfo(Path.Combine(directory, "keys")));
        var accountSettings = new WeChatSettingsService(repo, config, protection);
        Check(!(await accountSettings.StatusAsync()).Enabled, "database configuration defaults disabled");
        var options = new WeChatOptions(true, true, "wx1234567890123456", "test-secret-never-return", "编辑", "https://example.com");
        var settingsView = await accountSettings.SaveAsync("check", options);
        Check(settingsView.HasSecret && settingsView.Values.AppSecret == "" && !settingsView.DeploymentManaged, "settings view masks saved secret");
        var storedSettings = (await repo.FindAsync<WeChatAccountSettings>("site"))!;
        Check(!storedSettings.ProtectedJson.Contains(options.AppSecret) && !storedSettings.ProtectedJson.Contains(options.AppId), "database stores ciphertext only");
        settingsView = await accountSettings.SaveAsync("check", settingsView.Values with { Author = "编辑更新" });
        Check((await accountSettings.LoadAsync()).AppSecret == options.AppSecret, "blank secret preserves same account credentials");
        await Reject(() => accountSettings.SaveAsync("check", options), "stale version is rejected");
        await Reject(() => accountSettings.SaveAsync("check", settingsView.Values with { AppId = "wx0000000000000000" }), "changing account requires a new secret");
        await Reject(() => accountSettings.SaveAsync("check", settingsView.Values with { SiteUrl = "[https://example.com](https://example.com)" }), "Markdown URL rejected");
        config["WeChat:Enabled"] = "false";
        Check(!(await accountSettings.StatusAsync()).Enabled && (await accountSettings.ViewAsync()).DeploymentManaged, "explicit deployment override wins");
        await Reject(() => accountSettings.SaveAsync("check", settingsView.Values), "managed configuration cannot be falsely saved");
        config["WeChat:Enabled"] = null;
        Check((await accountSettings.StatusAsync()).Enabled, "database settings take effect immediately without restart");
        using var fake = new FakeWeChat();
        using var http = new HttpClient(fake);
        var client = new WeChatClient(http);
        var assets = new AssetService(repo, config);
        var diagnostics = new DiagnosticLogger();
        var service = new WeChatDraftService(repo, accountSettings, assets, client, diagnostics);
        Check((await service.SettingsAsync()).Errors.Length == 0, "valid redacted settings");
        Check(!JsonSerializer.Serialize(await service.SettingsAsync()).Contains("test-secret"), "secret is not exposed");
        var asset = new Asset { ContentType = "image/png", Name = "test.png", StorageName = "test.png", Size = 68 };
        await repo.InsertAsync(asset);
        await File.WriteAllBytesAsync(Path.Combine(directory, asset.StorageName), ImageBytes);
        var contents = new ContentService(repo, new ContentValidator(), accountSettings);
        var input = new ContentInput("post", "wechat-check", "已发布标题", "摘要", $"<p>正文</p><img src=\"/media/{asset.Id}\"><img src=\"/media/{asset.Id}\">", asset.Id, "", [], 0);
        var draft = await contents.SaveAsync("check", null, input);
        Check(await repo.CountAsync<WeChatDraft>() == 0, "saving draft never synchronizes");
        var published = await contents.PublishAsync("check", draft.Id, draft.Version, true);
        var queued = (await service.HistoryAsync(draft.Id)).Single();
        Check(queued.Status == "queued", "publication creates durable job");
        var edited = await contents.SaveAsync("check", draft.Id, input with { Title = "未发布修改", Version = published.Version });
        Check((await service.QueueAsync("check", draft.Id, edited.Version)).Id == queued.Id, "same published snapshot is deduplicated");
        await service.RunAsync(default);
        Check((await service.HistoryAsync(draft.Id)).Single().Status == "draft", "draft is confirmed");
        Check(fake.Covers == 1 && fake.Images == 1 && fake.Drafts == 1 && fake.Tokens == 1, "one cover, one distinct image and cached token");
        Check(fake.LastArticle.GetProperty("title").GetString() == "已发布标题", "unpublished edits never leave CMS");
        Check(fake.LastArticle.GetProperty("content").GetString()!.Contains("https://mmbiz.qpic.cn/check.png") &&
            !fake.LastArticle.GetProperty("content").GetString()!.Contains("/media/"), "local images are replaced");
        Check(fake.LastArticle.GetProperty("thumb_media_id").GetString() == "cover-id" &&
            fake.LastArticle.GetProperty("content_source_url").GetString() == "https://example.com/posts/wechat-check", "cover and original URL");
        await service.QueueAsync("check", draft.Id, edited.Version); await service.RunAsync(default);
        Check(fake.Drafts == 1, "repeated clicks do not create duplicates");
        await Reject(() => service.RetryAsync("check", queued.Id), "successful job cannot retry");
        fake.Mode = "rejected";
        var second = await contents.PublishAsync("check", edited.Id, edited.Version, true);
        await service.RunAsync(default);
        var failed = (await service.HistoryAsync(draft.Id)).Single(x => x.Status == "failed");
        Check(failed.Error.Contains("48001") && !failed.Error.Contains("test-secret"), "error is useful and redacted");
        fake.Mode = "ok";
        await service.RetryAsync("check", failed.Id); await service.RunAsync(default);
        Check((await repo.FindAsync<WeChatDraft>(failed.Id))!.Status == "draft", "definite failure can retry");
        var changed = await contents.SaveAsync("check", draft.Id, input with { Title = "超时版本", Version = second.Version });
        var third = await contents.PublishAsync("check", changed.Id, changed.Version, true);
        fake.Mode = "timeout"; await service.RunAsync(default);
        var unknown = (await service.HistoryAsync(draft.Id)).Single(x => x.Status == "unknown");
        var calls = fake.Drafts;
        await service.RunAsync(default); await Reject(() => service.RetryAsync("check", unknown.Id), "ambiguous submission cannot retry");
        Check(calls == fake.Drafts, "timeout is not blindly replayed");
        var interrupted = new WeChatDraft { AppId = options.AppId, ContentId = draft.Id, Fingerprint = "interrupted", Status = "submitting" };
        await repo.InsertAsync(interrupted); await service.RunAsync(default);
        Check((await repo.FindAsync<WeChatDraft>(interrupted.Id))!.Status == "unknown", "interrupted submission is unknown");
        var article = new WeChatArticle("测试", "摘要", "<p>内容</p>", asset.Id, "作者", "");
        await Reject(() => { WeChatDraftService.Validate(article with { Title = new string('中', 33) }); return Task.CompletedTask; }, "long title rejected");
        await Reject(() => { WeChatDraftService.Validate(article with { Html = "<img src='http://127.0.0.1/internal'>" }); return Task.CompletedTask; }, "external images rejected without fetching");
        await Reject(() => { WeChatDraftService.Validate(article with { Html = "<video src='/media/x'></video>" }); return Task.CompletedTask; }, "unsupported media rejected");
        var invalid = await contents.SaveAsync("check", draft.Id, input with { Title = new string('中', 33), Version = third.Version });
        await contents.PublishAsync("check", invalid.Id, invalid.Version, true); await service.RunAsync(default);
        Check((await repo.FindAsync<Content>(draft.Id))!.Published && (await service.HistoryAsync(draft.Id)).Any(x => x.Status == "failed"), "WeChat validation never withdraws website publication");
        config["WeChat:Enabled"] = "false";
        var before = await repo.CountAsync<WeChatDraft>();
        var standalone = await contents.SaveAsync("check", null, input with { Slug = "disabled" });
        await contents.PublishAsync("check", standalone.Id, standalone.Version, true);
        Check(before == await repo.CountAsync<WeChatDraft>(), "disabled integration adds no jobs");
        var choice = await contents.SaveAsync("check", null, input with { Slug = "publish-choice" });
        await Reject(() => contents.PublishAsync("check", choice.Id, choice.Version, true, true), "explicit synchronization rejects disabled configuration");
        Check(!(await repo.FindAsync<Content>(choice.Id))!.Published, "rejected sync choice rolls publication back");
        config["WeChat:Enabled"] = "true";
        config["WeChat:AppSecret"] = "";
        await Reject(() => contents.PublishAsync("check", choice.Id, choice.Version, true, true), "explicit synchronization rejects incomplete configuration");
        config["WeChat:AppSecret"] = "test-secret-never-return";
        choice = await contents.PublishAsync("check", choice.Id, choice.Version, true, false);
        Check(before == await repo.CountAsync<WeChatDraft>(), "unchecked publication overrides global AutoSync=true");
        config["WeChat:AutoSync"] = "false";
        choice = await contents.PublishAsync("check", choice.Id, choice.Version, true, true);
        Check((await service.HistoryAsync(choice.Id)).Single().Status == "queued", "checked publication overrides global AutoSync=false");
        config["WeChat:AutoSync"] = "true";
        config["WeChat:Enabled"] = "true"; fake.Mode = "ok";
        var scheduled = await contents.SaveAsync("check", null, input with { Slug = "scheduled" });
        var row = (await repo.FindAsync<Content>(scheduled.Id))!;
        row.ScheduledPublishAt = DateTime.UtcNow.AddMinutes(-1); row.ScheduledJson = JsonSerializer.Serialize(scheduled);
        await repo.UpdateAsync(row); await contents.RunSchedulesAsync();
        Check((await service.HistoryAsync(row.Id)).Single().Status == "queued", "scheduled publication uses same queue");
        await contents.PublishAsync("check", row.Id, (await contents.GetAsync(row.Id)).Version, false);
        await service.RunAsync(default);
        Check((await service.HistoryAsync(row.Id)).Single().Status == "cancelled", "withdrawn content is not sent");
        await contents.PublishAsync("check", row.Id, (await contents.GetAsync(row.Id)).Version, true);
        Check((await service.HistoryAsync(row.Id)).Single().Status == "queued", "republishing a cancelled snapshot requeues it");
        await service.RunAsync(default);
        Check((await service.HistoryAsync(row.Id)).Single().Status == "draft", "republished cancelled content can synchronize");
        foreach (var fault in new[] {
            ("dns", "/cgi-bin/stable_token", "获取微信访问凭据", "DNS", "failed"),
            ("tls", "/cgi-bin/stable_token", "获取微信访问凭据", "TLS", "failed"),
            ("timeout", "/cgi-bin/stable_token", "获取微信访问凭据", "超时", "failed"),
            ("http", "/cgi-bin/material/add_material", "上传微信封面", "HTTP 502", "failed"),
            ("json", "/cgi-bin/media/uploadimg", "上传正文图片", "JSON", "failed"),
            ("missing", "/cgi-bin/material/add_material", "上传微信封面", "media_id", "failed"),
            ("media-missing", "/cgi-bin/material/add_material", "上传微信封面", "未识别到上传的文件数据", "failed"),
            ("http", "/cgi-bin/draft/add", "创建微信草稿", "HTTP 502", "unknown") })
        {
            fake.FaultKind = fault.Item1; fake.FaultEndpoint = fault.Item2;
            var diagnosticService = new WeChatDraftService(repo, accountSettings, assets, new WeChatClient(http), diagnostics);
            var failedInput = await contents.SaveAsync("check", null, input with { Slug = "diagnostic-" + Guid.NewGuid().ToString("N") });
            await contents.PublishAsync("check", failedInput.Id, failedInput.Version, true, true);
            await diagnosticService.RunAsync(default);
            var outcome = (await diagnosticService.HistoryAsync(failedInput.Id)).Single();
            Check(outcome.Status == fault.Item5 && outcome.Error.Contains(fault.Item3) && outcome.Error.Contains(fault.Item4),
                "failure identifies actual step and safe reason: " + fault.Item1);
            Check(!outcome.Error.Contains(fault.Item3 + "：" + fault.Item3), "failure step is not duplicated");
            Check(!outcome.Error.Contains("must-not-leak") && diagnostics.Messages.Any(x => x.Contains(outcome.Id) && x.Contains(fault.Item3)),
                "diagnostic is correlated with the job without leaking credentials");
            if (outcome.Status == "unknown") await Reject(() => diagnosticService.RetryAsync("check", outcome.Id), "detailed transport errors preserve unknown submission safety");
            fake.FaultKind = fake.FaultEndpoint = "";
        }
        Check(!string.Join("\n", diagnostics.Messages).Contains("must-not-leak"), "logs exclude raw exceptions, request URLs and response bodies");
        Check(WeChatClient.Diagnostic(new UnauthorizedAccessException("must-not-leak")).Contains("权限"), "file permissions have a safe diagnostic");
        Check(await repo.CountAsync<WeChatPublication>() == 0, "automatic publication defaults off");
        foreach (var key in new[] { "Enabled", "AutoSync", "AppSecret" }) config["WeChat:" + key] = null;
        settingsView = await accountSettings.SaveAsync("check", (await accountSettings.ViewAsync()).Values with { AutoPublish = true });
        Check((await service.SettingsAsync()).AutoPublish, "database automatic publication option is visible without secrets");
        await service.QueueAsync("check", row.Id, (await contents.GetAsync(row.Id)).Version);
        Check(await repo.CountAsync<WeChatPublication>() == 0, "enabling automatic publication never upgrades an existing draft");
        async Task<WeChatDraftView> QueueAutomatic(string slug)
        {
            var created = await contents.SaveAsync("check", null, input with { Slug = slug });
            await contents.PublishAsync("check", created.Id, created.Version, true, true);
            return (await service.HistoryAsync(created.Id)).Single();
        }
        var automatic = await QueueAutomatic("auto-publish");
        Check(automatic.PublicationStatus == "queued", "publication intent is frozen on enqueue");
        await service.RunAsync(default);
        var automaticRow = (await repo.FindAsync<WeChatPublication>(automatic.Id))!;
        Check(automaticRow.Status == "publishing" && automaticRow.PublishId == "publish-1" && fake.Submissions == 1,
            "submit saves task id and does not claim publication success");
        Check(fake.LastSubmittedMediaId == (await repo.FindAsync<WeChatDraft>(automatic.Id))!.MediaId, "publish uses the created draft id");
        // A fresh service instance must query the known ID, including after a temporary query failure.
        service = new WeChatDraftService(repo, accountSettings, assets, client);
        fake.QueryMode = "timeout";
        await service.RunAsync(default);
        Check((await repo.FindAsync<WeChatPublication>(automatic.Id))!.Status == "publishing" && fake.Submissions == 1,
            "query failure and restart do not resubmit publication");
        fake.QueryMode = "ok"; fake.PublishStatus = 1;
        await service.RunAsync(default);
        Check((await repo.FindAsync<WeChatPublication>(automatic.Id))!.Status == "publishing", "pending status keeps querying");
        fake.PublishStatus = 0;
        await service.RunAsync(default);
        Check((await repo.FindAsync<WeChatPublication>(automatic.Id))!.Status == "published" && fake.Submissions == 1,
            "only confirmed success is published");
        Check(!JsonSerializer.Serialize(await repo.FindAsync<WeChatPublication>(automatic.Id)).Contains("article_url"), "publication stores no article URL");
        await Reject(() => service.RetryAsync("check", automatic.Id), "published task cannot be resubmitted");
        fake.PublishMode = "rejected";
        var rejected = await QueueAutomatic("auto-rejected"); await service.RunAsync(default);
        Check((await repo.FindAsync<WeChatPublication>(rejected.Id))!.Status == "failed", "publication permissions failure is explicit");
        var draftCalls = fake.Drafts;
        fake.PublishMode = "ok";
        await service.RetryAsync("check", rejected.Id); await service.RunAsync(default);
        Check(fake.Drafts == draftCalls && (await repo.FindAsync<WeChatPublication>(rejected.Id))!.Status == "publishing",
            "retry rejected submission reuses draft instead of creating another");
        fake.PublishStatus = 4; await service.RunAsync(default);
        Check((await repo.FindAsync<WeChatPublication>(rejected.Id))!.Status == "failed", "platform review rejection is recorded");
        await Reject(() => service.RetryAsync("check", rejected.Id), "completed failed task is not blindly resubmitted");
        fake.PublishMode = "timeout";
        var uncertain = await QueueAutomatic("auto-timeout"); await service.RunAsync(default);
        var submissions = fake.Submissions;
        await service.RunAsync(default);
        Check((await repo.FindAsync<WeChatPublication>(uncertain.Id))!.Status == "unknown" && fake.Submissions == submissions,
            "ambiguous publish submission never retries automatically");
        await Reject(() => service.RetryAsync("check", uncertain.Id), "unknown publication cannot be retried");
        fake.PublishMode = "missing-id";
        var missingId = await QueueAutomatic("auto-missing-id"); await service.RunAsync(default);
        Check((await repo.FindAsync<WeChatPublication>(missingId.Id))!.Status == "unknown", "missing task identifier is uncertain");
        var publishingInterrupted = new WeChatPublication { Id = Guid.NewGuid().ToString("N"), AppId = options.AppId, Status = "submitting" };
        await repo.InsertAsync(publishingInterrupted); await service.RunAsync(default);
        Check((await repo.FindAsync<WeChatPublication>(publishingInterrupted.Id))!.Status == "unknown", "interrupted publication is never replayed");
        fake.PublishMode = "ok"; fake.PublishStatus = 1;
        var accepted = await QueueAutomatic("auto-accepted"); await service.RunAsync(default);
        var stop = await QueueAutomatic("auto-stop");
        submissions = fake.Submissions;
        config["WeChat:AutoPublish"] = "false";
        fake.PublishStatus = 0;
        await service.RunAsync(default);
        Check((await repo.FindAsync<WeChatPublication>(stop.Id))!.Status == "cancelled" && fake.Submissions == submissions,
            "switch off prevents pending submission");
        Check((await repo.FindAsync<WeChatPublication>(accepted.Id))!.Status == "published", "switch off continues querying accepted tasks");
        config["WeChat:AutoPublish"] = "true";
        var withdrawn = await QueueAutomatic("auto-withdrawn");
        var withdrawnDraft = (await repo.FindAsync<WeChatDraft>(withdrawn.Id))!;
        await contents.PublishAsync("check", withdrawnDraft.ContentId, (await contents.GetAsync(withdrawnDraft.ContentId)).Version, false);
        await service.RunAsync(default);
        Check((await repo.FindAsync<WeChatPublication>(withdrawn.Id))!.Status == "cancelled" && fake.Submissions == submissions,
            "withdrawal cancels automatic publication");
        var wrongAccount = await QueueAutomatic("auto-account");
        config["WeChat:AppId"] = "wx0000000000000000";
        await service.RunAsync(default);
        Check(fake.Submissions == submissions && (await repo.FindAsync<WeChatPublication>(wrongAccount.Id))!.Status == "queued",
            "account changes never redirect pending publication");
        config["WeChat:AppId"] = null;
        // Failed drafts must not occupy the limited publication batch forever.
        for (var i = 0; i < 12; i++)
        {
            var blocked = new WeChatDraft { AppId = options.AppId, ContentId = row.Id, Fingerprint = "blocked-" + i, Status = "failed" };
            await repo.InsertAsync(blocked);
            await repo.InsertAsync(new WeChatPublication { Id = blocked.Id, AppId = options.AppId, UpdatedAt = DateTime.UtcNow.AddDays(-1) });
        }
        await service.RunAsync(default);
        Check((await repo.FindAsync<WeChatPublication>(wrongAccount.Id))!.Status == "publishing", "failed drafts do not starve ready publication");
        var backup = new Dictionary<string, byte[]>();
        await repo.ExportAsync((name, data) => { backup[name] = data; return Task.CompletedTask; });
        Check(backup.ContainsKey("WeChatDraft.json"), "delivery history is backed up");
        Check(backup.ContainsKey("WeChatPublication.json") && !System.Text.Encoding.UTF8.GetString(backup["WeChatPublication.json"]).Contains("must-not-store"),
            "publication history is backed up without upstream article URLs");
        using var restoredDb = new FreeSqlBuilder().UseConnectionString(DataType.Sqlite, "Data Source=" + Path.Combine(directory, "restore.db")).UseAutoSyncStructure(false).Build();
        var restored = new CmsRepository(restoredDb); await restored.InitializeSchemaAsync();
        await restored.RecordTrafficAsync(async scoped => { await scoped.ImportAsync(name => Task.FromResult(backup[name])); return true; });
        Check((await new WeChatSettingsService(restored, new ConfigurationBuilder().Build(), protection).LoadAsync()).AppSecret == options.AppSecret, "backup restores encrypted settings with matching keys");
        Check((await restored.ListAsync<WeChatDraft>()).All(x => x.Status is "draft" or "unknown" or "cancelled"), "restore cannot replay external writes");
        Check((await restored.ListAsync<WeChatPublication>()).All(x => x.Status is "published" or "publishing" or "unknown" or "cancelled"), "restored publication never queues external submissions");
        var restoredService = new WeChatDraftService(restored, new WeChatSettingsService(restored, config, protection), new AssetService(restored, config), client);
        submissions = fake.Submissions;
        await restoredService.RunAsync(default);
        Check(fake.Submissions == submissions && (await restored.FindAsync<WeChatPublication>(wrongAccount.Id))!.Status == "published", "restore resumes only known task queries");
        Console.WriteLine("PASS: WeChat images, settings, draft isolation, optional publication, status polling, safe retry, unknown outcomes, cancellation and backup/restore");
    }

    private static void Check(bool condition, string message) { if (!condition) throw new Exception(message); }
    private static async Task Reject(Func<Task> action, string message)
    {
        try { await action(); } catch (CmsException) { return; }
        throw new Exception(message);
    }

    private sealed class DiagnosticLogger : ILogger<WeChatDraftService>
    {
        public List<string> Messages { get; } = [];
        /// <summary>No external logging scope is required for this isolated check.</summary>
        public IDisposable? BeginScope<TState>(TState state) where TState : notnull => null;
        /// <summary>Capture every diagnostic emitted by the service.</summary>
        public bool IsEnabled(LogLevel logLevel) => true;
        /// <summary>Assert sensitive exception objects are excluded and retain rendered fields.</summary>
        public void Log<TState>(LogLevel logLevel, EventId eventId, TState state, Exception? exception, Func<TState, Exception?, string> formatter)
        {
            Check(exception == null, "raw exception objects must not be passed to logging providers");
            Messages.Add(formatter(state, exception));
        }
    }

    private sealed class FakeWeChat : HttpMessageHandler
    {
        public string Mode = "ok";
        public int Covers, Images, Drafts, Tokens;
        public int Submissions, PublishStatus = 1;
        public string PublishMode = "ok", QueryMode = "ok", LastSubmittedMediaId = "";
        public string FaultKind = "", FaultEndpoint = "";
        public JsonElement LastArticle;
        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            Check(request.RequestUri!.Host == "api.weixin.qq.com", "requests use official host");
            // WeChat returns HTTP 412 for chunked JSON; inspect length before reading can buffer it.
            if (request.Content!.Headers.ContentLength == null || request.Headers.TransferEncodingChunked == true)
                return new HttpResponseMessage(HttpStatusCode.PreconditionFailed);
            if (request.RequestUri.AbsolutePath is "/cgi-bin/material/add_material" or "/cgi-bin/media/uploadimg")
            {
                // Match the official curl -F wire format, including actual file bytes, for both upload paths.
                var type = request.Content.Headers.ContentType!;
                var boundary = type.Parameters.Single(x => x.Name == "boundary").Value!;
                Check(type.MediaType == "multipart/form-data" && !boundary.Contains('"'), "upload boundary matches curl format");
                var wire = await request.Content.ReadAsByteArrayAsync(cancellationToken);
                var filename = request.RequestUri.AbsolutePath.EndsWith("add_material") ? "cover.png" : "image.png";
                var header = System.Text.Encoding.UTF8.GetBytes($"--{boundary}\r\nContent-Type: image/png\r\nContent-Disposition: form-data; name=\"media\"; filename=\"{filename}\"\r\n\r\n");
                var ending = System.Text.Encoding.UTF8.GetBytes($"\r\n--{boundary}--\r\n");
                Check(wire.SequenceEqual(header.Concat(ImageBytes).Concat(ending)), "media part includes quoted file fields and unchanged image bytes");
                Check(request.Content.Headers.ContentLength == wire.Length, "upload length matches serialized body bytes");
            }
            if (request.RequestUri.AbsolutePath == FaultEndpoint)
            {
                if (FaultKind == "dns") throw new HttpRequestException(HttpRequestError.NameResolutionError, "https://api.weixin.qq.com/?access_token=must-not-leak");
                if (FaultKind == "tls") throw new HttpRequestException(HttpRequestError.SecureConnectionError, "must-not-leak");
                if (FaultKind == "timeout") throw new TaskCanceledException("must-not-leak");
                return new HttpResponseMessage(FaultKind == "http" ? HttpStatusCode.BadGateway : HttpStatusCode.OK)
                { Content = new StringContent(FaultKind == "media-missing" ? "{\"errcode\":41005,\"errmsg\":\"must-not-leak\"}" :
                    FaultKind == "missing" ? "{\"errcode\":0,\"errmsg\":\"must-not-leak\"}" : "<html>must-not-leak</html>") };
            }
            object result;
            switch (request.RequestUri.AbsolutePath)
            {
                case "/cgi-bin/stable_token": Tokens++; result = new { access_token = "test-token", expires_in = 7200 }; break;
                case "/cgi-bin/material/add_material": Covers++; result = new { media_id = "cover-id" }; break;
                case "/cgi-bin/media/uploadimg": Images++; result = new { url = "https://mmbiz.qpic.cn/check.png" }; break;
                case "/cgi-bin/freepublish/submit":
                    Submissions++;
                    using (var json = JsonDocument.Parse(await request.Content!.ReadAsStringAsync(cancellationToken))) LastSubmittedMediaId = json.RootElement.GetProperty("media_id").GetString()!;
                    if (PublishMode == "timeout") throw new HttpRequestException("test-secret must not appear");
                    result = PublishMode == "rejected" ? (object)new { errcode = 48001, errmsg = "test-secret must not appear" } :
                        PublishMode == "missing-id" ? new { errcode = 0 } : new { publish_id = "publish-" + Submissions };
                    break;
                case "/cgi-bin/freepublish/get":
                    if (QueryMode == "timeout") throw new HttpRequestException("test-secret must not appear");
                    using (var json = JsonDocument.Parse(await request.Content!.ReadAsStringAsync(cancellationToken)))
                        Check(json.RootElement.GetProperty("publish_id").GetString()!.StartsWith("publish-"), "poll uses saved task identifier");
                    result = new { publish_status = PublishStatus, article_id = "must-not-store-id", article_detail = new { item = new[] { new { article_url = "https://example.com/must-not-store" } } } };
                    break;
                case "/cgi-bin/draft/add":
                    Drafts++;
                    using (var json = JsonDocument.Parse(await request.Content!.ReadAsStringAsync(cancellationToken))) LastArticle = json.RootElement.GetProperty("articles")[0].Clone();
                    if (Mode == "timeout") throw new HttpRequestException("test-secret must not appear in errors");
                    result = Mode == "rejected" ? (object)new { errcode = 48001, errmsg = "test-secret must not appear" } : new { media_id = "draft-" + Drafts };
                    break;
                default: throw new Exception("Unexpected endpoint.");
            }
            return new HttpResponseMessage(HttpStatusCode.OK) { Content = new StringContent(JsonSerializer.Serialize(result)) };
        }
    }
}
