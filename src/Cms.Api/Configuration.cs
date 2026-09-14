using FreeSql;

namespace Cms.Api;

/// <summary>Startup-only deployment configuration and database construction.</summary>
public static class Configuration
{
    /// <summary>Read an optional Consul JSON document, then reapply environment overrides.</summary>
    public static async Task AddConsulAsync(ConfigurationManager config)
    {
        if (!config.GetValue<bool>("Consul:Enabled")) return;
        var address = config["Consul:Address"] ?? throw new InvalidOperationException("Consul:Address is required.");
        var key = config["Consul:Key"] ?? "cms/config";
        using var client = new HttpClient { Timeout = TimeSpan.FromSeconds(10) };
        using var request = new HttpRequestMessage(HttpMethod.Get, address.TrimEnd('/') + "/v1/kv/" + string.Join('/', key.Split('/').Select(Uri.EscapeDataString)) + "?raw");
        if (config["Consul:Token"] is { Length: > 0 } token) request.Headers.Add("X-Consul-Token", token);
        using var response = await client.SendAsync(request);
        response.EnsureSuccessStatusCode();
        var bytes = await response.Content.ReadAsByteArrayAsync();
        config.AddJsonStream(new MemoryStream(bytes));
        config.AddEnvironmentVariables();
    }

    /// <summary>Construct the selected FreeSql provider without changing any schema.</summary>
    public static IFreeSql Database(IConfiguration config)
    {
        var kind = config["Database:Type"] ?? "PostgreSQL";
        var type = kind.ToLowerInvariant() switch
        {
            "sqlite" => DataType.Sqlite,
            "postgresql" => DataType.PostgreSQL,
            "mysql" => DataType.MySql,
            "sqlserver" => DataType.SqlServer,
            _ => throw new InvalidOperationException("Database:Type must be PostgreSQL, SqlServer, MySql or Sqlite.")
        };
        var connection = config["Database:ConnectionString"];
        if (string.IsNullOrWhiteSpace(connection)) throw new InvalidOperationException("Database:ConnectionString is required.");
        if (type == DataType.Sqlite) SQLitePCL.Batteries_V2.Init();
        return new FreeSqlBuilder().UseConnectionString(type, connection).UseAutoSyncStructure(false).Build();
    }
}
