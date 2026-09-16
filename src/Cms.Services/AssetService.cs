using System.Buffers.Binary;
using Cms.Data;
using Microsoft.Extensions.Configuration;

namespace Cms.Services;

/// <summary>Local file storage with verified formats and reference protection.</summary>
public sealed class AssetService(CmsRepository repository, IConfiguration config)
{
    private readonly long maxBytes =
        Math.Clamp(config.GetValue<long?>("Storage:MaxBytes") ?? 10_485_760, 1, 52_428_800);

    private readonly string root = Path.GetFullPath(config["Storage:Path"] ?? "data/uploads");

    /// <summary>List uploaded files without disclosing disk paths.</summary>
    public async Task<PageResult<AssetView>> ListAsync(int page, string q = "", string type = "", string group = "")
    {
        if (q.Length > 200 || group.Length > 80 || type is not ("" or "image" or "video" or "audio" or "application")) throw Bad("附件筛选条件无效。");
        var prefix = type == "" ? "" : type + "/";
        var result = await repository.PageAsync<Asset>(x => (q == "" || x.Name.Contains(q)) &&
            (prefix == "" || x.ContentType.StartsWith(prefix)) && (group == "" || x.Group == group), page, 40);
        return new PageResult<AssetView>(result.Items.Select(View).ToList(), result.Total, result.Page,
            result.PageSize);
    }

    /// <summary>Available groups for management and every attachment picker.</summary>
    public Task<List<string>> GroupsAsync() => repository.AssetGroupsAsync();

    /// <summary>Atomically edit only a file's display metadata, preserving bytes and references.</summary>
    public Task<AssetView> UpdateAsync(string actor, string id, AssetMetadataInput input) => repository.WriteAsync(actor, "asset.metadata", async repo =>
    {
        if (string.IsNullOrWhiteSpace(input.Name) || input.Name.Length > 200 || input.Name != Path.GetFileName(input.Name) ||
            input.Name.Any(c => char.IsControl(c) || c is '/' or '\\' or ':') || input.Group == null || input.Group.Trim().Length > 80 || input.Group.Any(char.IsControl))
            throw Bad("请填写有效的文件名和分组，分组不超过 80 字。");
        var row = await repo.FindAsync<Asset>(id) ?? throw Missing();
        if (row.Version != input.Version) throw new CmsException(409, "VERSION_CONFLICT", "附件信息已被修改，请刷新后重试。");
        if (!Path.GetExtension(row.Name).Equals(Path.GetExtension(input.Name.Trim()), StringComparison.OrdinalIgnoreCase))
            throw Bad("重命名时请保留原文件扩展名。");
        row.Name = input.Name.Trim(); row.Group = input.Group.Trim(); row.Version++;
        repo.SetAuditTarget("asset", row.Id, row.Name); await repo.UpdateAsync(row);
        return View(row);
    });

    /// <summary>Verify a bounded upload, persist metadata, and clean up on transaction failure.</summary>
    public async Task<AssetView> UploadAsync(string actor, string filename, Stream input,
        CancellationToken cancellation, string group = "")
    {
        if (group.Length > 80 || group.Any(char.IsControl)) throw Bad("分组名称无效。");
        filename = Path.GetFileName(filename);
        if (filename.Length is 0 or > 200) throw Bad("文件名无效。");
        using var buffer = new MemoryStream();
        var block = new byte[81920];
        int read;
        while ((read = await input.ReadAsync(block, cancellation)) > 0)
        {
            if (buffer.Length + read > maxBytes)
                throw new CmsException(413, "FILE_TOO_LARGE", $"文件不能超过 {maxBytes / 1024 / 1024} MB。");
            await buffer.WriteAsync(block.AsMemory(0, read), cancellation);
        }

        var bytes = buffer.ToArray();
        var row = PrepareUpload(filename, bytes, group);
        Directory.CreateDirectory(root);
        var path = Path.Combine(root, row.StorageName);
        repository.OnRollback(() => File.Delete(path));
        try
        {
            await File.WriteAllBytesAsync(path, bytes, cancellation);
            return await repository.WriteAsync(actor, "asset.upload", async repo =>
            {
                repo.SetAuditTarget("asset", row.Id, row.Name);
                await repo.InsertAsync(row);
                return View(row);
            });
        }
        catch
        {
            File.Delete(path);
            throw;
        }
    }

    internal Asset PrepareUpload(string filename, byte[] bytes, string group)
    {
        if (filename.Length is 0 or > 200 || filename != Path.GetFileName(filename) ||
            filename.Any(c => char.IsControl(c) || c is '/' or '\\' or ':') || group.Length > 80 || group.Any(char.IsControl))
            throw Bad("附件名称或分组无效。");
        if (bytes.LongLength > maxBytes) throw new CmsException(413, "FILE_TOO_LARGE", $"单个附件不能超过 {maxBytes / 1024 / 1024} MB。");
        var extension = Path.GetExtension(filename).ToLowerInvariant();
        var mime = Detect(bytes, extension) ?? throw Bad("文件格式无效。支持 PNG、JPEG、GIF、WebP、PDF、MP4、WebM、MP3 和 WAV。");
        var row = new Asset { Name = filename, Size = bytes.Length, ContentType = mime, Group = group.Trim() };
        row.StorageName = row.Id + extension;
        return row;
    }

    /// <summary>Authorize files using live published references or a valid editor session.</summary>
    public async Task<FileView> ReadAsync(string id, bool authenticated)
    {
        var row = await repository.FindAsync<Asset>(id) ?? throw Missing();
        if (!authenticated && !await Referenced(repository, id, true)) throw Missing();
        var path = Path.Combine(root, row.StorageName);
        if (!File.Exists(path)) throw Missing();
        return new FileView(path, row.ContentType, row.Name);
    }

    /// <summary>Delete unused metadata atomically, then remove the physical file.</summary>
    public async Task<bool> DeleteAsync(string actor, string id)
    {
        var row = await repository.WriteAsync(actor, "asset.delete", async repo =>
        {
            var asset = await repo.FindAsync<Asset>(id) ?? throw Missing();
            if (await Referenced(repo, id, false)) throw new CmsException(409, "ASSET_IN_USE", "附件已被草稿、发布版本或站点图片引用。");
            repo.SetAuditTarget("asset", asset.Id, asset.Name);
            await repo.DeleteAsync<Asset>(id);
            return asset;
        });
        File.Delete(Path.Combine(root, row.StorageName));
        return true;
    }

    private static async Task<bool> Referenced(CmsRepository repo, string id, bool onlyPublic)
    {
        var site = await repo.FindAsync<SiteSettings>("site");
        if (site?.LogoId == id || site?.FaviconId == id) return true;
        var rows = onlyPublic ? await repo.ListAsync<Content>(x => x.Published && x.Kind != "template" && x.Kind != "block") : await repo.ListAsync<Content>();
        if (onlyPublic)
        {
            foreach (var row in rows)
            {
                var snapshot = await ContentService.ResolvePublishedAsync(repo, row);
                if (snapshot.CoverId == id || snapshot.Seo?.ImageId == id || snapshot.Html.Contains(id)) return true;
            }
            return false;
        }
        // ponytail: reference scan is linear in site content; introduce a reference table for large media libraries.
        return rows.Any(x => (!onlyPublic && (x.CoverId == id || x.SeoJson.Contains(id) || x.Html.Contains(id) || x.LayoutJson.Contains(id) || x.ScheduledJson.Contains(id))) || x.PublishedJson.Contains(id)) ||
            (!onlyPublic && await repo.CountAsync<ContentRevision>(x => x.SnapshotJson.Contains(id)) > 0);
    }

    /// <summary>Locate every retained use of an attachment, including deleted content and historical snapshots.</summary>
    public async Task<IReadOnlyList<AssetReference>> ReferencesAsync(string id)
    {
        _ = await repository.FindAsync<Asset>(id) ?? throw Missing();
        var result = new List<AssetReference>();
        var site = await repository.FindAsync<SiteSettings>("site");
        if (site?.LogoId == id || site?.FaviconId == id) result.Add(new("", "site", "站点设置", "站点图片", null));
        foreach (var row in await repository.ListAsync<Content>())
        {
            var state = row.DeletedAt == null ? "草稿" : "回收站";
            if (row.CoverId == id || row.SeoJson.Contains(id) || row.Html.Contains(id) || row.LayoutJson.Contains(id)) result.Add(new(row.Id, row.Kind, row.Title, state, null, row.DeletedAt != null));
            if (row.PublishedJson.Contains(id)) result.Add(new(row.Id, row.Kind, row.Title, "发布快照", null, row.DeletedAt != null));
            if (row.ScheduledJson.Contains(id)) result.Add(new(row.Id, row.Kind, row.Title, "定时发布", null, row.DeletedAt != null));
            var revisions = await repository.ListAsync<ContentRevision>(x => x.ContentId == row.Id && x.SnapshotJson.Contains(id));
            foreach (var version in revisions) result.Add(new(row.Id, row.Kind, version.Title, "历史版本", version.Version, row.DeletedAt != null));
        }
        return result;
    }

    private static string? Detect(byte[] b, string ext)
    {
        if (ext == ".png" && b.AsSpan().StartsWith(new byte[] { 137, 80, 78, 71, 13, 10, 26, 10 })) return "image/png";
        if (ext is ".jpg" or ".jpeg" && b.Length > 3 && b[0] == 255 && b[1] == 216 && b[2] == 255) return "image/jpeg";
        if (ext == ".gif" && (b.AsSpan().StartsWith("GIF89a"u8) || b.AsSpan().StartsWith("GIF87a"u8)))
            return "image/gif";
        if (ext == ".webp" && b.Length > 12 && b.AsSpan(0, 4).SequenceEqual("RIFF"u8) &&
            b.AsSpan(8, 4).SequenceEqual("WEBP"u8)) return "image/webp";
        if (ext == ".pdf" && b.AsSpan().StartsWith("%PDF-"u8)) return "application/pdf";
        if (ext == ".mp4" && Mp4(b)) return "video/mp4";
        if (ext == ".webm" && b.Length > 32 && b.AsSpan().StartsWith(new byte[] { 0x1a, 0x45, 0xdf, 0xa3 }) &&
            b.AsSpan(0, Math.Min(b.Length, 4096)).IndexOf(new byte[] { 0x42, 0x82, 0x84, 0x77, 0x65, 0x62, 0x6d }) >=
            0 && b.AsSpan().IndexOf(new byte[] { 0x18, 0x53, 0x80, 0x67 }) >= 0) return "video/webm";
        if (ext == ".wav" && Wave(b)) return "audio/wav";
        if (ext == ".mp3" && Mp3(b)) return "audio/mpeg";
        return null;
    }

    // Container validation, not codec transcoding. Playback still depends on the browser's supported codec.
    private static bool Mp4(byte[] b)
    {
        var offset = 0;
        var ftyp = false;
        var movie = false;
        var data = false;
        while (offset <= b.Length - 8)
        {
            long size = BinaryPrimitives.ReadUInt32BigEndian(b.AsSpan(offset));
            var header = 8;
            var type = b.AsSpan(offset + 4, 4);
            if (size == 1)
            {
                if (offset > b.Length - 16) return false;
                var large = BinaryPrimitives.ReadUInt64BigEndian(b.AsSpan(offset + 8));
                if (large > int.MaxValue) return false;
                size = (long)large;
                header = 16;
            }

            if (size == 0) size = b.Length - offset;
            if (size < header || size > b.Length - offset) return false;
            if (type.SequenceEqual("ftyp"u8)) ftyp = size >= header + 8;
            if (type.SequenceEqual("moov"u8)) movie = size > header;
            if (type.SequenceEqual("mdat"u8)) data = size > header;
            offset += (int)size;
        }

        return offset == b.Length && ftyp && movie && data;
    }

    private static bool Wave(byte[] b)
    {
        if (b.Length < 44 || !b.AsSpan(0, 4).SequenceEqual("RIFF"u8) || !b.AsSpan(8, 4).SequenceEqual("WAVE"u8) ||
            BinaryPrimitives.ReadUInt32LittleEndian(b.AsSpan(4)) != b.Length - 8) return false;
        var offset = 12;
        var format = false;
        var data = false;
        while (offset <= b.Length - 8)
        {
            var size = BinaryPrimitives.ReadUInt32LittleEndian(b.AsSpan(offset + 4));
            if (size > b.Length - offset - 8) return false;
            if (b.AsSpan(offset, 4).SequenceEqual("fmt "u8))
                format = size >= 16 &&
                         BinaryPrimitives.ReadUInt16LittleEndian(b.AsSpan(offset + 10)) is >= 1 and <= 8 &&
                         BinaryPrimitives.ReadUInt32LittleEndian(b.AsSpan(offset + 12)) > 0;
            if (b.AsSpan(offset, 4).SequenceEqual("data"u8)) data = size > 0;
            offset += 8 + (int)size + (int)(size % 2);
        }

        return format && data;
    }

    private static bool Mp3(byte[] b)
    {
        var offset = 0;
        if (b.AsSpan().StartsWith("ID3"u8))
        {
            if (b.Length < 10 || b.AsSpan(6, 4).ToArray().Any(x => x > 127)) return false;
            offset = 10 + (b[6] << 21) + (b[7] << 14) + (b[8] << 7) + b[9] + ((b[5] & 16) != 0 ? 10 : 0);
        }

        if (offset > b.Length - 4 || b[offset] != 255 || (b[offset + 1] & 0xe0) != 0xe0) return false;
        var version = (b[offset + 1] >> 3) & 3;
        var layer = (b[offset + 1] >> 1) & 3;
        var rate = b[offset + 2] >> 4;
        var sample = (b[offset + 2] >> 2) & 3;
        if (version == 1 || layer != 1 || rate is 0 or 15 || sample == 3) return false;
        var bitrate =
            (version == 3
                ? new[] { 0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320 }
                : new[] { 0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160 })[rate];
        var frequency = new[] { 44100, 48000, 32000 }[sample] / (version == 3 ? 1 : version == 2 ? 2 : 4);
        return b.Length - offset >= (version == 3 ? 144000 : 72000) * bitrate / frequency + ((b[offset + 2] >> 1) & 1);
    }

    private static AssetView View(Asset a)
    {
        return new AssetView(a.Id, a.Name, a.ContentType, a.Size, a.CreatedAt, "/media/" + a.Id, a.Group, a.Version);
    }

    private static CmsException Bad(string message)
    {
        return new CmsException(400, "INVALID_FILE", message);
    }

    private static CmsException Missing()
    {
        return new CmsException(404, "NOT_FOUND", "附件不存在或尚未公开。");
    }
}
