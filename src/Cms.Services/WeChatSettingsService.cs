using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using Cms.Data;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.Extensions.Configuration;

namespace Cms.Services;

/// <summary>Official account settings; blank secrets on save preserve the same account's saved secret.</summary>
public record WeChatOptions(bool Enabled = false, bool AutoSync = false, string AppId = "", string AppSecret = "",
    string Author = "", string SiteUrl = "", int Version = 0, bool AutoPublish = false);
/// <summary>Administrator view with the secret removed and its presence reported separately.</summary>
public record WeChatConfigurationView(WeChatOptions Values, bool HasSecret, bool DeploymentManaged, string[] Errors);

/// <summary>Encrypted database settings with optional explicit deployment overrides.</summary>
public sealed class WeChatSettingsService(CmsRepository repository, IConfiguration config, IDataProtectionProvider protection)
{
    private readonly IDataProtector protector = protection.CreateProtector("Cms.WeChat.Settings.v1");
    private static readonly string[] Keys = ["Enabled", "AutoSync", "AutoPublish", "AppId", "AppSecret", "Author", "SiteUrl"];
    private bool Managed => Keys.Any(key => config["WeChat:" + key] != null);

    /// <summary>Load effective server-only settings, optionally inside the current publication transaction.</summary>
    public async Task<WeChatOptions> LoadAsync(CmsRepository? scoped = null)
    {
        var row = await (scoped ?? repository).FindAsync<WeChatAccountSettings>("site");
        var saved = Read(row);
        var app = config["WeChat:AppId"] ?? saved.AppId;
        return saved with
        {
            Enabled = Flag("Enabled", saved.Enabled), AutoSync = Flag("AutoSync", saved.AutoSync),
            AutoPublish = Flag("AutoPublish", saved.AutoPublish),
            AppId = app, AppSecret = config["WeChat:AppSecret"] ?? (app == saved.AppId ? saved.AppSecret : ""),
            Author = config["WeChat:Author"] ?? saved.Author, SiteUrl = config["WeChat:SiteUrl"] ?? saved.SiteUrl,
            Version = row?.Version ?? 0
        };
    }

    private bool Flag(string key, bool saved) => config["WeChat:" + key] is { } text
        ? bool.TryParse(text, out var value) ? value : throw Bad("公众号部署配置中的开关必须为 true 或 false。") : saved;

    private WeChatOptions Read(WeChatAccountSettings? row)
    {
        if (row == null) return new();
        try { return JsonSerializer.Deserialize<WeChatOptions>(protector.Unprotect(row.ProtectedJson)) ?? throw new JsonException(); }
        catch (Exception error) when (error is CryptographicException or JsonException)
        { throw Bad("公众号配置无法解密，请检查数据库与站点密钥目录是否配套恢复。"); }
    }

    /// <summary>Read configuration readiness without returning credentials.</summary>
    public async Task<WeChatSettings> StatusAsync()
    {
        var options = await LoadAsync();
        return new(options.Enabled, options.AutoSync, options.AppId, options.Enabled ? Errors(options) : [], options.AutoPublish);
    }

    /// <summary>Read an administrator-safe form; configured is not a successful connection test.</summary>
    public async Task<WeChatConfigurationView> ViewAsync()
    {
        var options = await LoadAsync();
        return new(options with { AppSecret = "" }, !string.IsNullOrWhiteSpace(options.AppSecret), Managed,
            options.Enabled ? Errors(options) : []);
    }

    /// <summary>Validate and encrypt settings in an audited transaction with optimistic concurrency.</summary>
    public async Task<WeChatConfigurationView> SaveAsync(string actor, WeChatOptions input)
    {
        if (Managed) throw Bad("公众号配置由部署配置覆盖，请先移除 WeChat 配置覆盖，再使用后台保存。", 409);
        if (input.AppId == null || input.AppSecret == null || input.Author == null || input.SiteUrl == null ||
            input.AppId.Length > 32 || input.AppSecret.Length > 256 || input.Author.EnumerateRunes().Count() > 16 || input.SiteUrl.Length > 500)
            throw Bad("公众号设置格式无效，请检查字段长度。");
        input = input with { AppId = input.AppId.Trim(), AppSecret = input.AppSecret.Trim(), Author = input.Author.Trim(), SiteUrl = input.SiteUrl.Trim().TrimEnd('/') };
        if (input.AppId != "" && !Regex.IsMatch(input.AppId, "^wx[a-zA-Z0-9]{16}$")) throw Bad("请填写有效的公众号 AppID。");
        await repository.WriteAsync(actor, "wechat.settings", async repo =>
        {
            var row = await repo.FindAsync<WeChatAccountSettings>("site");
            if ((row?.Version ?? 0) != input.Version) throw Bad("公众号设置已被修改，请刷新后重试。", 409);
            var old = Read(row);
            var next = input with { AppSecret = input.AppSecret == "" && input.AppId == old.AppId ? old.AppSecret : input.AppSecret,
                Version = input.Version + 1 };
            if (next.Enabled && Errors(next) is { Length: > 0 } errors) throw Bad(string.Join("；", errors));
            var fresh = row == null; row ??= new() { Id = "site" };
            row.Version = next.Version; row.ProtectedJson = protector.Protect(JsonSerializer.Serialize(next));
            repo.SetAuditTarget("wechat", "site", "微信公众号接入设置");
            if (fresh) await repo.InsertAsync(row); else await repo.UpdateAsync(row);
            return true;
        });
        return await ViewAsync();
    }

    /// <summary>Validate account readiness before allowing synchronization.</summary>
    public static string[] Errors(WeChatOptions options)
    {
        var errors = new List<string>();
        if (!Regex.IsMatch(options.AppId, "^wx[a-zA-Z0-9]{16}$")) errors.Add("请配置有效的公众号 AppID。");
        if (string.IsNullOrWhiteSpace(options.AppSecret)) errors.Add("请配置公众号 AppSecret。");
        if (!Uri.TryCreate(options.SiteUrl, UriKind.Absolute, out var site) || site.Scheme != "https" ||
            site.UserInfo != "" || site.Query != "" || site.Fragment != "" || site.AbsolutePath != "/")
            errors.Add("请填写网站的 HTTPS 根地址，例如 https://example.com，不要粘贴 Markdown 链接。");
        if (options.Author.EnumerateRunes().Count() > 16) errors.Add("公众号作者不能超过 16 字。");
        return errors.ToArray();
    }

    private static CmsException Bad(string message, int status = 400) => new(status, "WECHAT_INVALID", message);
}
