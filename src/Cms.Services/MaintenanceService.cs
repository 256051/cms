using System.IO.Compression;
using System.Security.Cryptography;
using System.Text.Json;
using Cms.Data;
using Microsoft.Extensions.Configuration;

namespace Cms.Services;

/// <summary>Backup status plus deployment-managed schedules.</summary>
public record MaintenanceView(MaintenanceState State, int BackupIntervalHours, int TrafficRetentionDays);
/// <summary>Portable schema-specific archive integrity manifest.</summary>
public record BackupManifest(int Schema, string ApplicationVersion, DateTime CreatedAt, Dictionary<string, string> Sha256);

/// <summary>Portable logical backups, isolated restore and explicit traffic retention.</summary>
public sealed class MaintenanceService(CmsRepository repository, IConfiguration config)
{
    private readonly string backups = Path.GetFullPath(config["Maintenance:BackupPath"] ?? "data/backups");
    private readonly string uploads = Path.GetFullPath(config["Storage:Path"] ?? "data/uploads");
    private readonly string keys = Path.GetFullPath(config["Security:KeyPath"] ?? "data/keys");
    private int BackupHours => Math.Clamp(config.GetValue<int>("Maintenance:BackupIntervalHours"), 0, 8760);
    private int RetentionDays => config.GetValue<int>("Maintenance:TrafficRetentionDays") is var days && days > 0 ? Math.Clamp(days, 90, 3650) : 0;

    /// <summary>Read backup success, failure and the configured maintenance policy.</summary>
    public async Task<MaintenanceView> StatusAsync() => new(await repository.FindAsync<MaintenanceState>("site") ?? new() { Id = "site" }, BackupHours, RetentionDays);

    /// <summary>Create an integrity-checked archive of database tables, retained attachments and authentication keys.</summary>
    public async Task<MaintenanceView> BackupAsync(string actor)
    {
        var filename = $"cms-{DateTime.UtcNow:yyyyMMdd-HHmmss}-{Guid.NewGuid():N}.zip";
        var path = Path.Combine(backups, filename);
        var temporary = path + ".partial";
        try
        {
            Directory.CreateDirectory(backups);
            await repository.WriteAsync(actor, "maintenance.backup", async repo =>
            {
                repo.SetAuditTarget("maintenance", "site", "站点备份");
                var hashes = new Dictionary<string, string>();
                using (var zip = ZipFile.Open(temporary, ZipArchiveMode.Create))
                {
                    async Task Write(string name, byte[] bytes)
                    {
                        hashes.Add(name, Convert.ToHexString(SHA256.HashData(bytes)));
                        await using var output = zip.CreateEntry(name, CompressionLevel.Fastest).Open();
                        await output.WriteAsync(bytes);
                    }
                    await repo.ExportAsync((name, bytes) => Write("database/" + name, bytes));
                    foreach (var asset in await repo.ListAsync<Asset>())
                        await Write("uploads/" + SafeName(asset.StorageName), await File.ReadAllBytesAsync(Path.Combine(uploads, SafeName(asset.StorageName))));
                    foreach (var file in Directory.GetFiles(keys, "*.xml")) await Write("keys/" + Path.GetFileName(file), await File.ReadAllBytesAsync(file));
                    var manifest = new BackupManifest(CmsRepository.CurrentSchemaVersion, typeof(MaintenanceService).Assembly.GetName().Version!.ToString(), DateTime.UtcNow, hashes);
                    await using var entry = zip.CreateEntry("manifest.json").Open();
                    await JsonSerializer.SerializeAsync(entry, manifest);
                }
                File.Move(temporary, path);
                repo.OnRollback(() => File.Delete(path));
                var state = await repo.FindAsync<MaintenanceState>("site");
                var fresh = state == null;
                state ??= new() { Id = "site" };
                state.LastAttemptAt = state.LastSuccessAt = DateTime.UtcNow;
                state.Error = ""; state.FileName = filename;
                if (fresh) await repo.InsertAsync(state); else await repo.UpdateAsync(state);
                return true;
            });
        }
        catch
        {
            if (File.Exists(temporary)) File.Delete(temporary);
            await repository.WriteAsync(actor, "maintenance.backup-failed", async repo =>
            {
                repo.SetAuditTarget("maintenance", "site", "站点备份失败");
                var state = await repo.FindAsync<MaintenanceState>("site"); var fresh = state == null;
                state ??= new() { Id = "site" }; state.LastAttemptAt = DateTime.UtcNow;
                state.Error = "备份未完成，请检查存储空间、附件和密钥目录权限及服务日志。";
                if (fresh) await repo.InsertAsync(state); else await repo.UpdateAsync(state);
                return false;
            });
            throw;
        }
        return await StatusAsync();
    }

    /// <summary>Download only the last successful archive from the private backup directory.</summary>
    public async Task<FileView> DownloadAsync()
    {
        var state = await repository.FindAsync<MaintenanceState>("site");
        if (string.IsNullOrEmpty(state?.FileName)) throw new CmsException(404, "NOT_FOUND", "尚无成功备份。");
        var path = Path.Combine(backups, SafeName(state.FileName));
        if (!File.Exists(path)) throw new CmsException(404, "NOT_FOUND", "备份文件不存在。");
        return new(path, "application/zip", state.FileName);
    }

    /// <summary>Run configured backups and detail cleanup; defaults leave both disabled.</summary>
    public async Task RunAsync()
    {
        var view = await StatusAsync();
        if (BackupHours > 0 && (view.State.LastAttemptAt == null || view.State.LastAttemptAt <= DateTime.UtcNow.AddHours(-BackupHours)))
            await BackupAsync("scheduler");
        if (RetentionDays > 0)
        {
            var cutoff = TrafficService.TodayUtc().AddDays(-RetentionDays);
            if (view.State.TrafficSince >= cutoff) return;
            await repository.WriteAsync("scheduler", "maintenance.traffic-cleanup", async repo =>
            {
                repo.SetAuditTarget("maintenance", "site", "访问明细保留期限");
                await repo.CleanTrafficAsync(cutoff);
                var state = await repo.FindAsync<MaintenanceState>("site"); var fresh = state == null;
                state ??= new() { Id = "site" }; state.TrafficSince = cutoff;
                if (fresh) await repo.InsertAsync(state); else await repo.UpdateAsync(state);
                return true;
            });
        }
    }

    /// <summary>Restore a validated archive into an empty database and empty upload/key directories only.</summary>
    public async Task RestoreAsync(string path)
    {
        if ((Directory.Exists(uploads) && Directory.EnumerateFileSystemEntries(uploads).Any()) ||
            (Directory.Exists(keys) && Directory.EnumerateFileSystemEntries(keys).Any()))
            throw new InvalidOperationException("恢复需要全新的附件目录和密钥目录。");
        using var zip = ZipFile.OpenRead(path);
        var manifestEntry = zip.GetEntry("manifest.json") ?? throw new InvalidDataException("缺少备份清单。");
        await using var manifestStream = manifestEntry.Open();
        var manifest = await JsonSerializer.DeserializeAsync<BackupManifest>(manifestStream) ?? throw new InvalidDataException("备份清单无效。");
        if (manifest.Schema is < 9 or > CmsRepository.CurrentSchemaVersion || zip.Entries.Select(x => x.FullName).Distinct().Count() != zip.Entries.Count || zip.Entries.Count != manifest.Sha256.Count + 1)
            throw new InvalidDataException("备份版本或条目无效。");
        var verified = new Dictionary<string, byte[]>();
        foreach (var (name, hash) in manifest.Sha256)
        {
            var parts = name.Split('/');
            if (parts.Length != 2 || parts[0] is not ("database" or "uploads" or "keys")) throw new InvalidDataException("备份路径无效。");
            SafeName(parts[1]);
            var entry = zip.GetEntry(name) ?? throw new InvalidDataException("备份文件缺失。");
            await using var input = entry.Open(); using var bytes = new MemoryStream(); await input.CopyToAsync(bytes);
            var data = bytes.ToArray();
            if (Convert.ToHexString(SHA256.HashData(data)) != hash) throw new InvalidDataException("备份校验失败。");
            verified.Add(name, data);
        }
        var assets = JsonSerializer.Deserialize<List<Asset>>(verified["database/Asset.json"])!;
        if (manifest.Schema < 11)
            foreach (var table in new[] { "NotificationDelivery", "NotificationState" })
                verified.TryAdd("database/" + table + ".json", "[]"u8.ToArray());
        if (manifest.Schema < 12) verified.TryAdd("database/ContentRedirect.json", "[]"u8.ToArray());
        if (manifest.Schema < 14) verified.TryAdd("database/InquiryFormSettings.json", "[]"u8.ToArray());
        foreach (var asset in assets)
            if (!verified.TryGetValue("uploads/" + SafeName(asset.StorageName), out var bytes) || bytes.LongLength != asset.Size)
                throw new InvalidDataException("附件内容不完整。");
        var created = new List<string>();
        try
        {
            await repository.RecordTrafficAsync(async repo =>
            {
                await repo.ImportAsync(name => Task.FromResult(verified["database/" + name]));
                Directory.CreateDirectory(uploads); Directory.CreateDirectory(keys);
                foreach (var (name, bytes) in verified.Where(x => x.Key.StartsWith("uploads/") || x.Key.StartsWith("keys/")))
                {
                    var target = Path.Combine(name.StartsWith("uploads/") ? uploads : keys, name.Split('/')[1]);
                    await using var output = new FileStream(target, FileMode.CreateNew, FileAccess.Write, FileShare.None);
                    created.Add(target); await output.WriteAsync(bytes);
                }
                return true;
            });
        }
        catch { foreach (var file in created) File.Delete(file); throw; }
    }

    private static string SafeName(string name) => name.Length > 0 && name != "." && name != ".." &&
        name == Path.GetFileName(name) && !name.Contains('\\') && !name.Contains('/') && !name.Contains(':')
        ? name : throw new InvalidDataException("备份文件名无效。");
}
