using System.Text.Json;
using Cms.Data;
using FluentValidation;
using Ganss.Xss;

namespace Cms.Services;

/// <summary>Draft isolation, publication and public content queries.</summary>
public sealed class ContentService(CmsRepository repository, ContentValidator validator)
{
    private static readonly HtmlSanitizer Sanitizer = CreateSanitizer();
    private static HtmlSanitizer CreateSanitizer()
    {
        var s = new HtmlSanitizer();
        s.AllowedTags.Clear(); s.AllowedAttributes.Clear(); s.AllowedSchemes.Clear(); s.AllowedCssProperties.Clear();
        foreach (var tag in "p br h2 h3 h4 strong b em i u s ul ol li blockquote pre code a img table thead tbody tr th td hr".Split(' ')) s.AllowedTags.Add(tag);
        foreach (var attr in "href src alt title colspan rowspan".Split(' ')) s.AllowedAttributes.Add(attr);
        s.AllowedSchemes.Add("https"); s.AllowedSchemes.Add("http"); s.AllowedSchemes.Add("mailto");
        return s;
    }

    /// <summary>Read sanitized editorial content.</summary>
    public async Task<ContentView> GetAsync(string id) => Draft(await repository.FindAsync<Content>(id) ?? throw Missing());

    /// <summary>Read the published snapshot only.</summary>
    public async Task<ContentView> PublicAsync(string slug)
    {
        var row = await repository.FirstAsync<Content>(x => x.Slug == slug && x.Published) ?? throw Missing();
        return Published(row);
    }

    /// <summary>Page editorial or published content; public predicates use public fields.</summary>
    public async Task<PageResult<ContentView>> ListAsync(bool published, string kind, string? query, string? categoryId, string? tagId, int page, int size)
    {
        var q = (query ?? "").Trim(); var category = categoryId ?? ""; var tag = string.IsNullOrEmpty(tagId) ? "" : "|" + tagId + "|";
        if (q.Length > 200 || kind is not ("post" or "page")) throw new CmsException(400, "INVALID_QUERY", "查询条件无效。");
        var result = published
            ? await repository.PageAsync<Content>(x => x.Published && x.Kind == kind && (q == "" || x.PublishedTitle.Contains(q) || x.PublishedSummary.Contains(q)) && (category == "" || x.PublishedCategoryId == category) && (tag == "" || x.PublishedTagIds.Contains(tag)), page, size, x => x.PublishedAt!)
            : await repository.PageAsync<Content>(x => x.Kind == kind && (q == "" || x.Title.Contains(q) || x.Summary.Contains(q)), page, size);
        return new(result.Items.Select(x => (published ? Published(x) : Draft(x)) with { Html = "" }).ToList(), result.Total, result.Page, result.PageSize);
    }

    /// <summary>Apply stored page sizes for public list requests.</summary>
    public async Task<PageResult<ContentView>> PublicListAsync(string kind, string? query, string? categoryId, string? tagId, int page, int? size, bool search = false)
    {
        var settings = await repository.FindAsync<SiteSettings>("site") ?? new SiteSettings();
        var defaultSize = !string.IsNullOrEmpty(categoryId) ? settings.CategoryPageSize : !string.IsNullOrEmpty(tagId) ? settings.TagPageSize : query != null || search ? settings.SearchPageSize : settings.HomePageSize;
        return await ListAsync(true, kind, query, categoryId, tagId, page, size ?? defaultSize);
    }

    /// <summary>Create or save a draft without touching the published snapshot.</summary>
    public async Task<ContentView> SaveAsync(string actor, string? id, ContentInput input)
    {
        await validator.ValidateAndThrowAsync(input);
        var clean = Sanitizer.Sanitize(input.Html);
        return await repository.WriteAsync(actor, "content.save", async repo =>
        {
            var row = id == null ? new Content() : await repo.FindAsync<Content>(id) ?? throw Missing();
            if (id != null && row.Version != input.Version) throw Conflict();
            if (id != null && (row.Slug != input.Slug || row.Kind != input.Kind))
                throw new CmsException(400, "STABLE_URL", "创建后文章类型和地址不可修改。");
            if (await repo.FirstAsync<Content>(x => x.Slug == input.Slug && x.Id != row.Id) != null)
                throw new CmsException(409, "DUPLICATE_SLUG", "该地址已被使用。");
            if (input.CategoryId != "" && await repo.FirstAsync<Taxonomy>(x => x.Id == input.CategoryId && x.Kind == "category") == null) throw new CmsException(400, "INVALID_CATEGORY", "分类不存在。");
            foreach (var tag in input.TagIds.Distinct())
                if (await repo.FirstAsync<Taxonomy>(x => x.Id == tag && x.Kind == "tag") == null) throw new CmsException(400, "INVALID_TAG", "标签不存在。");
            await ValidateAssetReferences(repo, clean, input.CoverId);
            row.Kind = input.Kind; row.Slug = input.Slug; row.Title = input.Title.Trim(); row.Summary = input.Summary.Trim(); row.Html = clean;
            row.CoverId = input.CoverId; row.CategoryId = input.CategoryId; row.TagIds = Pack(input.TagIds);
            repo.SetAuditTarget(row.Kind, row.Id, row.Title);
            if (id == null) await repo.InsertAsync(row); else await repo.SaveContentAsync(row, input.Version);
            return Draft(row);
        });
    }

    /// <summary>Atomically publish or withdraw an expected content version.</summary>
    public Task<ContentView> PublishAsync(string actor, string id, int version, bool publish) => repository.WriteAsync(actor, publish ? "content.publish" : "content.unpublish", async repo =>
    {
        var row = await repo.FindAsync<Content>(id) ?? throw Missing();
        if (row.Version != version) throw Conflict();
        row.Published = publish;
        if (publish)
        {
            row.PublishedAt = DateTime.UtcNow;
            row.PublishedJson = JsonSerializer.Serialize(Draft(row) with { Version = version + 1 });
            row.PublishedTitle = row.Title; row.PublishedSummary = row.Summary; row.PublishedCategoryId = row.CategoryId; row.PublishedTagIds = row.TagIds;
        }
        repo.SetAuditTarget(row.Kind, row.Id, row.Title);
        await repo.SaveContentAsync(row, version); return Draft(row);
    });

    /// <summary>Delete content and its comments in one transaction.</summary>
    public Task<bool> DeleteAsync(string actor, string id, int version) => repository.WriteAsync(actor, "content.delete", async repo =>
    {
        var row = await repo.FindAsync<Content>(id) ?? throw Missing();
        if (row.Version != version) throw Conflict();
        if (await repo.CountAsync<MenuItem>(x => x.TargetId == id && x.Type == row.Kind) > 0)
            throw new CmsException(409, "MENU_IN_USE", "导航菜单引用了此内容，请先修改或删除对应菜单项。");
        repo.SetAuditTarget(row.Kind, row.Id, row.Title);
        foreach (var comment in await repo.ListAsync<Comment>(x => x.ContentId == id)) await repo.DeleteAsync<Comment>(comment.Id);
        await repo.DeleteAsync<Content>(id); return true;
    });

    /// <summary>All published URLs for the sitemap.</summary>
    public async Task<IReadOnlyList<ContentView>> SitemapAsync() => (await repository.ListAsync<Content>(x => x.Published)).Select(x => Published(x) with { Html = "" }).ToList();

    /// <summary>Decode the draft model.</summary>
    public static ContentView Draft(Content c) => new(c.Id, c.Kind, c.Slug, c.Title, c.Summary, c.Html, c.CoverId, c.CategoryId, Unpack(c.TagIds), c.Version, c.Published, c.PublishedAt);
    /// <summary>Decode only the committed public snapshot.</summary>
    public static ContentView Published(Content c) => JsonSerializer.Deserialize<ContentView>(c.PublishedJson) ?? throw new InvalidOperationException("Invalid publication snapshot.");
    /// <summary>Portable bounded tag encoding.</summary>
    public static string Pack(IEnumerable<string> values) => "|" + string.Join('|', values.Distinct().Order()) + "|";
    /// <summary>Decode tag identifiers.</summary>
    public static string[] Unpack(string value) => value.Split('|', StringSplitOptions.RemoveEmptyEntries);

    private static async Task ValidateAssetReferences(CmsRepository repo, string html, string cover)
    {
        var document = new AngleSharp.Html.Parser.HtmlParser().ParseDocument(html);
        foreach (var image in document.QuerySelectorAll("img"))
            if (!System.Text.RegularExpressions.Regex.IsMatch(image.GetAttribute("src") ?? "", "^/media/[a-f0-9]{32}$"))
                throw new CmsException(400, "INVALID_IMAGE", "正文图片请先上传，使用附件库提供的图片地址。");
        foreach (var anchor in document.QuerySelectorAll("a[href]"))
        {
            var href = anchor.GetAttribute("href")!;
            if (Uri.UnescapeDataString(href).Contains("/media/", StringComparison.OrdinalIgnoreCase) && !System.Text.RegularExpressions.Regex.IsMatch(href, "^/media/[a-f0-9]{32}$"))
                throw new CmsException(400, "INVALID_ASSET_URL", "附件链接请使用附件库提供的原始地址。");
        }
        var ids = System.Text.RegularExpressions.Regex.Matches(html, "/media/([a-f0-9]{32})").Select(x => x.Groups[1].Value).Append(cover).Where(x => x != "").Distinct();
        foreach (var asset in ids) if (await repo.FindAsync<Asset>(asset) == null) throw new CmsException(400, "INVALID_ASSET", "引用的附件不存在。");
    }
    private static CmsException Missing() => new(404, "NOT_FOUND", "内容不存在或尚未发布。");
    private static CmsException Conflict() => new(409, "VERSION_CONFLICT", "内容已被修改，请重新加载。");
}
