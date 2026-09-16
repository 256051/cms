using System.Net;
using Cms.Data;
using Cms.Services;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging.Abstractions;

internal static class IpLocationChecks
{
    internal static void Run()
    {
        using var locations = new IpLocationService(new ConfigurationBuilder().Build(), NullLogger<IpLocationService>.Instance);
        foreach (var (ip, label) in new[] { ("127.0.0.1", "本机地址"), ("::1", "本机地址"),
            ("10.2.3.4", "内网地址"), ("172.16.1.2", "内网地址"), ("192.168.1.1", "内网地址"),
            ("100.64.1.2", "内网地址"), ("fe80::1%4", "内网地址"), ("fd12::1", "内网地址"),
            ("0.0.0.0", "保留地址"), ("::", "保留地址"), ("192.0.2.1", "保留地址"), ("2001:db8::1", "保留地址") })
            if (locations.Resolve(IPAddress.Parse(ip)).Location != label) throw new Exception("Special address: " + ip);
        var china = locations.Resolve(IPAddress.Parse("114.114.114.114"));
        var ipv6 = locations.Resolve(IPAddress.Parse("2001:4860:4860::8888"));
        if (!china.Location.Contains("中国") || ipv6.Location is "未知地区" or "" ||
            locations.Resolve(IPAddress.Parse("::ffff:114.114.114.114")) != china ||
            locations.Resolve(null) != ("", "未知地区")) throw new Exception("Offline lookup or normalization failed.");
        var samples = new[] { "114.114.114.114", "8.8.8.8", "2001:4860:4860::8888" };
        var expected = samples.Select(x => locations.Resolve(IPAddress.Parse(x))).ToArray();
        Parallel.For(0, 300, index =>
        {
            if (locations.Resolve(IPAddress.Parse(samples[index % 3])) != expected[index % 3])
                throw new Exception("Concurrent lookup changed its result.");
        });
        var absent = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
            { ["GeoIp:Directory"] = Path.Combine(AppContext.BaseDirectory, "missing-" + Guid.NewGuid().ToString("N")) }).Build();
        using var missing = new IpLocationService(absent, NullLogger<IpLocationService>.Instance);
        if (missing.Resolve(IPAddress.Parse("8.8.8.8")) != ("8.8.8.8", "未知地区") ||
            missing.Resolve(IPAddress.Parse("2001:4860:4860::8888")).Location != "未知地区")
            throw new Exception("Missing database must preserve the IP.");
        Console.WriteLine("PASS: offline IPv4/IPv6 regions, mapped addresses, private/reserved/missing IP, concurrent reads and absent-data fallback");
    }

    internal static async Task CreateV7Async(CmsRepository repo, IFreeSql db)
    {
        db.CodeFirst.ConfigEntity<VisitorProfile>(table =>
        {
            table.Property(x => x.IpAddress).IsIgnore(true);
            table.Property(x => x.Location).IsIgnore(true);
        });
        db.CodeFirst.ConfigEntity<PageVisit>(table =>
        {
            table.Property(x => x.IpAddress).IsIgnore(true);
            table.Property(x => x.Location).IsIgnore(true);
        });
        await repo.InitializeSchemaAsync();
        await db.Update<SchemaVersion>().Where(x => x.Id == "schema").Set(x => x.Version, 7).ExecuteAffrowsAsync();
        var date = new DateTime(2020, 1, 1, 0, 0, 0, DateTimeKind.Utc);
        await repo.InsertAsync(new VisitorProfile { Id = new string('1', 32), Source = "legacy-region", Views = 1, CreatedAt = date, LastSeenAt = date, Device = "电脑" });
        await repo.InsertAsync(new PageVisit { Id = new string('2', 32), VisitorId = new string('1', 32), Path = "/", Title = "升级前访问", Source = "legacy-region", CreatedAt = date, Day = "2020-01-01", ActiveSeconds = 7, Depth = 40 });
        await repo.InsertAsync(new CustomerLead { Id = new string('3', 32), Name = "原客户", Contact = "legacy@example.test", Need = "保留需求", CreatedAt = date });
        foreach (var name in new[] { "cms_visitors", "cms_page_visits" })
            if (db.DbFirst.GetTableByName(name).Columns.Any(x => x.Name.Equals("IpAddress", StringComparison.OrdinalIgnoreCase)))
                throw new Exception("The migration fixture already has the new column.");
    }

    internal static async Task VerifyV7Async(CmsRepository repo)
    {
        var visitor = await repo.FindAsync<VisitorProfile>(new string('1', 32)) ?? throw new Exception("Lost visitor");
        var visit = await repo.FindAsync<PageVisit>(new string('2', 32)) ?? throw new Exception("Lost visit");
        var lead = await repo.FindAsync<CustomerLead>(new string('3', 32)) ?? throw new Exception("Lost lead");
        if (!await repo.ReadyAsync() || visitor.Views != 1 || visitor.Source != "legacy-region" ||
            visit.ActiveSeconds != 7 || visit.Depth != 40 || visit.Title != "升级前访问" || lead.Contact != "legacy@example.test" ||
            !string.IsNullOrEmpty(visitor.IpAddress) || !string.IsNullOrEmpty(visitor.Location) ||
            !string.IsNullOrEmpty(visit.IpAddress) || !string.IsNullOrEmpty(visit.Location))
            throw new Exception("v7 migration changed history or fabricated a location.");
        Console.WriteLine("PASS: v7 to v8 keeps visitor, visit and inquiry data without inventing historical IPs");
    }
}
