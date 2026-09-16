using System.Text.Json;

namespace Cms.Data;

public sealed partial class CmsRepository
{
    /// <summary>Export each table through the existing serialized transaction boundary.</summary>
    public async Task ExportAsync(Func<string, byte[], Task> write)
    {
        // ponytail: logical snapshots load one table at a time; use native database backups for large installations.
        async Task Table<T>() where T : Entity => await write(typeof(T).Name + ".json", JsonSerializer.SerializeToUtf8Bytes(await ListAsync<T>()));
        await Table<CmsUser>(); await Table<Content>(); await Table<Taxonomy>(); await Table<Asset>();
        await Table<Comment>(); await Table<MenuItem>(); await Table<SiteSettings>(); await Table<AuditEntry>();
        await Table<AccessToken>(); await Table<IntegrationRequest>(); await Table<ThemeState>(); await Table<SchemaVersion>();
        await Table<VisitorProfile>(); await Table<PageVisit>(); await Table<ContentTraffic>(); await Table<VisitEvent>();
        await Table<CustomerLead>(); await Table<ContentRevision>(); await Table<LeadFollowUp>();
        await Table<ContentAudience>(); await Table<MaintenanceState>();
        await Table<NotificationDelivery>(); await Table<NotificationState>();
        await Table<ContentRedirect>();
        await Table<InquiryFormSettings>();
    }

    /// <summary>Validate a complete snapshot then restore only into an empty initialized database.</summary>
    public async Task ImportAsync(Func<string, Task<byte[]>> read)
    {
        var inserts = new List<Func<Task>>();
        async Task Table<T>(bool seed = false) where T : Entity
        {
            if (!seed && await CountAsync<T>() != 0) throw new InvalidOperationException("恢复目标必须是空数据库。");
            var rows = JsonSerializer.Deserialize<List<T>>(await read(typeof(T).Name + ".json")) ?? throw new InvalidDataException("备份表缺失。");
            if (rows.Select(x => x.Id).Distinct().Count() != rows.Count) throw new InvalidDataException("备份包含重复记录。");
            if (typeof(T) == typeof(SchemaVersion))
            {
                if (rows.Count != 1 || ((SchemaVersion)(object)rows[0]).Version is < 9 or > CurrentSchemaVersion)
                    throw new InvalidDataException("备份数据库版本不受支持。");
                ((SchemaVersion)(object)rows[0]).Version = CurrentSchemaVersion;
            }
            inserts.Add(async () => { if (seed) await db.Delete<T>().Where(x => true).ExecuteAffrowsAsync();
                foreach (var row in rows) await InsertAsync(row); });
        }
        await Table<CmsUser>(); await Table<Content>(); await Table<Taxonomy>(); await Table<Asset>();
        await Table<Comment>(); await Table<MenuItem>(); await Table<SiteSettings>(); await Table<AuditEntry>();
        await Table<AccessToken>(); await Table<IntegrationRequest>(); await Table<ThemeState>(true); await Table<SchemaVersion>(true);
        await Table<VisitorProfile>(); await Table<PageVisit>(); await Table<ContentTraffic>(); await Table<VisitEvent>();
        await Table<CustomerLead>(); await Table<ContentRevision>(); await Table<LeadFollowUp>();
        await Table<ContentAudience>(); await Table<MaintenanceState>();
        await Table<NotificationDelivery>(); await Table<NotificationState>();
        await Table<ContentRedirect>();
        await Table<InquiryFormSettings>();
        foreach (var insert in inserts) await insert();
    }

    /// <summary>Lifetime site views remain independent of expiring page visit details.</summary>
    public async Task<long> LifetimeViewsAsync() => (long)await db.Select<VisitorProfile>().SumAsync(x => x.Views);

    /// <summary>Delete expired detail records while preserving lifetime audience and reading counters.</summary>
    public async Task<long> CleanTrafficAsync(DateTime before)
    {
        await db.Delete<VisitEvent>().Where(x => x.CreatedAt < before).ExecuteAffrowsAsync();
        var removed = await db.Delete<PageVisit>().Where(x => x.CreatedAt < before).ExecuteAffrowsAsync();
        await db.Update<VisitorProfile>().Where(x => x.LastSeenAt < before).Set(x => x.IpAddress, "")
            .Set(x => x.Location, "").ExecuteAffrowsAsync();
        return removed;
    }
}
