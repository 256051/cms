using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Cms.Data;

namespace Cms.Services;

/// <summary>A retained page or template that uses a synchronized block.</summary>
public record BlockReference(string ContentId, string Kind, string Title, string Source, bool Deleted);

public sealed partial class ContentService
{
    /// <summary>Read only a published reusable block for insertion or independent copying.</summary>
    public async Task<ContentView> BlockAsync(string id) => Published(await repository.FirstAsync<Content>(
        x => x.Id == id && x.Kind == "block" && x.Published && x.DeletedAt == null) ?? throw Missing());

    /// <summary>Preview an unsaved layout using the same published blocks as the public website.</summary>
    public Task<PageLayout> PreviewLayoutAsync(PageLayout layout) => ResolveLayoutAsync(repository, PageLayouts.Validate(layout));

    /// <summary>Resolve synchronized blocks without reading their drafts or permitting nested references.</summary>
    public static async Task<ContentView> ResolvePublishedAsync(CmsRepository repo, Content row)
    {
        var snapshot = Published(row);
        if (snapshot.Layout == null) return snapshot;
        var layout = await ResolveLayoutAsync(repo, snapshot.Layout);
        return snapshot with { Layout = layout, Html = PageLayouts.Html(layout) };
    }

    private static async Task<PageLayout> ResolveLayoutAsync(CmsRepository repo, PageLayout layout,
        string replacingId = "", ContentView? replacement = null)
    {
        var blocks = new List<PageBlock>();
        var shared = new Dictionary<string, ContentView>();
        foreach (var block in layout.Blocks)
        {
            if (block.Type != "shared") { blocks.Add(block); continue; }
            if (!shared.TryGetValue(block.SharedId, out var snapshot))
            {
                var row = block.SharedId == replacingId ? null : await repo.FirstAsync<Content>(
                    x => x.Id == block.SharedId && x.Kind == "block" && x.Published && x.DeletedAt == null);
                snapshot = block.SharedId == replacingId ? replacement! : row == null
                    ? throw new CmsException(409, "BLOCK_UNAVAILABLE", "引用的公共区块尚未发布或已不可用，请先发布区块或移除引用。") : Published(row);
                shared[block.SharedId] = snapshot;
            }
            if (snapshot.Layout == null || snapshot.Layout.Blocks.Any(x => x.Type == "shared"))
                throw new CmsException(400, "NESTED_BLOCK", "公共区块不能再引用公共区块，请改用独立复制。");
            foreach (var child in snapshot.Layout.Blocks.Where(x => !x.Hidden))
                blocks.Add(child with {
                    Id = Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(block.Id + child.Id)))[..32],
                    Hidden = block.Hidden || child.Hidden,
                    Mobile = (child.Mobile ?? new()) with { Hidden = block.Mobile?.Hidden == true || child.Mobile?.Hidden == true }
                });
        }
        return PageLayouts.Validate(layout with { Blocks = blocks.ToArray() });
    }

    private static bool UsesBlock(string json, string id) => json != "" &&
        JsonSerializer.Deserialize<ContentView>(json)?.Layout?.Blocks.Any(x => x.Type == "shared" && x.SharedId == id) == true;

    private static async Task GuardBlockRemovalAsync(CmsRepository repo, Content row, bool purge = false)
    {
        if (row.Kind != "block") return;
        var references = await BlockReferencesAsync(repo, row.Id);
        var blocking = references.Where(x => purge || x.Source is "公开页面" or "定时发布").ToArray();
        if (blocking.Length != 0) throw new CmsException(409, "BLOCK_IN_USE",
            $"公共区块仍被“{blocking[0].Title}”等 {blocking.Length} 处引用，请先在引用位置移除或改为独立副本。");
    }

    /// <summary>Locate live, draft, scheduled and historical references before removing a reusable block.</summary>
    public Task<IReadOnlyList<BlockReference>> BlockReferencesAsync(string id) => BlockReferencesAsync(repository, id);

    private static async Task<IReadOnlyList<BlockReference>> BlockReferencesAsync(CmsRepository repo, string id)
    {
        var block = await repo.FindAsync<Content>(id) ?? throw Missing();
        if (block.Kind != "block") throw Missing();
        var result = new List<BlockReference>();
        // ponytail: one site's content and history are scanned; add a reference index when this becomes costly.
        foreach (var row in await repo.ListAsync<Content>(x => x.Kind != "block"))
        {
            void Add(string source) => result.Add(new(row.Id, row.Kind, row.Title, source, row.DeletedAt != null));
            if (row.LayoutJson != "" && JsonSerializer.Deserialize<PageLayout>(row.LayoutJson)?.Blocks.Any(x => x.SharedId == id) == true) Add("草稿");
            if (UsesBlock(row.PublishedJson, id)) Add(row.Published && row.DeletedAt == null ? "公开页面" : "保留的发布快照");
            if (UsesBlock(row.ScheduledJson, id)) Add("定时发布");
            if ((await repo.ListAsync<ContentRevision>(x => x.ContentId == row.Id && x.SnapshotJson.Contains(id)))
                .Any(x => UsesBlock(x.SnapshotJson, id))) Add("历史版本");
        }
        return result;
    }

    private static async Task ValidateBlockPublicationAsync(CmsRepository repo, Content row, ContentView snapshot)
    {
        if (row.Kind != "block") return;
        if (snapshot.Layout == null || snapshot.Layout.Blocks.Any(x => x.Type == "shared"))
            throw new CmsException(400, "NESTED_BLOCK", "公共区块不能引用其他公共区块。");
        foreach (var target in await repo.ListAsync<Content>(x => x.Kind != "block" && x.DeletedAt == null))
            foreach (var json in new[] { target.Published ? target.PublishedJson : "", target.ScheduledJson })
                if (UsesBlock(json, row.Id))
                    await ResolveLayoutAsync(repo, JsonSerializer.Deserialize<ContentView>(json)!.Layout!, row.Id, snapshot);
    }

    private static async Task RefreshBlockSearchAsync(CmsRepository repo, Content row)
    {
        if (row.Kind != "block") return;
        foreach (var target in await repo.ListAsync<Content>(x => x.Published && x.Kind != "block" && x.Kind != "template"))
            if (UsesBlock(target.PublishedJson, row.Id))
                await repo.UpdatePublishedTextAsync(target.Id, PublishedSearchText(await ResolvePublishedAsync(repo, target)));
    }
}
