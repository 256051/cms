namespace Cms.Data;

public sealed partial class CmsRepository
{
    /// <summary>Rotate status queries fairly; drafts still preparing or awaiting repair cannot block ready publications.</summary>
    public Task<List<WeChatPublication>> PendingWeChatPublicationsAsync(string appId) => db.Select<WeChatPublication>()
        .Where(x => x.AppId == appId && (x.Status == "publishing" || x.Status == "queued" &&
            db.Select<WeChatDraft>().Where(d => d.Id == x.Id && (d.Status == "draft" || d.Status == "cancelled")).Any()))
        .OrderBy(x => x.UpdatedAt).OrderBy(x => x.Id).Limit(10).ToListAsync();
}
