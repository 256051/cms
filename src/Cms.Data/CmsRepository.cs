using System.Linq.Expressions;
using System.Text.Json;

namespace Cms.Data;

/// <summary>Business failure safe to return through the API.</summary>
public sealed class CmsException(int status, string code, string message, int? retryAfterSeconds = null)
    : Exception(message)
{
    /// <summary>HTTP status.</summary>
    public int Status { get; } = status;

    /// <summary>Stable business code.</summary>
    public string Code { get; } = code;

    /// <summary>Optional retry delay for temporary throttling.</summary>
    public int? RetryAfterSeconds { get; } = retryAfterSeconds;
}

/// <summary>Server-side paginated result.</summary>
public record PageResult<T>(IReadOnlyList<T> Items, long Total, int Page, int PageSize);

/// <summary>FreeSql persistence boundary with atomic audited writes.</summary>
public sealed partial class CmsRepository(IFreeSql database)
{
    /// <summary>Latest explicitly numbered database schema understood by this build.</summary>
    public const int CurrentSchemaVersion = 14;
    // ponytail: one writer per API process; single API instance only. Use database locks before scaling out.
    private static readonly SemaphoreSlim Writes = new(1, 1);
    private readonly IFreeSql db = database;
    private AuditEntry? auditTarget;
    private List<Action>? rollbackActions;
    private string tokenId = "", tokenName = "";

    /// <summary>Identify the validated integration for writes inside this transaction.</summary>
    public void SetIntegrationActor(string id, string name)
    {
        tokenId = id;
        tokenName = name;
    }

    /// <summary>Compensate a file write if an enclosing integration transaction fails.</summary>
    public void OnRollback(Action action)
    {
        rollbackActions?.Add(action);
    }

    /// <summary>Attach a safe object identity to the current write transaction.</summary>
    public void SetAuditTarget(string type, string id, string name)
    {
        auditTarget = new AuditEntry { TargetType = type, TargetId = id, TargetName = name };
    }

    /// <summary>Find one entity by primary key.</summary>
    public Task<T?> FindAsync<T>(string id) where T : Entity
    {
        return db.Select<T>().Where(x => x.Id == id).FirstAsync()!;
    }

    /// <summary>Find one matching entity.</summary>
    public Task<T?> FirstAsync<T>(Expression<Func<T, bool>> predicate) where T : Entity
    {
        return db.Select<T>().Where(predicate).FirstAsync()!;
    }

    /// <summary>List entities using a database predicate and stable order.</summary>
    public Task<List<T>> ListAsync<T>(Expression<Func<T, bool>>? predicate = null) where T : Entity
    {
        return db.Select<T>().WhereIf(predicate != null, predicate!).OrderBy(x => x.CreatedAt).OrderBy(x => x.Id)
            .ToListAsync();
    }

    /// <summary>Count matching entities.</summary>
    public Task<long> CountAsync<T>(Expression<Func<T, bool>>? predicate = null) where T : Entity
    {
        return db.Select<T>().WhereIf(predicate != null, predicate!).CountAsync();
    }

    /// <summary>Query a stable newest-first page.</summary>
    public async Task<PageResult<T>> PageAsync<T>(Expression<Func<T, bool>> predicate, int page, int size,
        Expression<Func<T, object>>? sort = null) where T : Entity
    {
        page = Math.Max(1, page);
        size = Math.Clamp(size, 1, 100);
        var query = db.Select<T>().Where(predicate);
        var total = await query.CountAsync();
        var items = await query.OrderByDescending(sort ?? (x => x.CreatedAt)).OrderBy(x => x.Id).Page(page, size)
            .ToListAsync();
        return new PageResult<T>(items, total, page, size);
    }

    /// <summary>Insert inside the caller's repository transaction.</summary>
    public Task<int> InsertAsync<T>(T item) where T : Entity
    {
        return db.Insert(item).ExecuteAffrowsAsync();
    }

    /// <summary>Replace an existing entity.</summary>
    public Task<int> UpdateAsync<T>(T item) where T : Entity
    {
        return db.Update<T>().SetSource(item).ExecuteAffrowsAsync();
    }

    /// <summary>Delete an entity by identifier.</summary>
    public Task<int> DeleteAsync<T>(string id) where T : Entity
    {
        return db.Delete<T>().Where(x => x.Id == id).ExecuteAffrowsAsync();
    }

    /// <summary>Read only navigation fields of selected published content.</summary>
    public Task<List<Content>> MenuContentsAsync(string[] ids)
    {
        return db.Select<Content>().Where(x => x.Published && ids.Contains(x.Id)).ToListAsync(x =>
            new Content { Id = x.Id, Kind = x.Kind, Slug = x.Slug, PublishedTitle = x.PublishedTitle });
    }

    /// <summary>Search published menu destinations without transferring body snapshots.</summary>
    public async Task<PageResult<Content>> MenuTargetsAsync(string kind, string query, int page)
    {
        page = Math.Max(1, page);
        var select = db.Select<Content>().Where(x =>
            x.Published && x.Kind == kind && (query == "" || x.PublishedTitle.Contains(query)));
        var total = await select.CountAsync();
        var rows = await select.OrderByDescending(x => x.PublishedAt).OrderBy(x => x.Id).Page(page, 20).ToListAsync(x =>
            new Content { Id = x.Id, Kind = x.Kind, Slug = x.Slug, PublishedTitle = x.PublishedTitle });
        return new PageResult<Content>(rows, total, page, 20);
    }

    /// <summary>Replace one expected menu revision inside the write transaction.</summary>
    public async Task SaveMenuAsync(MenuItem row, int expected)
    {
        row.Version = checked(expected + 1);
        if (await db.Update<MenuItem>().SetSource(row).Where(x => x.Version == expected).ExecuteAffrowsAsync() != 1)
            throw new CmsException(409, "VERSION_CONFLICT", "菜单已被其他管理员修改，请重新加载后再保存。");
    }

    /// <summary>Save all site options at one expected revision inside an audited transaction.</summary>
    public async Task SaveSettingsAsync(SiteSettings row, int expected)
    {
        row.Version = checked(expected + 1);
        if (await db.Update<SiteSettings>().SetSource(row).Where(x => x.Version == expected).ExecuteAffrowsAsync() != 1)
            throw new CmsException(409, "VERSION_CONFLICT", "站点设置已被其他管理员修改，请保留输入后重新加载。");
    }

    /// <summary>Compare-and-swap an editorial version.</summary>
    public async Task SaveContentAsync(Content content, int expected)
    {
        content.Version = checked(expected + 1);
        content.UpdatedAt = DateTime.UtcNow;
        var changed = await db.Update<Content>().SetSource(content).Where(x => x.Version == expected)
            .ExecuteAffrowsAsync();
        if (changed != 1) throw new CmsException(409, "VERSION_CONFLICT", "内容已被其他人修改，请重新加载后再保存。");
    }

    /// <summary>Compare-and-swap the complete theme state inside a write transaction.</summary>
    public async Task SaveThemeAsync(ThemeState state, int expected)
    {
        state.Version = checked(expected + 1);
        if (await db.Update<ThemeState>().SetSource(state).Where(x => x.Version == expected).ExecuteAffrowsAsync() != 1)
            throw new CmsException(409, "VERSION_CONFLICT", "主题已被其他管理员修改，请重新加载后再保存。");
    }

    /// <summary>Execute a serialized transaction; callback only receives the transaction repository.</summary>
    public Task<T> WriteAsync<T>(string actor, string action, Func<CmsRepository, Task<T>> work)
    {
        return TransactionAsync(async scoped =>
        {
            scoped.auditTarget = null;
            var result = await work(scoped);
            var account = await scoped.FindAsync<CmsUser>(actor);
            var entry = scoped.auditTarget ??
                        throw new InvalidOperationException("Audited writes must identify their business object.");
            entry.Actor = account == null ? actor : $"{account.DisplayName} ({actor})";
            entry.Action = action;
            entry.TokenId = scoped.tokenId;
            entry.TokenName = scoped.tokenName;
            await scoped.InsertAsync(entry);
            return result;
        });
    }

    /// <summary>Commit the business write, its audit and replay response together; authorize every replay.</summary>
    public Task<T> ExecuteOnceAsync<T>(string token, string keyHash, string requestHash, DateTime now,
        Func<CmsRepository, Task> authorize, Func<CmsRepository, Task<T>> work)
    {
        return TransactionAsync(async scoped =>
        {
            await authorize(scoped);
            await scoped.db.Delete<IntegrationRequest>().Where(x => x.ExpiresAt <= now).ExecuteAffrowsAsync();
            var prior = await scoped.FirstAsync<IntegrationRequest>(x => x.TokenId == token && x.KeyHash == keyHash);
            if (prior != null)
            {
                if (prior.RequestHash != requestHash)
                    throw new CmsException(409, "IDEMPOTENCY_CONFLICT", "同一请求编号已用于不同操作或内容，请检查请求。");
                return JsonSerializer.Deserialize<T>(prior.ResponseJson)!;
            }

            var result = await work(scoped);
            await scoped.InsertAsync(new IntegrationRequest
            {
                TokenId = token, KeyHash = keyHash, RequestHash = requestHash,
                ResponseJson = JsonSerializer.Serialize(result), ExpiresAt = now.AddHours(24)
            });
            return result;
        });
    }

    /// <summary>Update non-secret usage metadata without flooding the audit trail.</summary>
    public Task<int> TouchTokenAsync(string id, DateTime now)
    {
        return TransactionAsync(scoped =>
            scoped.db.Update<AccessToken>()
                .Where(x => x.Id == id && (x.LastUsedAt == null || x.LastUsedAt < now.AddMinutes(-1)))
                .Set(x => x.LastUsedAt, now).ExecuteAffrowsAsync());
    }

    private async Task<T> TransactionAsync<T>(Func<CmsRepository, Task<T>> work)
    {
        if (rollbackActions != null) return await work(this);
        await Writes.WaitAsync();
        try
        {
            using var unit = db.CreateUnitOfWork();
            var scoped = new CmsRepository(unit.Orm) { rollbackActions = [] };
            try
            {
                var result = await work(scoped);
                unit.Commit();
                return result;
            }
            catch
            {
                unit.Rollback();
                foreach (var undo in scoped.rollbackActions) undo();
                throw;
            }
        }
        finally
        {
            Writes.Release();
        }
    }

    /// <summary>Apply ordered schema upgrades; creating an uninitialized database requires explicit permission.</summary>
    /// <param name="allowCreate">Allow initial schema creation for the initialize and migrate commands.</param>
    public async Task InitializeSchemaAsync(bool allowCreate = true)
    {
        var version = 0;
        if (db.DbFirst.ExistsTable("cms_schema"))
        {
            var current = await FirstAsync<SchemaVersion>(x => x.Id == "schema");
            version = current?.Version ?? throw new InvalidOperationException("数据库缺少版本记录，拒绝自动猜测结构。");
            if (version < 1) throw new InvalidOperationException("数据库版本无效，请检查备份与初始化记录。");
        }

        if (version > CurrentSchemaVersion || version < 0) throw new InvalidOperationException("数据库版本与程序不兼容，拒绝降级。");
        if (version == CurrentSchemaVersion) return;
        if (version == 0)
        {
            if (!allowCreate) throw new InvalidOperationException("数据库尚未初始化，请先执行 --initialize 创建站点。");
            db.CodeFirst.SyncStructure(typeof(CmsUser), typeof(Content), typeof(Taxonomy), typeof(Asset),
                typeof(Comment), typeof(MenuItem), typeof(SiteSettings), typeof(AuditEntry), typeof(SchemaVersion));
            await InsertAsync(new SchemaVersion { Id = "schema", Version = 1 });
        }

        // v1 -> v2: additive audit object columns only. DDL may not be transactional on every provider;
        // repeatable sync finishes the columns before advancing the version, so interrupted upgrades can resume.
        if (version < 2)
        {
            db.CodeFirst.SyncStructure(typeof(AuditEntry));
            await db.Update<SchemaVersion>().Where(x => x.Id == "schema").Set(x => x.Version, 2).ExecuteAffrowsAsync();
        }

        // v2 -> v3: one state record; defaults preserve the existing classic site.
        if (version < 3)
        {
            db.CodeFirst.SyncStructure(typeof(ThemeState));
            if (await FindAsync<ThemeState>("site") == null) await InsertAsync(new ThemeState { Id = "site" });
            await db.Update<SchemaVersion>().Where(x => x.Id == "schema").Set(x => x.Version, 3).ExecuteAffrowsAsync();
        }

        // v3 -> v4: keep existing links; missing fields represent top-level custom navigation.
        if (version < 4)
        {
            db.CodeFirst.SyncStructure(typeof(MenuItem));
            await db.Update<MenuItem>().Where(x => x.Type == "" || x.Type == null).Set(x => x.Type, "custom")
                .ExecuteAffrowsAsync();
            await db.Update<MenuItem>().Where(x => x.ParentId == null).Set(x => x.ParentId, "").ExecuteAffrowsAsync();
            await db.Update<MenuItem>().Where(x => x.TargetId == null).Set(x => x.TargetId, "").ExecuteAffrowsAsync();
            await db.Update<SchemaVersion>().Where(x => x.Id == "schema").Set(x => x.Version, 4).ExecuteAffrowsAsync();
        }

        // v4 -> v5: preserve existing identity fields, initialize only the newly introduced options.
        // No API instance may serve requests during upgrades; interrupted DDL can safely repeat this step.
        if (version < 5)
        {
            db.CodeFirst.SyncStructure(typeof(SiteSettings));
            await db.Update<SiteSettings>().Where(x => x.Id == "site")
                .Set(x => x.Subtitle, "").Set(x => x.FaviconId, "").Set(x => x.Language, "zh-CN")
                .Set(x => x.HomePageSize, 12).Set(x => x.CategoryPageSize, 12).Set(x => x.TagPageSize, 12)
                .Set(x => x.SearchPageSize, 12)
                .Set(x => x.BlockSearchEngines, false).Set(x => x.CommentsEnabled, true)
                .Set(x => x.RequireCommentApproval, true)
                .Set(x => x.CommentsRequireLogin, false).Set(x => x.FooterText, "").Set(x => x.Version, 0)
                .ExecuteAffrowsAsync();
            await db.Update<SchemaVersion>().Where(x => x.Id == "schema").Set(x => x.Version, 5).ExecuteAffrowsAsync();
        }

        // v5 -> v6: additive machine credentials, retry receipts and audit attribution.
        if (version < 6)
        {
            db.CodeFirst.SyncStructure(typeof(AccessToken), typeof(IntegrationRequest), typeof(AuditEntry));
            await db.Update<SchemaVersion>().Where(x => x.Id == "schema").Set(x => x.Version, 6).ExecuteAffrowsAsync();
        }

        // v6 -> v7: independent traffic and private inquiry tables; editorial tables remain untouched.
        if (version < 7)
        {
            db.CodeFirst.SyncStructure(typeof(VisitorProfile), typeof(PageVisit), typeof(ContentTraffic),
                typeof(VisitEvent), typeof(CustomerLead));
            await db.Update<SchemaVersion>().Where(x => x.Id == "schema").Set(x => x.Version, 7).ExecuteAffrowsAsync();
        }

        // v7 -> v8: additive visit IP and region snapshots; historical addresses remain unknown.
        if (version < 8)
        {
            db.CodeFirst.SyncStructure(typeof(VisitorProfile), typeof(PageVisit));
            await db.Update<SchemaVersion>().Where(x => x.Id == "schema").Set(x => x.Version, 8).ExecuteAffrowsAsync();
        }
        // v8 -> v9: additive editorial recovery, follow-up and maintenance records.
        if (version < 9)
        {
        db.CodeFirst.SyncStructure(typeof(Content), typeof(ContentRevision), typeof(CustomerLead),
            typeof(LeadFollowUp), typeof(MaintenanceState), typeof(ContentAudience));
        foreach (var content in await ListAsync<Content>())
        {
            if (content.PublishedJson != "")
            {
                using var snapshot = JsonDocument.Parse(content.PublishedJson);
                content.PublishedText = ContentText.Plain(snapshot.RootElement.GetProperty("Html").GetString() ?? "");
                content.LastPublishedAt ??= content.PublishedAt;
                await UpdateAsync(content);
            }
        }
        var audience = await db.Select<PageVisit>().Where(x => x.ContentId != "")
            .GroupBy(x => new { x.ContentId, x.VisitorId })
            .ToListAsync(x => new ContentAudience { ContentId = x.Key.ContentId, VisitorId = x.Key.VisitorId });
        foreach (var row in audience)
            if (await FirstAsync<ContentAudience>(x => x.ContentId == row.ContentId && x.VisitorId == row.VisitorId) == null)
                await InsertAsync(row);
        await db.Update<SchemaVersion>().Where(x => x.Id == "schema").Set(x => x.Version, 9).ExecuteAffrowsAsync();
        }
        // v9 -> v10: page layouts and an optional home page; existing HTML and theme selection remain intact.
        if (version < 10)
        {
        db.CodeFirst.SyncStructure(typeof(Content), typeof(SiteSettings));
        await db.Update<Content>().Where(x => x.LayoutJson == null).Set(x => x.LayoutJson, "").ExecuteAffrowsAsync();
        await db.Update<SiteSettings>().Where(x => x.HomePageId == null).Set(x => x.HomePageId, "").ExecuteAffrowsAsync();
        await db.Update<SchemaVersion>().Where(x => x.Id == "schema").Set(x => x.Version, 10).ExecuteAffrowsAsync();
        }
        // v10 -> v11: durable notification results and the activation boundary.
        if (version < 11)
        {
        db.CodeFirst.SyncStructure(typeof(NotificationDelivery), typeof(NotificationState));
        await db.Update<SchemaVersion>().Where(x => x.Id == "schema").Set(x => x.Version, 11).ExecuteAffrowsAsync();
        }
        // v11 -> v12: draft SEO and addresses, with direct old-address redirects.
        if (version < 12)
        {
        db.CodeFirst.SyncStructure(typeof(Content), typeof(ContentRedirect));
        await db.Update<Content>().Where(x => x.DraftSlug == null).Set(x => x.DraftSlug, "").ExecuteAffrowsAsync();
        await db.Update<Content>().Where(x => x.SeoJson == null).Set(x => x.SeoJson, "").ExecuteAffrowsAsync();
        await db.Update<SchemaVersion>().Where(x => x.Id == "schema").Set(x => x.Version, 12).ExecuteAffrowsAsync();
        }
        // v12 -> v13: attachment metadata only; the storage name and file bytes are unchanged.
        if (version < 13)
        {
        db.CodeFirst.SyncStructure(typeof(Asset));
        await db.Update<Asset>().Where(x => x.Group == null).Set(x => x.Group, "").ExecuteAffrowsAsync();
        await db.Update<Asset>().Where(x => x.Version < 1).Set(x => x.Version, 1).ExecuteAffrowsAsync();
        await db.Update<SchemaVersion>().Where(x => x.Id == "schema").Set(x => x.Version, 13).ExecuteAffrowsAsync();
        }
        // v13 -> v14: business attributes and configurable inquiry fields; original content and leads remain intact.
        db.CodeFirst.SyncStructure(typeof(Content), typeof(CustomerLead), typeof(InquiryFormSettings));
        await db.Update<Content>().Where(x => x.FieldsJson == null).Set(x => x.FieldsJson, "").ExecuteAffrowsAsync();
        await db.Update<CustomerLead>().Where(x => x.FieldsJson == null).Set(x => x.FieldsJson, "[]").ExecuteAffrowsAsync();
        await db.Update<SchemaVersion>().Where(x => x.Id == "schema").Set(x => x.Version, 14).ExecuteAffrowsAsync();
    }

    /// <summary>Check database connectivity and expected schema without modifying it.</summary>
    public async Task<bool> ReadyAsync()
    {
        return (await FindAsync<SchemaVersion>("schema"))?.Version == CurrentSchemaVersion;
    }
}
