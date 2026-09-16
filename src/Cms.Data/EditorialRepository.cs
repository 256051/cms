namespace Cms.Data;

public sealed partial class CmsRepository
{
    /// <summary>List distinct nonempty library groups without loading file records.</summary>
    public Task<List<string>> AssetGroupsAsync() => db.Select<Asset>().Where(x => x.Group != "")
        .GroupBy(x => x.Group).OrderBy(x => x.Key).ToListAsync(x => x.Key);
    /// <summary>Refresh derived public search text without changing the editor's optimistic version.</summary>
    public Task<int> UpdatePublishedTextAsync(string id, string text) => db.Update<Content>()
        .Set(x => x.PublishedText, text).Where(x => x.Id == id).ExecuteAffrowsAsync();

    /// <summary>Return neighboring public entries using first publication and stable slug ties.</summary>
    public async Task<(Content? Previous, Content? Next)> ContentNeighborsAsync(Content row)
    {
        // Compare stored timestamps to each other, avoiding provider parameter precision truncation.
        var previous = await db.Select<Content, Content>().InnerJoin((x, current) => current.Id == row.Id)
            .Where((x, current) => x.Published && x.Kind == row.Kind && x.Id != row.Id &&
                (x.PublishedAt < current.PublishedAt || (x.PublishedAt == current.PublishedAt && x.Slug.CompareTo(current.Slug) < 0)))
            .OrderByDescending((x, current) => x.PublishedAt).OrderByDescending((x, current) => x.Slug).Limit(1).ToListAsync((x, current) => x);
        var next = await db.Select<Content, Content>().InnerJoin((x, current) => current.Id == row.Id)
            .Where((x, current) => x.Published && x.Kind == row.Kind && x.Id != row.Id &&
                (x.PublishedAt > current.PublishedAt || (x.PublishedAt == current.PublishedAt && x.Slug.CompareTo(current.Slug) > 0)))
            .OrderBy((x, current) => x.PublishedAt).OrderBy((x, current) => x.Slug).Limit(1).ToListAsync((x, current) => x);
        return (previous.FirstOrDefault(), next.FirstOrDefault());
    }
}
