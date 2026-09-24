using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Encodings.Web;
using System.Text.Json;
using Cms.Data;

namespace Cms.Services;

/// <summary>Server-only WeChat calls with bounded timeouts and redacted errors.</summary>
public sealed class WeChatClient(HttpClient http)
{
    private readonly SemaphoreSlim tokens = new(1, 1);
    private string token = "", credentials = "";
    private DateTime expires;
    private static readonly JsonSerializerOptions Json = new() { Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping };

    /// <summary>Call a fixed official endpoint; never expose raw replies containing credentials.</summary>
    public async Task<JsonElement> PostAsync(string endpoint, object payload, WeChatOptions account, CancellationToken cancellation)
    {
        using var body = JsonContent.Create(payload, options: Json);
        return await SendAsync(endpoint, body, await TokenAsync(account, cancellation), cancellation);
    }

    /// <summary>Upload a validated local image as permanent cover or inline image.</summary>
    public async Task<string> UploadAsync(FileView file, bool cover, WeChatOptions account, CancellationToken cancellation)
    {
        using var body = new MultipartFormDataContent();
        var stream = new StreamContent(File.OpenRead(file.Path));
        stream.Headers.ContentType = new MediaTypeHeaderValue(file.ContentType);
        body.Add(stream, "media", cover ? "cover" + Path.GetExtension(file.Path) : "image" + Path.GetExtension(file.Path));
        var response = await SendAsync(cover ? "material/add_material" : "media/uploadimg", body,
            await TokenAsync(account, cancellation), cancellation, cover ? "&type=image" : "");
        return Required(response, cover ? "media_id" : "url");
    }

    private async Task<string> TokenAsync(WeChatOptions account, CancellationToken cancellation)
    {
        await tokens.WaitAsync(cancellation);
        try
        {
            var app = account.AppId;
            var secret = account.AppSecret;
            if (credentials == app + ":" + secret && expires > DateTime.UtcNow) return token;
            using var body = JsonContent.Create(new { grant_type = "client_credential", appid = app, secret, force_refresh = false });
            var json = await SendAsync("stable_token", body, "", cancellation);
            token = Required(json, "access_token");
            if (!json.TryGetProperty("expires_in", out var value) || !value.TryGetInt32(out var seconds) || seconds <= 0)
                throw new HttpRequestException("WeChat token response is incomplete.");
            credentials = app + ":" + secret;
            expires = DateTime.UtcNow.AddSeconds(Math.Max(0, seconds - 300));
            return token;
        }
        finally { tokens.Release(); }
    }

    private async Task<JsonElement> SendAsync(string endpoint, HttpContent body, string accessToken,
        CancellationToken cancellation, string suffix = "")
    {
        if (endpoint is not ("stable_token" or "material/add_material" or "media/uploadimg" or "draft/add" or "freepublish/submit" or "freepublish/get"))
            throw new ArgumentException("Unsupported WeChat endpoint.", nameof(endpoint));
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellation);
        timeout.CancelAfter(TimeSpan.FromSeconds(30));
        using var response = await http.PostAsync("https://api.weixin.qq.com/cgi-bin/" + endpoint +
            (accessToken == "" ? "" : "?access_token=" + Uri.EscapeDataString(accessToken)) + suffix, body, timeout.Token);
        if (!response.IsSuccessStatusCode) throw new HttpRequestException("WeChat HTTP request failed.");
        using var json = JsonDocument.Parse(await response.Content.ReadAsStringAsync(timeout.Token));
        var root = json.RootElement;
        if (root.TryGetProperty("errcode", out var code) && code.GetInt32() != 0)
        {
            var number = code.GetInt32();
            if (number is 40001 or 40014 or 42001) expires = DateTime.MinValue;
            var hint = number switch
            {
                40164 => "请将服务器出口 IP 加入公众号 IP 白名单。",
                40013 or 40125 => "请检查公众号 AppID 和 AppSecret。",
                48001 => "账号没有此接口权限，请在公众号开发者后台核实。",
                53503 => "草稿未通过发布检查，请在微信后台检查内容。",
                53504 or 53505 => "此草稿需要在微信公众平台手动保存或发布。",
                45009 or 45011 => "接口额度或调用频率已达上限，请稍后重试。",
                40001 or 40014 or 42001 => "访问凭据已过期，请重试。",
                _ => "请检查公众号权限、图片和文章内容后重试。"
            };
            throw new CmsException(502, "WECHAT_REJECTED", $"微信拒绝请求（{number}）：{hint}");
        }
        return root.Clone();
    }

    /// <summary>Require a nonempty upstream identifier; incomplete replies have unknown outcomes.</summary>
    public static string Required(JsonElement json, string property) =>
        json.TryGetProperty(property, out var value) && value.ValueKind == JsonValueKind.String &&
        value.GetString() is { Length: > 0 } result ? result : throw new HttpRequestException("Incomplete WeChat response.");
}
