using System.IO.Compression;
using System.Security.Cryptography;
using System.Text.Json;
using System.Text.RegularExpressions;
using AngleSharp.Html.Parser;
using Cms.Data;
using FluentValidation;
using Microsoft.Extensions.Configuration;

namespace Cms.Services;

/// <summary>Export explicit selections or all matching nondeleted drafts, independently of pagination.</summary>
public record ContentExportInput(string Kind, string[]? Ids = null, string Q = "", string Status = "",
    string CategoryId = "", string TagId = "");
/// <summary>Portable draft and its previous public address, without site history or publication state.</summary>
public record PackageContent(ContentInput Draft, string PublicSlug = "");
/// <summary>Portable archive label with a package-local identifier.</summary>
public record PackageTaxonomy(string Id, string Kind, string Name, string Slug);
/// <summary>Verified binary stored at assets/Id inside the archive.</summary>
public record PackageAsset(string Id, string Name, string Group, string Sha256);
/// <summary>Versioned portable CMS content archive manifest.</summary>
public record ContentPackage(string Format, int Version, string Kind, PackageContent[] Contents,
    PackageTaxonomy[] Taxonomy, PackageAsset[] Assets);
/// <summary>One newly imported draft and any changed reading address.</summary>
public record ImportedContent(string Id, string Title, string SourceSlug, string Slug);
/// <summary>Committed import result, including newly stored attachments.</summary>
public record ContentImportResult(ImportedContent[] Items, int Assets, int Renamed);

public sealed partial class ContentService
{
    /// <summary>Maximum compressed package size; compatible with existing 53 MiB reverse proxies.</summary>
    public const long PackageBytes = 50 * 1024 * 1024;
    private const int PackageItems = 100, ManifestBytes = 8 * 1024 * 1024;
    private const long ExpandedBytes = 150 * 1024 * 1024;
    private static readonly JsonSerializerOptions PackageJson = new(JsonSerializerDefaults.Web)
    { RespectNullableAnnotations = true, RespectRequiredConstructorParameters = true };

    /// <summary>Export current drafts with deduplicated media and resolved independent shared sections.</summary>
    public Task<byte[]> ExportPackageAsync(string actor, ContentExportInput input, AssetService assets, CancellationToken cancellation)
    {
        CheckPackageKind(input.Kind);
        if (input.Ids is { Length: > PackageItems } || input.Ids?.Any(x => !PackageId(x)) == true ||
            input.Status is not ("" or "draft" or "published") || input.Q == null || input.Q.Length > 200 ||
            !PackageId(input.CategoryId, true) || !PackageId(input.TagId, true)) throw PackageError("导出筛选条件无效，每次最多 100 条。");
        // A bounded audited transaction keeps drafts, taxonomy and files consistent while exporting.
        return repository.WriteAsync(actor, "content.export", async repo =>
        {
            var ids = input.Ids?.Distinct().ToArray() ?? [];
            if (ids.Length == 0)
            {
                var listing = await new ContentService(repo, validator).ListAsync(false, input.Kind, input.Q,
                    input.CategoryId, input.TagId, 1, PackageItems, status: input.Status);
                if (listing.Total > PackageItems) throw PackageError("筛选结果超过 100 条，请缩小范围或勾选后分批导出。");
                ids = listing.Items.Select(x => x.Id).ToArray();
            }
            if (ids.Length == 0) throw PackageError("没有可以导出的内容。");
            var rows = await repo.ListAsync<Content>(x => ids.Contains(x.Id) && x.Kind == input.Kind && x.DeletedAt == null);
            if (rows.Count != ids.Length) throw PackageError("部分内容不存在、已删除或类型不匹配，请刷新后重试。");
            var contents = new List<PackageContent>();
            foreach (var row in rows)
            {
                cancellation.ThrowIfCancellationRequested();
                var draft = Draft(row);
                var layout = draft.Layout == null ? null : await ResolveLayoutAsync(repo, draft.Layout);
                contents.Add(new(new(draft.Kind, draft.Slug, draft.Title, draft.Summary,
                    layout == null ? draft.Html : PageLayouts.Html(layout), draft.CoverId, draft.CategoryId,
                    draft.TagIds, 0, layout, draft.Seo, draft.Fields), draft.PublicSlug));
            }
            var terms = new List<PackageTaxonomy>();
            foreach (var id in contents.SelectMany(x => PackageTerms(x.Draft)).Distinct())
            {
                var term = await repo.FindAsync<Taxonomy>(id) ?? throw PackageError("内容引用的分类或标签不存在。");
                terms.Add(new(term.Id, term.Kind, term.Name, term.Slug));
            }
            var media = new List<PackageAsset>();
            using var output = new MemoryStream();
            using (var zip = new ZipArchive(output, ZipArchiveMode.Create, true))
            {
                long expanded = 0;
                foreach (var id in contents.SelectMany(x => PackageMedia(x.Draft)).Distinct())
                {
                    if (media.Count >= 500) throw PackageError("附件超过 500 个，请分批导出。");
                    var row = await repo.FindAsync<Asset>(id) ?? throw PackageError("内容引用的附件不存在。");
                    var file = await assets.ReadAsync(id, true);
                    await using var stream = File.OpenRead(file.Path);
                    var bytes = await ReadPackageBytes(stream, PackageBytes, cancellation);
                    expanded += bytes.LongLength;
                    if (expanded > ExpandedBytes) throw PackageError("附件总大小超过 150 MB，请分批导出。");
                    media.Add(new(id, row.Name, row.Group, Convert.ToHexStringLower(SHA256.HashData(bytes))));
                    await WritePackageEntry(zip, "assets/" + id, bytes, cancellation);
                    if (output.Length > PackageBytes) throw PackageError("压缩包超过 50 MB，请分批导出。");
                }
                var manifest = JsonSerializer.SerializeToUtf8Bytes(new ContentPackage("cms-content", 1, input.Kind,
                    contents.ToArray(), terms.ToArray(), media.ToArray()), PackageJson);
                if (manifest.Length > ManifestBytes || expanded + manifest.Length > ExpandedBytes)
                    throw PackageError("正文或布局数据过大，请分批导出。");
                await WritePackageEntry(zip, "content.json", manifest, cancellation);
            }
            if (output.Length > PackageBytes) throw PackageError("压缩包超过 50 MB，请分批导出。");
            repo.SetAuditTarget("content-package", "", $"{PackageLabel(input.Kind)} · {contents.Count} 条");
            return output.ToArray();
        });
    }

    /// <summary>Validate a complete archive before atomically creating new drafts and remapping all package references.</summary>
    public async Task<ContentImportResult> ImportPackageAsync(string actor, string kind, Stream input,
        IConfiguration configuration, CancellationToken cancellation)
    {
        CheckPackageKind(kind);
        ContentPackage package;
        var binaries = new Dictionary<string, byte[]>();
        var metadata = new Dictionary<string, Asset>();
        var storage = new AssetService(repository, configuration);
        try
        {
            using var bytes = new MemoryStream(await ReadPackageBytes(input, PackageBytes, cancellation));
            using var zip = new ZipArchive(bytes, ZipArchiveMode.Read);
            if (zip.Entries.Count is < 1 or > 501 || zip.Entries.Select(x => x.FullName).Distinct().Count() != zip.Entries.Count ||
                zip.Entries.Any(x => x.Length < 0 || x.Length > PackageBytes ||
                    x.FullName != "content.json" && !Regex.IsMatch(x.FullName, "^assets/[a-f0-9]{32}$")) ||
                zip.Entries.Sum(x => x.Length) > ExpandedBytes) throw PackageError("压缩包条目、路径或解压大小无效。");
            var manifest = zip.GetEntry("content.json") ?? throw PackageError("不是 CMS 内容包：缺少 content.json。");
            await using (var json = manifest.Open())
            {
                var data = await ReadPackageBytes(json, ManifestBytes, cancellation);
                if (data.LongLength != manifest.Length) throw PackageError("清单的实际大小无效。");
                package = JsonSerializer.Deserialize<ContentPackage>(data, PackageJson) ?? throw PackageError("内容清单为空。");
            }
            if (package.Format != "cms-content" || package.Version != 1 || package.Kind != kind ||
                package.Contents.Length is < 1 or > PackageItems || package.Contents.Any(x => x == null || x.Draft == null) ||
                package.Contents.Select(x => x.Draft.Slug).Distinct().Count() != package.Contents.Length ||
                package.Assets.Length > 500 || package.Assets.Any(x => x == null || !PackageId(x.Id)) ||
                package.Assets.Select(x => x.Id).Distinct().Count() != package.Assets.Length ||
                package.Taxonomy.Length > 4000 || package.Taxonomy.Any(x => x == null || !PackageId(x.Id)) ||
                package.Taxonomy.Select(x => x.Id).Distinct().Count() != package.Taxonomy.Length ||
                zip.Entries.Count != package.Assets.Length + 1) throw PackageError("内容包版本、类型、数量或标识无效，请在对应列表导入。");
            long expanded = manifest.Length;
            foreach (var asset in package.Assets)
            {
                var entry = zip.GetEntry("assets/" + asset.Id) ?? throw PackageError("内容包缺少附件。");
                await using var file = entry.Open();
                var data = await ReadPackageBytes(file, Math.Min(PackageBytes, ExpandedBytes - expanded), cancellation);
                expanded += data.LongLength;
                if (data.LongLength != entry.Length) throw PackageError("附件的实际大小与清单不一致。");
                if (Convert.ToHexStringLower(SHA256.HashData(data)) != asset.Sha256) throw PackageError("附件校验失败，内容包可能已损坏。");
                metadata.Add(asset.Id, storage.PrepareUpload(asset.Name, data, asset.Group));
                binaries.Add(asset.Id, data);
            }
        }
        catch (Exception e) when (e is InvalidDataException or JsonException or NotSupportedException)
        { throw PackageError("无法读取 ZIP 内容包：文件已损坏或清单格式无效。"); }

        var terms = package.Taxonomy.ToDictionary(x => x.Id);
        foreach (var term in terms.Values) SiteService.ValidateTaxonomy(new(term.Kind, term.Name, term.Slug));
        if (terms.Values.Select(x => (x.Kind, x.Slug)).Distinct().Count() != terms.Count)
            throw PackageError("内容包中存在重复的分类或标签地址。");
        Task<Asset?> FindAsset(string id) => Task.FromResult(metadata.GetValueOrDefault(id));
        foreach (var item in package.Contents)
        {
            var draft = item.Draft;
            if (draft.Kind != kind || item.PublicSlug.Length > 160 || item.PublicSlug != "" && !Regex.IsMatch(item.PublicSlug, "^[a-z0-9]+(?:-[a-z0-9]+)*$"))
                throw PackageError("内容类型或原地址无效。");
            await validator.ValidateAndThrowAsync(draft);
            if (draft.TagIds.Any(id => !PackageId(id))) throw PackageError("标签标识无效。");
            var fields = BusinessFields.Validate(draft.Fields);
            if (kind == "page" && fields.Length > 0) throw PackageError("独立页面不支持产品业务字段。");
            if (draft.Layout != null)
            {
                _ = PageLayouts.Validate(draft.Layout);
                if (draft.Layout.Blocks.Any(x => x.Type == "shared")) throw PackageError("请从原站重新导出，以包含公共区块的完整内容。");
            }
            foreach (var id in PackageTerms(draft))
                if (!terms.ContainsKey(id)) throw PackageError("内容包缺少引用的分类或标签。");
            if (draft.CategoryId != "" && terms[draft.CategoryId].Kind != "category" ||
                draft.TagIds.Any(id => terms[id].Kind != "tag") ||
                draft.Layout?.Blocks.Any(x => x.CategoryId != "" && terms[x.CategoryId].Kind != "category") == true)
                throw PackageError("分类或标签类型不匹配。");
            await ValidateAssetReferences(FindAsset, ContentHtml.Sanitize(PackageHtml(draft)), draft.CoverId);
            await ValidateSeoAsync(FindAsset, draft.Seo);
        }
        // Use the normal editorial services inside one enclosing transaction, including their file rollback hooks.
        return await repository.WriteAsync(actor, "content.import", async repo =>
        {
            var slugs = new Dictionary<string, string>();
            foreach (var item in package.Contents)
            {
                var original = item.Draft.Slug;
                var slug = original;
                while (true)
                {
                    try { await ValidateAddressAsync(repo, "", slug); if (!slugs.Values.Contains(slug)) break; }
                    catch (CmsException e) when (e.Code == "DUPLICATE_SLUG") { }
                    slug = ImportSlug(original, 160);
                }
                slugs.Add(original, slug);
            }
            var termMap = new Dictionary<string, string>();
            var paths = new Dictionary<string, string>();
            var site = new SiteService(repo, new SettingsValidator());
            foreach (var term in package.Taxonomy)
            {
                var existing = await repo.FirstAsync<Taxonomy>(x => x.Kind == term.Kind && x.Slug == term.Slug);
                var slug = term.Slug;
                if (existing != null && existing.Name != term.Name.Trim())
                {
                    do { slug = ImportSlug(term.Slug, 100); }
                    while (await repo.FirstAsync<Taxonomy>(x => x.Kind == term.Kind && x.Slug == slug) != null);
                    existing = null;
                }
                var saved = existing ?? await site.SaveTaxonomyAsync(actor, null, new(term.Kind, term.Name, slug));
                termMap.Add(term.Id, saved.Id);
                paths["/" + term.Kind + "/" + term.Slug] = "/" + term.Kind + "/" + saved.Slug;
            }
            var mediaMap = new Dictionary<string, string>();
            var uploader = new AssetService(repo, configuration);
            foreach (var asset in package.Assets)
            {
                using var file = new MemoryStream(binaries[asset.Id]);
                var saved = await uploader.UploadAsync(actor, asset.Name, file, cancellation, asset.Group);
                mediaMap.Add(asset.Id, saved.Id);
                paths["/media/" + asset.Id] = "/media/" + saved.Id;
            }
            foreach (var item in package.Contents)
            {
                paths[PublicPath(kind, item.Draft.Slug)] = PublicPath(kind, slugs[item.Draft.Slug]);
                if (item.PublicSlug != "") paths[PublicPath(kind, item.PublicSlug)] = PublicPath(kind, slugs[item.Draft.Slug]);
            }
            var result = new List<ImportedContent>();
            var editor = new ContentService(repo, validator);
            foreach (var item in package.Contents)
            {
                cancellation.ThrowIfCancellationRequested();
                var draft = RemapPackage(item.Draft, mediaMap, termMap, paths) with { Slug = slugs[item.Draft.Slug], Version = 0 };
                var saved = await editor.SaveAsync(actor, null, draft);
                result.Add(new(saved.Id, saved.Title, item.Draft.Slug, saved.Slug));
            }
            cancellation.ThrowIfCancellationRequested();
            repo.SetAuditTarget("content-package", "", $"{PackageLabel(kind)} · {result.Count} 条");
            return new ContentImportResult(result.ToArray(), package.Assets.Length, result.Count(x => x.Slug != x.SourceSlug));
        });
    }

    private static ContentInput RemapPackage(ContentInput draft, Dictionary<string, string> media,
        Dictionary<string, string> terms, Dictionary<string, string> paths)
    {
        // Media URLs can also appear as copied text or inside layout text, not only HTML attributes.
        draft = JsonSerializer.Deserialize<ContentInput>(Regex.Replace(JsonSerializer.Serialize(draft, PackageJson),
            "/media/([a-f0-9]{32})", match => media.TryGetValue(match.Groups[1].Value, out var id)
                ? "/media/" + id : match.Value), PackageJson)!;
        string Map(Dictionary<string, string> map, string id) => id == "" ? "" : map[id];
        string Link(string value)
        {
            var suffix = value.IndexOfAny(['?', '#']);
            var path = suffix < 0 ? value : value[..suffix];
            return paths.TryGetValue(path, out var replacement) ? replacement + (suffix < 0 ? "" : value[suffix..]) : value;
        }
        string Html(string value)
        {
            var document = new HtmlParser().ParseDocument(ContentHtml.Sanitize(value));
            foreach (var element in document.QuerySelectorAll("[src], [href], [poster]"))
                foreach (var name in new[] { "src", "href", "poster" })
                    if (element.GetAttribute(name) is { } url) element.SetAttribute(name, Link(url));
            return document.Body!.InnerHtml;
        }
        var layout = draft.Layout == null ? null : draft.Layout with { Blocks = draft.Layout.Blocks.Select(block => block with {
            ImageId = Map(media, block.ImageId), CategoryId = Map(terms, block.CategoryId), LinkUrl = Link(block.LinkUrl), Html = Html(block.Html),
            Items = block.Items?.Select(x => x with { ImageId = Map(media, x.ImageId), LinkUrl = Link(x.LinkUrl) }).ToArray()
        }).ToArray() };
        return draft with { CoverId = Map(media, draft.CoverId), CategoryId = Map(terms, draft.CategoryId),
            TagIds = draft.TagIds.Select(id => Map(terms, id)).ToArray(), Html = Html(draft.Html), Layout = layout,
            Seo = draft.Seo == null ? null : draft.Seo with { ImageId = Map(media, draft.Seo.ImageId) } };
    }

    private static string PackageHtml(ContentInput draft) => draft.Layout == null ? draft.Html : PageLayouts.Html(draft.Layout, true);
    private static IEnumerable<string> PackageMedia(ContentInput draft) => Regex.Matches(PackageHtml(draft), "/media/([a-f0-9]{32})")
        .Select(x => x.Groups[1].Value).Append(draft.CoverId).Append(draft.Seo?.ImageId ?? "").Where(x => x != "").Distinct();
    private static IEnumerable<string> PackageTerms(ContentInput draft) => draft.TagIds.Append(draft.CategoryId)
        .Concat(draft.Layout?.Blocks.Select(x => x.CategoryId) ?? []).Where(x => x != "").Distinct();
    private static string ImportSlug(string original, int max) => original[..Math.Min(original.Length, max - 20)].TrimEnd('-') + "-import-" + Guid.NewGuid().ToString("N")[..12];
    private static bool PackageId(string? value, bool empty = false) => value != null && (empty && value == "" || Regex.IsMatch(value, "^[a-f0-9]{32}$"));
    private static string PackageLabel(string kind) => kind == "post" ? "文章" : kind == "product" ? "产品" : kind == "case" ? "案例" : "独立页面";
    private static void CheckPackageKind(string kind)
    { if (kind is not ("post" or "product" or "case" or "page")) throw PackageError("仅支持文章、产品、案例和独立页面的内容包。"); }
    private static CmsException PackageError(string message) => new(400, "INVALID_CONTENT_PACKAGE", message);
    private static async Task<byte[]> ReadPackageBytes(Stream stream, long limit, CancellationToken cancellation)
    {
        using var buffer = new MemoryStream();
        var block = new byte[81920];
        int read;
        while ((read = await stream.ReadAsync(block, cancellation)) > 0)
        {
            if (buffer.Length + read > limit) throw PackageError("内容包或解压后的数据超过大小限制，请分批处理。");
            await buffer.WriteAsync(block.AsMemory(0, read), cancellation);
        }
        return buffer.ToArray();
    }
    private static async Task WritePackageEntry(ZipArchive zip, string name, byte[] bytes, CancellationToken cancellation)
    {
        await using var entry = zip.CreateEntry(name, CompressionLevel.Fastest).Open();
        await entry.WriteAsync(bytes, cancellation);
    }
}
