using System.Text.Json;
using System.Text.RegularExpressions;
using AngleSharp.Html.Parser;
using Cms.Data;
using FluentValidation;

namespace Cms.Services;

/// <summary>Draft isolation, publication and public content queries.</summary>
public sealed partial class ContentService(CmsRepository repository, ContentValidator validator)
{
    /// <summary>Read sanitized editorial content.</summary>
    public async Task<ContentView> GetAsync(string id)
    {
        var row = await repository.FindAsync<Content>(id) ?? throw Missing();
        if (row.DeletedAt != null) throw Missing();
        return (await WithMetricsAsync([Draft(row)]))[0];
    }

    /// <summary>Read the published snapshot only.</summary>
    public async Task<ContentView> PublicAsync(string slug)
    {
        var row = await ResolveAddressAsync(repository, slug) ?? throw Missing();
        return (await ResolvePublishedAsync(repository, row)) with { Views = (await repository.FindAsync<ContentTraffic>(row.Id))?.Views ?? 0 };
    }

    /// <summary>Page editorial or published content; public predicates use public fields.</summary>
    public async Task<PageResult<ContentView>> ListAsync(bool published, string kind, string? query, string? categoryId,
        string? tagId, int page, int size, string sort = "recent", string status = "")
    {
        var q = (query ?? "").Trim();
        var category = categoryId ?? "";
        var tag = string.IsNullOrEmpty(tagId) ? "" : "|" + tagId + "|";
        if (q.Length > 200 || kind is not ("post" or "page" or "template" or "block" or "product" or "case") || published && kind is ("template" or "block") || sort is not ("recent" or "views") ||
            status is not ("" or "draft" or "published" or "trash")) throw new CmsException(400, "INVALID_QUERY", "查询条件无效。");
        var result = published
            ? await repository.PageAsync<Content>(
                x => x.Published && x.Kind == kind &&
                     (q == "" || x.PublishedTitle.Contains(q) || x.PublishedSummary.Contains(q) || x.PublishedText.Contains(q)) &&
                     (category == "" || x.PublishedCategoryId == category) &&
                     (tag == "" || x.PublishedTagIds.Contains(tag)), page, size, x => x.PublishedAt!)
            : sort == "views" ? await repository.ContentByViewsAsync(kind, q, page, size, status, category, tag)
            : await repository.PageAsync<Content>(
                x => x.Kind == kind && (q == "" || x.Title.Contains(q) || x.Summary.Contains(q)) &&
                    (status == "trash" ? x.DeletedAt != null : x.DeletedAt == null) &&
                    (status != "draft" || !x.Published) && (status != "published" || x.Published) &&
                    (category == "" || x.CategoryId == category) && (tag == "" || x.TagIds.Contains(tag)), page, size);
        var items = result.Items.Select(x => (published ? Published(x) : Draft(x)) with
            { Html = "", Layout = null, Summary = published && q != "" ? Snippet(x, q) : (published ? x.PublishedSummary : x.Summary) }).ToList();
        if (!published) items = await WithMetricsAsync(items);
        return new PageResult<ContentView>(items, result.Total, result.Page, result.PageSize);
    }

    private async Task<List<ContentView>> WithMetricsAsync(List<ContentView> items)
    {
        if (items.Count == 0) return items;
        var metrics = (await repository.ContentMetricsAsync(items.Select(x => x.Id).ToArray(), TrafficService.TodayUtc()))
            .ToDictionary(x => x.ContentId);
        return items.Select(x => metrics.TryGetValue(x.Id, out var counts)
            ? x with { Views = counts.Views, TodayViews = counts.TodayViews, Visitors = counts.Visitors } : x).ToList();
    }

    /// <summary>Apply stored page sizes for public list requests.</summary>
    public async Task<PageResult<ContentView>> PublicListAsync(string kind, string? query, string? categoryId,
        string? tagId, int page, int? size, bool search = false)
    {
        var settings = await repository.FindAsync<SiteSettings>("site") ?? new SiteSettings();
        var defaultSize = !string.IsNullOrEmpty(categoryId) ? settings.CategoryPageSize :
            !string.IsNullOrEmpty(tagId) ? settings.TagPageSize :
            query != null || search ? settings.SearchPageSize : settings.HomePageSize;
        return await ListAsync(true, kind, query, categoryId, tagId, page, size ?? defaultSize);
    }

    /// <summary>Create or save a draft without touching the published snapshot.</summary>
    public async Task<ContentView> SaveAsync(string actor, string? id, ContentInput input)
    {
        await validator.ValidateAndThrowAsync(input);
        var layout = input.Layout == null ? null : PageLayouts.Validate(input.Layout);
        var fields = BusinessFields.Validate(input.Fields);
        if (fields.Length > 0 && input.Kind is not ("product" or "case")) throw BusinessFields.Bad();
        var clean = ContentHtml.Sanitize(layout == null ? input.Html : PageLayouts.Html(layout));
        return await repository.WriteAsync(actor, "content.save", async repo =>
        {
            var row = id == null ? new Content() : await repo.FindAsync<Content>(id) ?? throw Missing();
            if (row.DeletedAt != null) throw Missing();
            if (id != null && row.Version != input.Version) throw Conflict();
            if (id != null && row.Kind != input.Kind)
                throw new CmsException(400, "STABLE_KIND", "创建后内容类型不可修改。");
            await ValidateAddressAsync(repo, row.Id, input.Slug);
            await ValidateSeoAsync(repo, input.Seo);
            if (input.CategoryId != "" &&
                await repo.FirstAsync<Taxonomy>(x => x.Id == input.CategoryId && x.Kind == "category") == null)
                throw new CmsException(400, "INVALID_CATEGORY", "分类不存在。");
            foreach (var tag in input.TagIds.Distinct())
                if (await repo.FirstAsync<Taxonomy>(x => x.Id == tag && x.Kind == "tag") == null)
                    throw new CmsException(400, "INVALID_TAG", "标签不存在。");
            await ValidateAssetReferences(repo, layout == null ? clean : PageLayouts.Html(layout, true), input.CoverId);
            foreach (var category in layout?.Blocks.Select(x => x.CategoryId).Where(x => x != "").Distinct() ?? [])
                if (await repo.FirstAsync<Taxonomy>(x => x.Id == category && x.Kind == "category") == null)
                    throw new CmsException(400, "INVALID_CATEGORY", "页面模块引用的分类不存在。");
            if (input.Kind == "block" && layout!.Blocks.Any(x => x.Type == "shared"))
                throw new CmsException(400, "NESTED_BLOCK", "公共区块不能引用公共区块，请改用独立复制。");
            if (layout != null) await ResolveLayoutAsync(repo, layout);
            if (id != null) await EnsureHistoryAsync(repo, row, actor);
            row.Kind = input.Kind;
            if (id == null) row.Slug = input.Slug;
            row.DraftSlug = input.Slug;
            row.SeoJson = JsonSerializer.Serialize(input.Seo ?? new());
            row.FieldsJson = JsonSerializer.Serialize(fields);
            row.Title = input.Title.Trim();
            row.Summary = input.Summary.Trim();
            row.Html = clean;
            row.LayoutJson = layout == null ? "" : JsonSerializer.Serialize(layout);
            row.CoverId = input.CoverId;
            row.CategoryId = input.CategoryId;
            row.TagIds = Pack(input.TagIds);
            repo.SetAuditTarget(row.Kind, row.Id, row.Title);
            if (id == null) await repo.InsertAsync(row);
            else await repo.SaveContentAsync(row, input.Version);
            await AddRevisionAsync(repo, row, actor, "save");
            return Draft((await repo.FindAsync<Content>(row.Id))!);
        });
    }

    /// <summary>Atomically publish or withdraw an expected content version.</summary>
    public Task<ContentView> PublishAsync(string actor, string id, int version, bool publish)
    {
        return repository.WriteAsync(actor, publish ? "content.publish" : "content.unpublish", async repo =>
        {
            var row = await repo.FindAsync<Content>(id) ?? throw Missing();
            if (row.DeletedAt != null) throw Missing();
            if (row.Version != version) throw Conflict();
            if (!publish) await GuardBlockRemovalAsync(repo, row);
            else await ValidateBlockPublicationAsync(repo, row, Draft(row));
            await EnsureHistoryAsync(repo, row, actor);
            row.Published = publish;
            if (publish)
            {
                await SetPublicationAsync(repo, row, Draft(row));
            }
            row.ScheduledPublishAt = null;
            row.ScheduledJson = "";
            if (!publish) row.ScheduledUnpublishAt = null;

            repo.SetAuditTarget(row.Kind, row.Id, row.Title);
            await repo.SaveContentAsync(row, version);
            if (publish) await RefreshBlockSearchAsync(repo, row);
            await AddRevisionAsync(repo, row, actor, publish ? "publish" : "unpublish");
            return Draft((await repo.FindAsync<Content>(row.Id))!);
        });
    }

    /// <summary>Move content to the recycle bin, preserving comments and attachment references.</summary>
    public Task<bool> DeleteAsync(string actor, string id, int version)
    {
        return repository.WriteAsync(actor, "content.delete", async repo =>
        {
            var row = await repo.FindAsync<Content>(id) ?? throw Missing();
            if (row.Version != version) throw Conflict();
            if (row.DeletedAt != null) throw Missing();
            await GuardBlockRemovalAsync(repo, row);
            if (await repo.CountAsync<MenuItem>(x => x.TargetId == id && x.Type == row.Kind) > 0)
                throw new CmsException(409, "MENU_IN_USE", "导航菜单引用了此内容，请先修改或删除对应菜单项。");
            if ((await repo.FindAsync<SiteSettings>("site"))?.HomePageId == id)
                throw new CmsException(409, "HOME_IN_USE", "此页面被选为网站首页，请先在站点设置中更换首页。");
            repo.SetAuditTarget(row.Kind, row.Id, row.Title);
            await EnsureHistoryAsync(repo, row, actor);
            row.DeletedAt = DateTime.UtcNow;
            row.Published = false;
            row.ScheduledPublishAt = row.ScheduledUnpublishAt = null;
            row.ScheduledJson = "";
            await repo.SaveContentAsync(row, version);
            return true;
        });
    }

    /// <summary>All published URLs for the sitemap.</summary>
    public async Task<IReadOnlyList<ContentView>> SitemapAsync()
    {
        return (await repository.ListAsync<Content>(x => x.Published && x.Kind != "template" && x.Kind != "block")).Select(x => Published(x) with { Html = "", Layout = null }).Where(x => x.Seo?.NoIndex != true)
            .ToList();
    }

    /// <summary>Decode the draft model.</summary>
    public static ContentView Draft(Content c)
    {
        return new ContentView(c.Id, c.Kind, c.DraftSlug == "" ? c.Slug : c.DraftSlug, c.Title, c.Summary, c.Html, c.CoverId, c.CategoryId,
            Unpack(c.TagIds),
            c.Version, c.Published, c.PublishedAt, UpdatedAt: c.UpdatedAt, LastPublishedAt: c.LastPublishedAt,
            DeletedAt: c.DeletedAt, ScheduledPublishAt: c.ScheduledPublishAt, ScheduledUnpublishAt: c.ScheduledUnpublishAt,
            Layout: c.LayoutJson == "" ? null : JsonSerializer.Deserialize<PageLayout>(c.LayoutJson),
            Seo: c.SeoJson == "" ? new() : JsonSerializer.Deserialize<ContentSeo>(c.SeoJson),
            Fields: c.FieldsJson == "" ? [] : JsonSerializer.Deserialize<ContentField[]>(c.FieldsJson), PublicSlug: c.Published ? c.Slug : "");
    }

    /// <summary>Resolve the selected home page using only its published snapshot; unavailable pages fall back to the blog.</summary>
    public async Task<ContentView?> HomeAsync()
    {
        var id = (await repository.FindAsync<SiteSettings>("site"))?.HomePageId;
        if (string.IsNullOrEmpty(id)) return null;
        var row = await repository.FirstAsync<Content>(x => x.Id == id && x.Kind == "page" && x.Published && x.DeletedAt == null);
        return row == null ? null : await ResolvePublishedAsync(repository, row);
    }

    /// <summary>Read a reusable template's published layout, without exposing it to public routes.</summary>
    public async Task<ContentView> TemplateAsync(string id)
    {
        var row = await repository.FirstAsync<Content>(x => x.Id == id && x.Kind == "template" && x.Published && x.DeletedAt == null) ?? throw Missing();
        return Published(row);
    }

    /// <summary>Decode only the committed public snapshot.</summary>
    public static ContentView Published(Content c)
    {
        var snapshot = JsonSerializer.Deserialize<ContentView>(c.PublishedJson) ??
               throw new InvalidOperationException("Invalid publication snapshot.");
        return snapshot with { PublishedAt = c.PublishedAt, LastPublishedAt = c.LastPublishedAt,
            UpdatedAt = c.LastPublishedAt, DeletedAt = null, ScheduledPublishAt = null, ScheduledUnpublishAt = null, PublicSlug = c.Slug };
    }

    /// <summary>Portable bounded tag encoding.</summary>
    public static string Pack(IEnumerable<string> values)
    {
        return "|" + string.Join('|', values.Distinct().Order()) + "|";
    }

    /// <summary>Decode tag identifiers.</summary>
    public static string[] Unpack(string value)
    {
        return value.Split('|', StringSplitOptions.RemoveEmptyEntries);
    }

    private static Task ValidateAssetReferences(CmsRepository repo, string html, string cover) =>
        ValidateAssetReferences(id => repo.FindAsync<Asset>(id), html, cover);

    private static async Task ValidateAssetReferences(Func<string, Task<Asset?>> find, string html, string cover)
    {
        var document = new HtmlParser().ParseDocument(html);
        foreach (var media in document.QuerySelectorAll("img, video, audio"))
        {
            var source = media.GetAttribute("src") ?? "";
            if (!Regex.IsMatch(source, "^/media/[a-f0-9]{32}$"))
                throw new CmsException(400, "INVALID_MEDIA", "正文图片、视频和音频请先上传，使用附件库提供的地址。");
            var asset = await find(source[7..]);
            var prefix = media.LocalName == "img" ? "image/" : media.LocalName + "/";
            if (asset == null || !asset.ContentType.StartsWith(prefix, StringComparison.Ordinal))
                throw new CmsException(400, "INVALID_ASSET", "媒体类型与附件不匹配，或引用的附件不存在。");
        }

        foreach (var anchor in document.QuerySelectorAll("a[href]"))
        {
            var href = anchor.GetAttribute("href")!;
            if (Uri.UnescapeDataString(href).Contains("/media/", StringComparison.OrdinalIgnoreCase) &&
                !Regex.IsMatch(href, "^/media/[a-f0-9]{32}$"))
                throw new CmsException(400, "INVALID_ASSET_URL", "附件链接请使用附件库提供的原始地址。");
        }

        var ids = Regex.Matches(html, "/media/([a-f0-9]{32})").Select(x => x.Groups[1].Value).Append(cover)
            .Where(x => x != "").Distinct();
        foreach (var asset in ids)
            if (await find(asset) == null)
                throw new CmsException(400, "INVALID_ASSET", "引用的附件不存在。");
    }

    private static CmsException Missing()
    {
        return new CmsException(404, "NOT_FOUND", "内容不存在或尚未发布。");
    }

    private static CmsException Conflict()
    {
        return new CmsException(409, "VERSION_CONFLICT", "内容已被修改，请重新加载。");
    }
}
