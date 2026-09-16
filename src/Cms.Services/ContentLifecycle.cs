using System.Text.Json;
using Cms.Data;

namespace Cms.Services;

public sealed partial class ContentService
{
    private static string Snippet(Content row, string query)
    {
        var body = row.PublishedText;
        var index = body.IndexOf(query, StringComparison.OrdinalIgnoreCase);
        if (index < 0) return row.PublishedSummary;
        var start = Math.Max(0, index - 60);
        return (start > 0 ? "…" : "") + body.Substring(start, Math.Min(200, body.Length - start)) +
            (start + 200 < body.Length ? "…" : "");
    }

    private static async Task SetPublicationAsync(CmsRepository repo, Content row, ContentView snapshot)
    {
        await ValidateSeoAsync(repo, snapshot.Seo);
        await PublishAddressAsync(repo, row, snapshot.Slug);
        if (snapshot.Layout != null)
        {
            snapshot = snapshot with { Layout = snapshot.Layout with { Blocks = snapshot.Layout.Blocks.Where(x => !x.Hidden).ToArray() } };
            snapshot = snapshot with { Html = PageLayouts.Html(await ResolveLayoutAsync(repo, snapshot.Layout)) };
        }
        row.Published = true;
        row.PublishedAt ??= DateTime.UtcNow;
        row.LastPublishedAt = DateTime.UtcNow;
        row.PublishedJson = JsonSerializer.Serialize(snapshot with { Published = true, PublishedAt = row.PublishedAt,
            LastPublishedAt = row.LastPublishedAt, Version = row.Version + 1 });
        row.PublishedTitle = snapshot.Title;
        row.PublishedSummary = snapshot.Summary;
        row.PublishedCategoryId = snapshot.CategoryId;
        row.PublishedTagIds = Pack(snapshot.TagIds);
        row.PublishedText = PublishedSearchText(snapshot);
    }

    private static string PublishedSearchText(ContentView snapshot) => ContentText.Plain(snapshot.Html) + " " +
        string.Join(" ", (snapshot.Fields ?? []).Select(x => x.Label + " " + x.Value));

    private static async Task<int> AddRevisionAsync(CmsRepository repo, Content row, string actor, string action,
        ContentView? snapshot = null) => await repo.InsertAsync(new ContentRevision
        {
            ContentId = row.Id, Version = row.Version, Actor = (await repo.FindAsync<CmsUser>(actor))?.DisplayName ??
                (actor == "scheduler" ? "定时任务" : actor), Action = action,
            Title = snapshot?.Title ?? row.Title, SnapshotJson = JsonSerializer.Serialize(snapshot ?? Draft(row))
        });

    private static async Task EnsureHistoryAsync(CmsRepository repo, Content row, string actor)
    {
        if (await repo.CountAsync<ContentRevision>(x => x.ContentId == row.Id) != 0) return;
        await AddRevisionAsync(repo, row, actor, "original");
        if (row.PublishedJson != "") await AddRevisionAsync(repo, row, actor, "published-original", Published(row));
    }

    /// <summary>Page immutable history metadata.</summary>
    public async Task<PageResult<RevisionView>> RevisionsAsync(string id, int page)
    {
        _ = await repository.FindAsync<Content>(id) ?? throw Missing();
        var rows = await repository.PageAsync<ContentRevision>(x => x.ContentId == id, page, 20);
        return new(rows.Items.Select(x => new RevisionView(x.Id, x.Version, x.Action, x.Actor, x.Title, x.CreatedAt))
            .ToList(), rows.Total, rows.Page, rows.PageSize);
    }

    /// <summary>Read one historical snapshot belonging to the requested content.</summary>
    public async Task<ContentView> RevisionAsync(string id, string revision)
    {
        var row = await repository.FirstAsync<ContentRevision>(x => x.Id == revision && x.ContentId == id) ?? throw Missing();
        return JsonSerializer.Deserialize<ContentView>(row.SnapshotJson)!;
    }

    /// <summary>Restore a historical draft while leaving the current public snapshot intact.</summary>
    public Task<ContentView> RestoreRevisionAsync(string actor, string id, string revision, int version) =>
        repository.WriteAsync(actor, "content.restore-version", async repo =>
        {
            var service = new ContentService(repo, validator);
            var snapshot = await service.RevisionAsync(id, revision);
            var row = await service.GetAsync(id);
            if (row.Version != version) throw Conflict();
            var result = await service.SaveAsync(actor, id, new ContentInput(row.Kind, row.Slug, snapshot.Title,
                snapshot.Summary, snapshot.Html, snapshot.CoverId, snapshot.CategoryId, snapshot.TagIds, version, snapshot.Layout, snapshot.Seo, snapshot.Fields));
            repo.SetAuditTarget(row.Kind, row.Id, row.Title);
            return result;
        });

    /// <summary>Restore a recycled item as a draft or permanently remove it and its history.</summary>
    public Task<bool> RecycleAsync(string actor, string id, int version, bool purge) =>
        repository.WriteAsync(actor, purge ? "content.purge" : "content.restore", async repo =>
        {
            var row = await repo.FindAsync<Content>(id) ?? throw Missing();
            if (row.Version != version) throw Conflict();
            if (row.DeletedAt == null) throw new CmsException(400, "NOT_IN_TRASH", "请先将内容移入回收站。");
            repo.SetAuditTarget(row.Kind, row.Id, row.Title);
            if (purge)
            {
                await GuardBlockRemovalAsync(repo, row, true);
                if (await repo.CountAsync<MenuItem>(x => x.TargetId == id && x.Type == row.Kind) > 0)
                    throw new CmsException(409, "MENU_IN_USE", "导航仍引用此内容，请先移除导航项。");
                foreach (var comment in await repo.ListAsync<Comment>(x => x.ContentId == id)) await repo.DeleteAsync<Comment>(comment.Id);
                foreach (var revision in await repo.ListAsync<ContentRevision>(x => x.ContentId == id)) await repo.DeleteAsync<ContentRevision>(revision.Id);
                foreach (var alias in await repo.ListAsync<ContentRedirect>(x => x.ContentId == id)) await repo.DeleteAsync<ContentRedirect>(alias.Id);
                await repo.DeleteAsync<Content>(id);
            }
            else
            {
                row.DeletedAt = null;
                row.Published = false;
                await repo.SaveContentAsync(row, version);
                await AddRevisionAsync(repo, row, actor, "restore");
            }
            return true;
        });

    /// <summary>Copy an active draft with a fresh permanent address and no publication state.</summary>
    public async Task<ContentView> DuplicateAsync(string actor, string id)
    {
        var row = await GetAsync(id);
        var title = row.Title.Length > 194 ? row.Title[..194] : row.Title;
        return await SaveAsync(actor, null, new ContentInput(row.Kind, $"copy-{Guid.NewGuid():N}", title + "（副本）",
            row.Summary, row.Html, row.CoverId, row.CategoryId, row.TagIds, 0, row.Layout, row.Seo, row.Fields));
    }

    /// <summary>Validate every member before atomically changing a batch.</summary>
    public Task<bool> BatchAsync(string actor, ContentBatchInput input) => repository.WriteAsync(actor, "content.batch", async repo =>
    {
        if (input.Items is not { Length: > 0 and <= 100 } || input.Items.Any(x => x == null || string.IsNullOrEmpty(x.Id) || x.Version < 1) ||
            input.Items.Select(x => x.Id).Distinct().Count() != input.Items.Length ||
            input.Action is not ("category" or "unpublish")) throw new CmsException(400, "INVALID_BATCH", "请选择 1–100 条不同的内容和有效操作。");
        if (input.Action == "category" && input.CategoryId != "" &&
            await repo.FirstAsync<Taxonomy>(x => x.Id == input.CategoryId && x.Kind == "category") == null)
            throw new CmsException(400, "INVALID_CATEGORY", "分类不存在。");
        var rows = new List<Content>();
        foreach (var item in input.Items)
        {
            var row = await repo.FindAsync<Content>(item.Id) ?? throw Missing();
            if (row.DeletedAt != null) throw Missing();
            if (row.Version != item.Version) throw Conflict();
            if (input.Action == "unpublish") await GuardBlockRemovalAsync(repo, row);
            rows.Add(row);
        }
        foreach (var row in rows)
        {
            await EnsureHistoryAsync(repo, row, actor);
            if (input.Action == "category") row.CategoryId = input.CategoryId;
            else { row.Published = false; row.ScheduledPublishAt = row.ScheduledUnpublishAt = null; row.ScheduledJson = ""; }
            await repo.SaveContentAsync(row, row.Version);
            await AddRevisionAsync(repo, row, actor, "batch-" + input.Action);
        }
        repo.SetAuditTarget("content", "batch", $"{input.Action}: {rows.Count}");
        return true;
    });

    /// <summary>Freeze the selected draft for publication and independently schedule withdrawal.</summary>
    public Task<ContentView> ScheduleAsync(string actor, string id, ContentScheduleInput input) =>
        repository.WriteAsync(actor, "content.schedule", async repo =>
        {
            var row = await repo.FindAsync<Content>(id) ?? throw Missing();
            if (row.DeletedAt != null) throw Missing();
            if (row.Version != input.Version) throw Conflict();
            var now = DateTime.UtcNow;
            if (input.PublishAt <= now || input.UnpublishAt <= now || input.UnpublishAt <= input.PublishAt ||
                (input.PublishAt == null && input.UnpublishAt != null && !row.Published))
                throw new CmsException(400, "INVALID_SCHEDULE", "请选择未来的时间；下架时间须晚于发布，未发布内容请同时设置发布时间。");
            if (input.UnpublishAt != null) await GuardBlockRemovalAsync(repo, row);
            if (input.PublishAt != null)
            {
                await ValidateBlockPublicationAsync(repo, row, Draft(row));
                if (Draft(row).Layout is { } layout) await ResolveLayoutAsync(repo, layout);
            }
            await EnsureHistoryAsync(repo, row, actor);
            row.ScheduledPublishAt = input.PublishAt;
            row.ScheduledUnpublishAt = input.UnpublishAt;
            row.ScheduledJson = input.PublishAt == null ? "" : JsonSerializer.Serialize(Draft(row));
            repo.SetAuditTarget(row.Kind, row.Id, row.Title);
            await repo.SaveContentAsync(row, input.Version);
            return Draft((await repo.FindAsync<Content>(row.Id))!);
        });

    /// <summary>Apply elapsed schedules atomically; a missed publish window never exposes expired content.</summary>
    public async Task RunSchedulesAsync(Func<Content, Exception, Task>? onFailure = null)
    {
        var now = DateTime.UtcNow;
        var due = await repository.ListAsync<Content>(x => x.DeletedAt == null &&
            (x.ScheduledPublishAt <= now || x.ScheduledUnpublishAt <= now));
        foreach (var item in due)
        {
            try
            {
            await repository.WriteAsync("scheduler", "content.schedule-run", async repo =>
            {
                var row = await repo.FindAsync<Content>(item.Id);
                repo.SetAuditTarget(item.Kind, item.Id, item.Title);
                if (row == null || row.DeletedAt != null || !(row.ScheduledPublishAt <= now || row.ScheduledUnpublishAt <= now)) return false;
                if (row.ScheduledUnpublishAt <= now)
                {
                    await GuardBlockRemovalAsync(repo, row);
                    row.Published = false;
                    row.ScheduledPublishAt = row.ScheduledUnpublishAt = null;
                    row.ScheduledJson = "";
                }
                else if (row.ScheduledPublishAt <= now)
                {
                    var snapshot = JsonSerializer.Deserialize<ContentView>(row.ScheduledJson)!;
                    await ValidateBlockPublicationAsync(repo, row, snapshot);
                    await SetPublicationAsync(repo, row, snapshot);
                    row.ScheduledPublishAt = null;
                    row.ScheduledJson = "";
                }
                await repo.SaveContentAsync(row, row.Version);
                if (row.Published) await RefreshBlockSearchAsync(repo, row);
                await AddRevisionAsync(repo, row, "scheduler", "scheduled", row.Published ? Published(row) : Draft(row));
                return true;
            });
            }
            catch (Exception error) when (onFailure != null) { await onFailure(item, error); }
        }
    }

    /// <summary>Find stable chronological neighbors and up to four related published articles.</summary>
    public async Task<ContentDiscovery> DiscoveryAsync(string slug)
    {
        var row = await ResolveAddressAsync(repository, slug) ?? throw Missing();
        var neighbors = await repository.ContentNeighborsAsync(row);
        var candidates = await repository.PageAsync<Content>(x => x.Published && x.Kind == row.Kind && x.Id != row.Id &&
            row.PublishedCategoryId != "" && x.PublishedCategoryId == row.PublishedCategoryId, 1, 4, x => x.PublishedAt!);
        static ContentView? Summary(Content? c) => c == null ? null : Published(c) with { Html = "", Layout = null };
        return new(Summary(neighbors.Previous), Summary(neighbors.Next), candidates.Items.Select(x => Summary(x)!).ToList());
    }
}
