using System.Text.Json;
using System.Text.RegularExpressions;
using Cms.Data;

namespace Cms.Services;

public sealed partial class ContentService
{
    /// <summary>Canonical public route for a supported content kind.</summary>
    public static string PublicPath(string kind, string slug) => "/" + (kind switch {
        "post" => "posts", "product" => "products", "case" => "cases", _ => "pages" }) + "/" + slug;
    private static Task ValidateSeoAsync(CmsRepository repo, ContentSeo? seo) =>
        ValidateSeoAsync(id => repo.FindAsync<Asset>(id), seo);

    private static async Task ValidateSeoAsync(Func<string, Task<Asset?>> find, ContentSeo? seo)
    {
        if (seo == null) return;
        if (seo.Title == null || seo.Title.Length > 200 || seo.Description == null || seo.Description.Length > 500 ||
            seo.ImageId == null || !Regex.IsMatch(seo.ImageId, "^(?:[a-f0-9]{32})?$"))
            throw new CmsException(400, "INVALID_SEO", "请检查 SEO 标题、描述和分享图片。");
        if (seo.ImageId != "" && (await find(seo.ImageId))?.ContentType.StartsWith("image/") != true)
            throw new CmsException(400, "INVALID_ASSET", "分享图片不存在或附件不是图片。");
    }

    private static async Task ValidateAddressAsync(CmsRepository repo, string id, string slug)
    {
        if (await repo.FirstAsync<Content>(x => x.Id != id && (x.Slug == slug || x.DraftSlug == slug)) != null ||
            await repo.FirstAsync<ContentRedirect>(x => x.ContentId != id && x.Slug == slug) != null ||
            (await repo.ListAsync<Content>(x => x.Id != id && x.ScheduledJson != ""))
                .Any(x => JsonSerializer.Deserialize<ContentView>(x.ScheduledJson)?.Slug == slug))
            throw new CmsException(409, "DUPLICATE_SLUG", "该地址已被内容、旧链接或定时发布计划占用。");
    }

    private static async Task PublishAddressAsync(CmsRepository repo, Content row, string slug)
    {
        await ValidateAddressAsync(repo, row.Id, slug);
        if (row.Slug == slug) return;
        if (row.PublishedJson != "" && await repo.FirstAsync<ContentRedirect>(x => x.Slug == row.Slug) == null)
            await repo.InsertAsync(new ContentRedirect { Slug = row.Slug, ContentId = row.Id });
        var alias = await repo.FirstAsync<ContentRedirect>(x => x.Slug == slug && x.ContentId == row.Id);
        if (alias != null) await repo.DeleteAsync<ContentRedirect>(alias.Id);
        row.Slug = slug;
    }

    /// <summary>Resolve an old content URL directly to its currently published destination.</summary>
    public static async Task<Content?> ResolveAddressAsync(CmsRepository repo, string slug)
    {
        var row = await repo.FirstAsync<Content>(x => x.Slug == slug && x.Published && x.Kind != "template" && x.Kind != "block");
        if (row != null) return row;
        var alias = await repo.FirstAsync<ContentRedirect>(x => x.Slug == slug);
        return alias == null ? null : await repo.FirstAsync<Content>(x => x.Id == alias.ContentId && x.Published &&
            x.DeletedAt == null && x.Kind != "template" && x.Kind != "block");
    }
}
