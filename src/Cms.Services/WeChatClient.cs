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
        // Match WeChat's curl -F format instead of .NET's quoted boundary and filename* extension.
        var boundary = body.Headers.ContentType!.Parameters.Single(x => x.Name == "boundary");
        boundary.Value = boundary.Value!.Trim('"');
        var stream = new StreamContent(File.OpenRead(file.Path));
        stream.Headers.ContentType = new MediaTypeHeaderValue(file.ContentType);
        stream.Headers.ContentDisposition = new ContentDispositionHeaderValue("form-data")
        { Name = "\"media\"", FileName = $"\"{(cover ? "cover" : "image")}{Path.GetExtension(file.Path)}\"" };
        body.Add(stream);
        var response = await SendAsync(cover ? "material/add_material" : "media/uploadimg", body,
            await TokenAsync(account, cancellation), cancellation, cover ? "&type=image" : "");
        return Required(response, cover ? "media_id" : "url", cover ? "material/add_material" : "media/uploadimg");
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
            token = Required(json, "access_token", "stable_token");
            if (!json.TryGetProperty("expires_in", out var value) || value.ValueKind != JsonValueKind.Number || !value.TryGetInt32(out var seconds) || seconds <= 0)
                throw new WeChatRequestException("stable_token", "响应缺少有效的 expires_in。");
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
        try
        {
            using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellation);
            timeout.CancelAfter(TimeSpan.FromSeconds(30));
            // WeChat rejects chunked JSON with HTTP 412; buffering supplies Content-Length.
            if (body is JsonContent) await body.LoadIntoBufferAsync(timeout.Token);
            using var response = await http.PostAsync("https://api.weixin.qq.com/cgi-bin/" + endpoint +
                (accessToken == "" ? "" : "?access_token=" + Uri.EscapeDataString(accessToken)) + suffix, body, timeout.Token);
            if (!response.IsSuccessStatusCode) throw new WeChatRequestException(endpoint, $"微信接口返回 HTTP {(int)response.StatusCode}。");
            using var json = JsonDocument.Parse(await response.Content.ReadAsStringAsync(timeout.Token));
            var root = json.RootElement;
            if (root.ValueKind != JsonValueKind.Object) throw new WeChatRequestException(endpoint, "响应不是 JSON 对象。");
            if (root.TryGetProperty("errcode", out var code))
            {
                if (code.ValueKind != JsonValueKind.Number || !code.TryGetInt32(out var number))
                    throw new WeChatRequestException(endpoint, "响应中的 errcode 格式异常。");
                if (number != 0)
                {
                    if (number is 40001 or 40014 or 42001) expires = DateTime.MinValue;
                    var hint = number switch
                    {
                        40164 => "请将服务器出口 IP 加入公众号 IP 白名单。",
                        40013 or 40125 => "请检查公众号 AppID 和 AppSecret。",
                        41005 => "微信未识别到上传的文件数据，请检查素材上传请求格式。",
                        48001 => "账号没有此接口权限，请在公众号开发者后台核实。",
                        53503 => "草稿未通过发布检查，请在微信后台检查内容。",
                        53504 or 53505 => "此草稿需要在微信公众平台手动保存或发布。",
                        45009 or 45011 => "接口额度或调用频率已达上限，请稍后重试。",
                        40001 or 40014 or 42001 => "访问凭据已过期，请重试。",
                        _ => "请检查公众号权限、图片和文章内容后重试。"
                    };
                    throw new CmsException(502, "WECHAT_REJECTED", $"{Step(endpoint)}：微信拒绝请求（{number}）：{hint}");
                }
            }
            return root.Clone();
        }
        catch (Exception error) when (error is not (CmsException or WeChatRequestException) && !cancellation.IsCancellationRequested)
        { throw new WeChatRequestException(endpoint, Diagnostic(error)); }
    }

    /// <summary>Require a nonempty upstream identifier; incomplete replies have unknown outcomes.</summary>
    public static string Required(JsonElement json, string property, string endpoint = "") =>
        json.TryGetProperty(property, out var value) && value.ValueKind == JsonValueKind.String &&
        value.GetString() is { Length: > 0 } result ? result : throw new WeChatRequestException(endpoint, $"微信响应缺少有效的 {property}。");

    /// <summary>Describe only allowlisted failure metadata, never exception messages, request URLs or response bodies.</summary>
    public static string Diagnostic(Exception error) => error switch
    {
        WeChatRequestException safe => safe.Message,
        OperationCanceledException => "请求超时，请检查 API 容器到微信接口的连接。",
        HttpRequestException { HttpRequestError: HttpRequestError.NameResolutionError } => "DNS 解析失败。",
        HttpRequestException { HttpRequestError: HttpRequestError.SecureConnectionError } => "TLS／证书校验失败，请检查 API 容器证书和系统时间。",
        HttpRequestException { HttpRequestError: HttpRequestError.ConnectionError } => "连接微信接口失败，请检查 API 容器的网络和代理设置。",
        HttpRequestException { StatusCode: { } status } => $"微信接口返回 HTTP {(int)status}。",
        HttpRequestException httpError => $"网络请求失败（{httpError.HttpRequestError}）。",
        JsonException => "响应或快照不是有效的 JSON。",
        UnauthorizedAccessException => "读取素材被拒绝，请检查 API 容器的文件权限。",
        FileNotFoundException or DirectoryNotFoundException => "素材文件或目录不存在，请检查上传目录挂载。",
        IOException => "读取素材失败（文件 I/O 异常）。",
        _ => $"处理异常（{error.GetType().Name}），请结合任务编号检查 API 日志。"
    };

    /// <summary>Map fixed WeChat endpoints to credential-free editorial step names.</summary>
    public static string Step(string endpoint) => endpoint switch
    {
        "stable_token" => "获取微信访问凭据", "material/add_material" => "上传微信封面",
        "media/uploadimg" => "上传正文图片", "draft/add" => "创建微信草稿",
        "freepublish/submit" => "提交微信发布", "freepublish/get" => "查询微信发布状态", _ => "校验微信响应"
    };
}

/// <summary>A sanitized uncertain request failure; not CmsException, so submission failures cannot become retryable.</summary>
public sealed class WeChatRequestException(string endpoint, string detail) : HttpRequestException($"{WeChatClient.Step(endpoint)}：{detail}")
{
    /// <summary>Fixed API endpoint, excluding query parameters and credentials.</summary>
    public string Endpoint { get; } = endpoint;
}
