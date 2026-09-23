using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Cms.Data;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.Extensions.Configuration;

namespace Cms.Services;

/// <summary>Credentials for one supported payment account; empty secrets on save preserve existing values.</summary>
public record PaymentChannel
{
    /// <summary>Allow new payments.</summary>
    public bool Enabled { get; init; }
    /// <summary>Stripe test keys or Alipay sandbox; WeChat Native uses live credentials only.</summary>
    public bool TestMode { get; init; }
    /// <summary>Application identity.</summary>
    public string AppId { get; init; } = "";
    /// <summary>WeChat merchant ID, Alipay seller ID or Stripe account ID.</summary>
    public string MerchantId { get; init; } = "";
    /// <summary>Merchant RSA PEM private key.</summary>
    public string PrivateKey { get; init; } = "";
    /// <summary>Payment platform RSA PEM public key.</summary>
    public string PublicKey { get; init; } = "";
    /// <summary>WeChat merchant certificate serial number.</summary>
    public string SerialNo { get; init; } = "";
    /// <summary>WeChat payment public key identifier.</summary>
    public string PublicKeyId { get; init; } = "";
    /// <summary>WeChat 32-byte notification decryption secret.</summary>
    public string ApiV3Key { get; init; } = "";
    /// <summary>Stripe server API key.</summary>
    public string SecretKey { get; init; } = "";
    /// <summary>Stripe endpoint signing secret.</summary>
    public string WebhookSecret { get; init; } = "";
}

/// <summary>Versioned merchant configuration, protected at rest.</summary>
public record CommerceOptions(string SiteUrl = "", Dictionary<string, PaymentChannel>? Channels = null, int Version = 0);
/// <summary>Redacted configuration and separate presence flags; configured does not mean live-tested.</summary>
public record ChannelSettings(string Id, PaymentChannel Values, string[] SavedSecrets, bool Configured, bool DeploymentManaged, string Error, string NotifyUrl);
/// <summary>Administrator-safe configuration.</summary>
public record CommerceSettingsView(string SiteUrl, int Version, bool SiteUrlManaged, ChannelSettings[] Channels);

/// <summary>Encrypted administrator settings with Consul/environment overrides.</summary>
public sealed class CommerceSettings(CmsRepository repository, IConfiguration config, IDataProtectionProvider protection)
{
    internal static readonly string[] Channels = ["alipay", "wechat", "stripe"];
    private static readonly string[] Secrets = ["PrivateKey", "ApiV3Key", "SecretKey", "WebhookSecret"];
    private readonly IDataProtector protector = protection.CreateProtector("Cms.Commerce.Settings.v1");

    /// <summary>Load server-only credentials; deployment configuration always wins.</summary>
    public async Task<CommerceOptions> LoadAsync()
    {
        var row = await repository.FindAsync<ShopSettings>("site");
        var saved = row == null ? new CommerceOptions() : JsonSerializer.Deserialize<CommerceOptions>(protector.Unprotect(row.ProtectedJson))!;
        var channels = Channels.ToDictionary(id => id, id => Merge(saved.Channels?.GetValueOrDefault(id) ?? new(), config.GetSection("Commerce:Channels:" + id)));
        return saved with { SiteUrl = config["Commerce:SiteUrl"] ?? saved.SiteUrl, Channels = channels, Version = row?.Version ?? 0 };
    }

    private static PaymentChannel Merge(PaymentChannel saved, IConfiguration section)
    {
        var values = JsonSerializer.Deserialize<Dictionary<string, JsonElement>>(JsonSerializer.Serialize(saved))!;
        foreach (var key in values.Keys.ToArray())
            if (section[key] is { } value) values[key] = key is "Enabled" or "TestMode"
                ? JsonSerializer.SerializeToElement(bool.Parse(value)) : JsonSerializer.SerializeToElement(value);
        return JsonSerializer.Deserialize<PaymentChannel>(JsonSerializer.Serialize(values))!;
    }

    /// <summary>Read masked credentials, readiness and callback addresses.</summary>
    public async Task<CommerceSettingsView> ViewAsync()
    {
        var options = await LoadAsync();
        return new(options.SiteUrl, options.Version, config["Commerce:SiteUrl"] != null, Channels.Select(id =>
        {
            var channel = options.Channels![id];
            var error = Error(id, channel, options.SiteUrl);
            var values = JsonSerializer.Deserialize<Dictionary<string, JsonElement>>(JsonSerializer.Serialize(channel))!;
            return new ChannelSettings(id, channel with { PrivateKey = "", ApiV3Key = "", SecretKey = "", WebhookSecret = "" },
                Secrets.Where(key => !string.IsNullOrEmpty(values[key].GetString())).ToArray(), error == "",
                config.GetSection("Commerce:Channels:" + id).GetChildren().Any(), error, options.SiteUrl.TrimEnd('/') + "/api/v1/payments/" + id + "/notify");
        }).ToArray());
    }

    /// <summary>Persist credentials without returning or auditing their plaintext.</summary>
    public async Task<CommerceSettingsView> SaveAsync(string actor, CommerceOptions input)
    {
        if (input.Channels == null || input.Channels.Keys.Except(Channels).Any() || input.SiteUrl == null || input.SiteUrl.Length > 500 ||
            JsonSerializer.Serialize(input).Length > 40000) throw Bad("支付设置格式无效。");
        await repository.WriteAsync(actor, "commerce.settings", async repo =>
        {
            var row = await repo.FindAsync<ShopSettings>("site");
            if ((row?.Version ?? 0) != input.Version) throw Bad("支付设置已被修改，请刷新后重试。", 409);
            var old = row == null ? new CommerceOptions() : JsonSerializer.Deserialize<CommerceOptions>(protector.Unprotect(row.ProtectedJson))!;
            var channels = new Dictionary<string, PaymentChannel>();
            foreach (var id in Channels)
            {
                var current = old.Channels?.GetValueOrDefault(id) ?? new();
                var next = input.Channels.GetValueOrDefault(id) ?? current;
                next = next with { AppId = next.AppId?.Trim() ?? "", MerchantId = next.MerchantId?.Trim() ?? "",
                    SerialNo = next.SerialNo?.Trim() ?? "", PublicKeyId = next.PublicKeyId?.Trim() ?? "", PublicKey = next.PublicKey?.Trim() ?? "" };
                next = next with { PrivateKey = Keep(next.PrivateKey, current.PrivateKey), SecretKey = Keep(next.SecretKey, current.SecretKey),
                    ApiV3Key = Keep(next.ApiV3Key, current.ApiV3Key), WebhookSecret = Keep(next.WebhookSecret, current.WebhookSecret) };
                var effective = Merge(next, config.GetSection("Commerce:Channels:" + id));
                if (effective.Enabled && Error(id, effective, config["Commerce:SiteUrl"] ?? input.SiteUrl) is { Length: > 0 } error) throw Bad(error);
                channels[id] = next;
            }
            var fresh = row == null; row ??= new() { Id = "site" };
            row.Version++;
            row.ProtectedJson = protector.Protect(JsonSerializer.Serialize(input with { SiteUrl = input.SiteUrl.TrimEnd('/'), Channels = channels, Version = row.Version }));
            repo.SetAuditTarget("commerce", "settings", "支付渠道设置");
            if (fresh) await repo.InsertAsync(row); else await repo.UpdateAsync(row);
            return true;
        });
        return await ViewAsync();
    }

    private static string Keep(string? next, string old) => string.IsNullOrWhiteSpace(next) ? old : next.Trim();
    internal static string AccountHash(string id, PaymentChannel c) => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(
        id + ":" + c.TestMode + ":" + c.AppId + ":" + c.MerchantId)));
    internal static string Error(string id, PaymentChannel c, string site)
    {
        if (!Uri.TryCreate(site, UriKind.Absolute, out var uri) || uri.Scheme != "https" || uri.AbsolutePath != "/" || uri.Query != "" || uri.Fragment != "" || uri.UserInfo != "")
            return "请填写网站的 HTTPS 根地址，例如 https://shop.example.com。";
        if (id == "stripe") return c.SecretKey?.StartsWith(c.TestMode ? "sk_test_" : "sk_live_", StringComparison.Ordinal) == true && c.WebhookSecret?.StartsWith("whsec_", StringComparison.Ordinal) == true &&
            c.MerchantId != null && System.Text.RegularExpressions.Regex.IsMatch(c.MerchantId, "^acct_[A-Za-z0-9]{1,80}$")
            ? "" : "Stripe 需要账户 ID（acct_ 开头）、与所选环境一致的 Secret Key 和 Webhook 签名密钥。";
        if (id is not ("alipay" or "wechat")) return "支付渠道无效。";
        if (string.IsNullOrWhiteSpace(c.AppId) || string.IsNullOrWhiteSpace(c.MerchantId) ||
            new[] { c.AppId, c.MerchantId, c.SerialNo, c.PublicKeyId }.Any(v => v == null || v.Length > 100 || v.Any(ch => !char.IsAsciiLetterOrDigit(ch) && ch != '_')))
            return "请填写正确的应用 ID 和商户 / 卖家 ID。";
        if (id == "wechat" && (c.TestMode || c.SerialNo == "" || c.PublicKeyId == "" || c.ApiV3Key == null || Encoding.UTF8.GetByteCount(c.ApiV3Key) != 32))
            return "微信支付需要商户证书序列号、微信支付公钥 ID 和 32 字节 APIv3 密钥；Native 不支持此测试模式。";
        try
        {
            using var privateKey = RSA.Create(); privateKey.ImportFromPem(c.PrivateKey);
            if (privateKey.KeySize < 2048 || privateKey.ExportParameters(true).D == null) return "请填写 2048 位以上的商户 RSA 私钥。";
            using var publicKey = RSA.Create(); publicKey.ImportFromPem(c.PublicKey);
            if (publicKey.KeySize < 2048) return "请填写支付平台的 RSA 公钥。";
        }
        catch (Exception e) when (e is ArgumentException or CryptographicException) { return "RSA 密钥格式无效，请粘贴完整 PEM 内容。"; }
        return "";
    }
    internal static CmsException Bad(string message, int status = 400) => new(status, "COMMERCE_ERROR", message);
}
