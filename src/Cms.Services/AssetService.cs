using Cms.Data;
using Microsoft.Extensions.Configuration;

namespace Cms.Services;

/// <summary>Local file storage with verified formats and reference protection.</summary>
public sealed class AssetService(CmsRepository repository, IConfiguration config)
{
    private readonly string root = Path.GetFullPath(config["Storage:Path"] ?? "data/uploads");
    private readonly long maxBytes = Math.Clamp(config.GetValue<long?>("Storage:MaxBytes") ?? 10_485_760, 1, 52_428_800);
    /// <summary>List uploaded files without disclosing disk paths.</summary>
    public async Task<PageResult<AssetView>> ListAsync(int page)
    {
        var result = await repository.PageAsync<Asset>(x => true, page, 40);
        return new(result.Items.Select(View).ToList(), result.Total, result.Page, result.PageSize);
    }
    /// <summary>Verify a bounded upload, persist metadata, and clean up on transaction failure.</summary>
    public async Task<AssetView> UploadAsync(string actor, string filename, Stream input, CancellationToken cancellation)
    {
        filename = Path.GetFileName(filename);
        if (filename.Length is 0 or > 200) throw Bad("文件名无效。");
        using var buffer = new MemoryStream();
        var block = new byte[81920]; int read;
        while ((read = await input.ReadAsync(block, cancellation)) > 0)
        {
            if (buffer.Length + read > maxBytes) throw new CmsException(413, "FILE_TOO_LARGE", $"文件不能超过 {maxBytes / 1024 / 1024} MB。");
            await buffer.WriteAsync(block.AsMemory(0, read), cancellation);
        }
        var bytes = buffer.ToArray();
        var extension = Path.GetExtension(filename).ToLowerInvariant();
        var mime = Detect(bytes, extension) ?? throw Bad("只允许有效的 PNG、JPEG、GIF、WebP 图片或 PDF 文件。");
        var row = new Asset { Name = filename, Size = bytes.Length, ContentType = mime };
        row.StorageName = row.Id + extension;
        Directory.CreateDirectory(root);
        var path = Path.Combine(root, row.StorageName);
        await File.WriteAllBytesAsync(path, bytes, cancellation);
        try { return await repository.WriteAsync(actor, "asset.upload", async repo => { repo.SetAuditTarget("asset", row.Id, row.Name); await repo.InsertAsync(row); return View(row); }); }
        catch { File.Delete(path); throw; }
    }

    /// <summary>Authorize files using live published references or a valid editor session.</summary>
    public async Task<FileView> ReadAsync(string id, bool authenticated)
    {
        var row = await repository.FindAsync<Asset>(id) ?? throw Missing();
        if (!authenticated && !await Referenced(repository, id, true)) throw Missing();
        var path = Path.Combine(root, row.StorageName);
        if (!File.Exists(path)) throw Missing();
        return new(path, row.ContentType, row.Name);
    }

    /// <summary>Delete unused metadata atomically, then remove the physical file.</summary>
    public async Task<bool> DeleteAsync(string actor, string id)
    {
        var row = await repository.WriteAsync(actor, "asset.delete", async repo =>
        {
            var asset = await repo.FindAsync<Asset>(id) ?? throw Missing();
            if (await Referenced(repo, id, false)) throw new CmsException(409, "ASSET_IN_USE", "附件已被草稿、发布版本或站点图片引用。");
            repo.SetAuditTarget("asset", asset.Id, asset.Name);
            await repo.DeleteAsync<Asset>(id); return asset;
        });
        File.Delete(Path.Combine(root, row.StorageName)); return true;
    }

    private static async Task<bool> Referenced(CmsRepository repo, string id, bool onlyPublic)
    {
        var site = await repo.FindAsync<SiteSettings>("site");
        if (site?.LogoId == id || site?.FaviconId == id) return true;
        var rows = onlyPublic ? await repo.ListAsync<Content>(x => x.Published) : await repo.ListAsync<Content>();
        // ponytail: reference scan is linear in site content; introduce a reference table for large media libraries.
        return rows.Any(x => (!onlyPublic && (x.CoverId == id || x.Html.Contains(id))) || x.PublishedJson.Contains(id));
    }
    private static string? Detect(byte[] b, string ext)
    {
        if (ext == ".png" && b.AsSpan().StartsWith(new byte[] { 137, 80, 78, 71, 13, 10, 26, 10 })) return "image/png";
        if (ext is ".jpg" or ".jpeg" && b.Length > 3 && b[0] == 255 && b[1] == 216 && b[2] == 255) return "image/jpeg";
        if (ext == ".gif" && (b.AsSpan().StartsWith("GIF89a"u8) || b.AsSpan().StartsWith("GIF87a"u8))) return "image/gif";
        if (ext == ".webp" && b.Length > 12 && b.AsSpan(0, 4).SequenceEqual("RIFF"u8) && b.AsSpan(8, 4).SequenceEqual("WEBP"u8)) return "image/webp";
        if (ext == ".pdf" && b.AsSpan().StartsWith("%PDF-"u8)) return "application/pdf";
        return null;
    }
    private static AssetView View(Asset a) => new(a.Id, a.Name, a.ContentType, a.Size, a.CreatedAt, "/media/" + a.Id);
    private static CmsException Bad(string message) => new(400, "INVALID_FILE", message);
    private static CmsException Missing() => new(404, "NOT_FOUND", "附件不存在或尚未公开。");
}
