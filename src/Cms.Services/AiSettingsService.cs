using System.Security.Cryptography;
using System.Text.Json;
using Cms.Data;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.Extensions.Configuration;

namespace Cms.Services;

/// <summary>OpenAI-compatible Chat Completions configuration; blank keys preserve the same endpoint's key.</summary>
public record AiOptions(bool Enabled = false, string ApiUrl = "", string ApiKey = "", string Model = "", int Version = 0);
/// <summary>Administrator configuration with the credential removed.</summary>
public record AiConfigurationView(AiOptions Values, bool HasSecret, bool DeploymentManaged, string[] Errors);
/// <summary>Editor-visible readiness without exposing provider credentials or addresses.</summary>
public record AiStatus(bool Enabled, bool Ready);

/// <summary>Audited encrypted database configuration with explicit Consul/environment overrides.</summary>
public sealed class AiSettingsService(CmsRepository repository, IConfiguration config, IDataProtectionProvider protection)
{
    private readonly IDataProtector protector = protection.CreateProtector("Cms.AI.Settings.v1");
    private static readonly string[] Keys = ["Enabled", "ApiUrl", "ApiKey", "Model"];
    private bool Managed => Keys.Any(key => config["AI:" + key] != null);

    private AiOptions Read(AiSettings? row)
    {
        if (row == null) return new();
        try { return JsonSerializer.Deserialize<AiOptions>(protector.Unprotect(row.ProtectedJson)) ?? throw new JsonException(); }
        catch (Exception error) when (error is CryptographicException or JsonException)
        { throw Bad("AI 配置无法解密，请检查数据库与站点密钥目录是否配套恢复。"); }
    }

    /// <summary>Load effective credentials exclusively for server-side requests.</summary>
    public async Task<AiOptions> LoadAsync()
    {
        var row = await repository.FindAsync<AiSettings>("site");
        var saved = Read(row);
        var url = NormalizeUrl(config["AI:ApiUrl"] ?? saved.ApiUrl);
        var enabled = saved.Enabled;
        if (config["AI:Enabled"] is { } flag && !bool.TryParse(flag, out enabled))
            throw Bad("AI:Enabled 必须为 true 或 false。");
        return saved with { Enabled = enabled, ApiUrl = url, Model = config["AI:Model"] ?? saved.Model,
            ApiKey = config["AI:ApiKey"] ?? (url == saved.ApiUrl ? saved.ApiKey : ""), Version = row?.Version ?? 0 };
    }

    /// <summary>Report readiness to editors without disclosing configuration.</summary>
    public async Task<AiStatus> StatusAsync()
    {
        var options = await LoadAsync();
        return new(options.Enabled, options.Enabled && Errors(options).Length == 0);
    }

    /// <summary>Read a redacted administrator form.</summary>
    public async Task<AiConfigurationView> ViewAsync()
    {
        var options = await LoadAsync();
        return new(options with { ApiKey = "" }, options.ApiKey.Length > 0, Managed, options.Enabled ? Errors(options) : []);
    }

    /// <summary>Validate, encrypt and persist settings with a version check; takes effect immediately.</summary>
    public async Task<AiConfigurationView> SaveAsync(string actor, AiOptions input)
    {
        if (Managed) throw Bad("AI 设置由服务器配置覆盖，请先移除 AI 配置覆盖再使用后台保存。", 409);
        if (input.ApiUrl == null || input.ApiKey == null || input.Model == null || input.ApiUrl.Length > 500 ||
            input.ApiKey.Length > 4096 || input.Model.Length > 200 || input.Version < 0)
            throw Bad("AI 设置格式无效或字段过长。");
        input = input with { ApiUrl = NormalizeUrl(input.ApiUrl), ApiKey = input.ApiKey.Trim(), Model = input.Model.Trim() };
        if (input.ApiUrl != "") Endpoint(input.ApiUrl);
        if (input.ApiKey.Any(char.IsWhiteSpace) || input.ApiKey.Any(char.IsControl) || input.Model.Any(char.IsControl))
            throw Bad("API Key 和模型名称包含无效字符。");
        await repository.WriteAsync(actor, "ai.settings", async repo =>
        {
            var row = await repo.FindAsync<AiSettings>("site");
            if ((row?.Version ?? 0) != input.Version) throw Bad("AI 设置已被修改，请刷新后重试。", 409);
            var old = Read(row);
            var next = input with { ApiKey = input.ApiKey == "" && input.ApiUrl == old.ApiUrl ? old.ApiKey : input.ApiKey,
                Version = input.Version + 1 };
            if (next.Enabled && Errors(next) is { Length: > 0 } errors) throw Bad(string.Join("；", errors));
            var fresh = row == null; row ??= new() { Id = "site" };
            row.ProtectedJson = protector.Protect(JsonSerializer.Serialize(next)); row.Version = next.Version;
            repo.SetAuditTarget("ai", "site", "AI 写作设置");
            if (fresh) await repo.InsertAsync(row); else await repo.UpdateAsync(row);
            return true;
        });
        return await ViewAsync();
    }

    private static string NormalizeUrl(string value) => value.Trim().TrimEnd('/');

    /// <summary>Accept an HTTPS API base URL or a complete Chat Completions URL.</summary>
    public static Uri Endpoint(string value)
    {
        if (value.Length > 500 || value.Any(char.IsWhiteSpace) || value.Any(char.IsControl) || value.Contains('\\') ||
            !Uri.TryCreate(value, UriKind.Absolute, out var uri) || uri.Scheme != "https" || uri.UserInfo != "" ||
            uri.Query != "" || uri.Fragment != "" || uri.IsLoopback)
            throw Bad("请填写 HTTPS API 地址，不包含账号、查询参数或片段，例如 https://api.example.com/v1。");
        var url = uri.AbsoluteUri.TrimEnd('/');
        return new(url.EndsWith("/chat/completions", StringComparison.Ordinal) ? url : url + "/chat/completions");
    }

    /// <summary>Validate all effective fields before any network request.</summary>
    public static string[] Errors(AiOptions options)
    {
        var errors = new List<string>();
        try { Endpoint(options.ApiUrl); } catch (CmsException e) { errors.Add(e.Message); }
        if (string.IsNullOrWhiteSpace(options.ApiKey) || options.ApiKey.Length > 4096 || options.ApiKey.Any(c => char.IsWhiteSpace(c) || char.IsControl(c)))
            errors.Add("请填写有效的 API Key。");
        if (string.IsNullOrWhiteSpace(options.Model) || options.Model.Length > 200 || options.Model.Any(char.IsControl))
            errors.Add("请填写服务商支持的模型名称。");
        return errors.ToArray();
    }

    internal static CmsException Bad(string message, int status = 400) => new(status, "AI_ERROR", message);
}
