using System.Globalization;
using System.Net.Http.Headers;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Cms.Data;

namespace Cms.Services;

/// <summary>Provider checkout destination; never a download authorization.</summary>
public record PaymentLink(string Reference, string Url);
/// <summary>Authenticated provider observation, still subject to order/account/amount matching.</summary>
public record PaymentResult(string OrderId, long Amount, string Currency, string Transaction, string State, bool TestMode, string CheckoutReference = "");

/// <summary>Fixed-host payment protocols using platform cryptography and HTTP; no browser payment assertions are trusted.</summary>
public sealed class PaymentGateway(HttpClient http)
{
    /// <summary>Create a hosted or native single-item payment using server-side order snapshots.</summary>
    public async Task<PaymentLink> CreateAsync(ShopOrder order, CommerceOptions options)
    {
        var c = options.Channels![order.Channel];
        var notify = options.SiteUrl + "/api/v1/payments/" + order.Channel + "/notify";
        var back = options.SiteUrl + "/orders/" + order.Id;
        if (order.Channel == "alipay")
        {
            var values = AlipayParameters(c, "alipay.trade.page.pay", new { out_trade_no = order.Id, total_amount = Yuan(order.Amount),
                subject = order.Title, product_code = "FAST_INSTANT_TRADE_PAY", time_expire = order.ExpiresAt.AddHours(8).ToString("yyyy-MM-dd HH:mm:ss", CultureInfo.InvariantCulture) });
            values["notify_url"] = notify; values["return_url"] = back;
            values["sign"] = Sign(c.PrivateKey, Canonical(values));
            return new(order.Id, AlipayHost(c) + "?" + await new FormUrlEncodedContent(values).ReadAsStringAsync());
        }
        if (order.Channel == "wechat")
        {
            var result = await WechatAsync(c, HttpMethod.Post, "/v3/pay/transactions/native", new { appid = c.AppId, mchid = c.MerchantId,
                description = order.Title.Length > 40 ? order.Title[..40] : order.Title, out_trade_no = order.Id, notify_url = notify,
                time_expire = new DateTimeOffset(DateTime.SpecifyKind(order.ExpiresAt, DateTimeKind.Utc)).ToString("yyyy-MM-dd'T'HH:mm:sszzz", CultureInfo.InvariantCulture),
                amount = new { total = order.Amount, currency = order.Currency } });
            var url = Text(result, "code_url");
            if (!url.StartsWith("weixin://wxpay/", StringComparison.Ordinal)) throw ProviderError();
            return new(order.Id, url);
        }
        await StripeAccountAsync(c);
        var session = await StripeAsync(c, HttpMethod.Post, "/v1/checkout/sessions", new()
        {
            ["mode"] = "payment", ["client_reference_id"] = order.Id, ["customer_email"] = order.Email,
            ["success_url"] = back, ["cancel_url"] = back, ["payment_method_types[0]"] = "card",
            ["expires_at"] = new DateTimeOffset(DateTime.SpecifyKind(order.ExpiresAt, DateTimeKind.Utc)).ToUnixTimeSeconds().ToString(CultureInfo.InvariantCulture),
            ["line_items[0][quantity]"] = "1", ["line_items[0][price_data][currency]"] = order.Currency.ToLowerInvariant(),
            ["line_items[0][price_data][unit_amount]"] = order.Amount.ToString(CultureInfo.InvariantCulture),
            ["line_items[0][price_data][product_data][name]"] = order.Title
        }, order.Id);
        var destination = Text(session, "url");
        if (!Uri.TryCreate(destination, UriKind.Absolute, out var uri) || uri.Scheme != "https" || uri.Host != "checkout.stripe.com") throw ProviderError();
        return new(Text(session, "id"), destination);
    }

    /// <summary>Reconcile an order against its selected merchant account, never a user-supplied gateway URL.</summary>
    public async Task<PaymentResult> QueryAsync(ShopOrder order, CommerceOptions options)
    {
        var c = options.Channels![order.Channel];
        if (order.ProviderReference == "" && order.Status == "pending") return new(order.Id, order.Amount, order.Currency, "", "pending", c.TestMode);
        if (order.Channel == "wechat")
            return WechatResult(await WechatAsync(c, HttpMethod.Get, "/v3/pay/transactions/out-trade-no/" + order.Id + "?mchid=" + c.MerchantId), c);
        if (order.Channel == "alipay")
        {
            var row = await AlipayAsync(c, "alipay.trade.query", new { out_trade_no = order.Id });
            return new(Text(row, "out_trade_no"), Minor(Text(row, "total_amount")), "CNY", Text(row, "trade_no"),
                Text(row, "trade_status") is "TRADE_SUCCESS" or "TRADE_FINISHED" ? "paid" : Text(row, "trade_status") == "TRADE_CLOSED" ? "closed" : "pending", c.TestMode);
        }
        if (order.ProviderReference == "") throw ProviderError();
        await StripeAccountAsync(c);
        var session = await StripeAsync(c, HttpMethod.Get, "/v1/checkout/sessions/" + Uri.EscapeDataString(order.ProviderReference));
        var result = StripeResult(session);
        if (result.State == "paid" && result.Transaction != "")
        {
            var payment = await StripeAsync(c, HttpMethod.Get, "/v1/payment_intents/" + Uri.EscapeDataString(result.Transaction) + "?expand%5B%5D=latest_charge");
            if (payment.TryGetProperty("latest_charge", out var charge) && charge.ValueKind == JsonValueKind.Object &&
                charge.TryGetProperty("refunded", out var refunded) && refunded.GetBoolean()) result = result with { State = "refunded" };
        }
        return result;
    }

    /// <summary>Close only an unpaid remote checkout; callers reconcile again when closing races a payment.</summary>
    public async Task CloseAsync(ShopOrder order, CommerceOptions options)
    {
        var c = options.Channels![order.Channel];
        if (order.Channel == "wechat") await WechatAsync(c, HttpMethod.Post, "/v3/pay/transactions/out-trade-no/" + order.Id + "/close", new { mchid = c.MerchantId });
        else if (order.Channel == "alipay") await AlipayAsync(c, "alipay.trade.close", new { out_trade_no = order.Id }, allowMissing: true);
        else if (order.ProviderReference != "")
        {
            await StripeAccountAsync(c);
            var session = await StripeAsync(c, HttpMethod.Get, "/v1/checkout/sessions/" + Uri.EscapeDataString(order.ProviderReference));
            if (Text(session, "status") != "expired")
                await StripeAsync(c, HttpMethod.Post, "/v1/checkout/sessions/" + Uri.EscapeDataString(order.ProviderReference) + "/expire", new(), order.Id + "-close");
        }
    }

    /// <summary>Verify raw notification bytes before reading transaction state; irrelevant signed events are acknowledged without delivery.</summary>
    public PaymentResult? Notification(string channel, PaymentChannel c, string body, IReadOnlyDictionary<string, string> headers,
        IReadOnlyDictionary<string, string>? form = null)
    {
        try
        {
            if (channel == "alipay")
            {
                if (form == null || form.GetValueOrDefault("sign_type") != "RSA2" ||
                    !Verify(c.PublicKey, Canonical(form.Where(x => x.Key is not ("sign" or "sign_type")).ToDictionary()), form.GetValueOrDefault("sign", "")) ||
                    form.GetValueOrDefault("app_id") != c.AppId || form.GetValueOrDefault("seller_id") != c.MerchantId) throw SignatureError();
                var status = form.GetValueOrDefault("trade_status");
                if (status is not ("TRADE_SUCCESS" or "TRADE_FINISHED" or "TRADE_CLOSED")) return null;
                return new(form.GetValueOrDefault("out_trade_no", ""), Minor(form.GetValueOrDefault("total_amount", "")), "CNY",
                    form.GetValueOrDefault("trade_no", ""), status == "TRADE_CLOSED" ? "closed" : "paid", c.TestMode);
            }
            if (channel == "wechat")
            {
                VerifyWechat(c, body, headers);
                using var message = JsonDocument.Parse(body);
                if (Text(message.RootElement, "event_type") != "TRANSACTION.SUCCESS") return null;
                var resource = message.RootElement.GetProperty("resource");
                if (Text(resource, "algorithm") != "AEAD_AES_256_GCM") throw SignatureError();
                var encrypted = Convert.FromBase64String(Text(resource, "ciphertext"));
                if (encrypted.Length < 16) throw SignatureError();
                var clear = new byte[encrypted.Length - 16];
                using var aes = new AesGcm(Encoding.UTF8.GetBytes(c.ApiV3Key), 16);
                aes.Decrypt(Encoding.UTF8.GetBytes(Text(resource, "nonce")), encrypted.AsSpan(0, clear.Length), encrypted.AsSpan(clear.Length), clear,
                    Encoding.UTF8.GetBytes(Text(resource, "associated_data")));
                using var decoded = JsonDocument.Parse(clear);
                return WechatResult(decoded.RootElement, c);
            }
            var parts = headers.GetValueOrDefault("Stripe-Signature", "").Split(',').Select(x => x.Split('=', 2)).Where(x => x.Length == 2).ToArray();
            var timestamp = parts.FirstOrDefault(x => x[0] == "t")?[1] ?? "";
            Recent(timestamp);
            var expected = HMACSHA256.HashData(Encoding.UTF8.GetBytes(c.WebhookSecret), Encoding.UTF8.GetBytes(timestamp + "." + body));
            if (!parts.Where(x => x[0] == "v1").Any(x => EqualHex(expected, x[1]))) throw SignatureError();
            using var stripe = JsonDocument.Parse(body);
            var root = stripe.RootElement;
            if (Text(root, "type") is not ("checkout.session.completed" or "checkout.session.async_payment_succeeded")) return null;
            var row = root.GetProperty("data").GetProperty("object");
            return Text(row, "payment_status") == "paid" ? StripeResult(row) : null;
        }
        catch (Exception e) when (e is JsonException or FormatException or CryptographicException or ArgumentException or InvalidOperationException or KeyNotFoundException)
        { throw SignatureError(); }
    }

    private static PaymentResult StripeResult(JsonElement row) => new(Text(row, "client_reference_id"), row.GetProperty("amount_total").GetInt64(),
        Text(row, "currency").ToUpperInvariant(), Text(row, "payment_intent"), Text(row, "payment_status") == "paid" ? "paid" : Text(row, "status") == "expired" ? "closed" : "pending",
        !row.GetProperty("livemode").GetBoolean(), Text(row, "id"));
    private static PaymentResult WechatResult(JsonElement row, PaymentChannel c)
    {
        if (Text(row, "appid") != c.AppId || Text(row, "mchid") != c.MerchantId) throw SignatureError();
        var amount = row.GetProperty("amount");
        return new(Text(row, "out_trade_no"), amount.GetProperty("total").GetInt64(), Text(amount, "currency"), Text(row, "transaction_id"),
            Text(row, "trade_state") switch { "SUCCESS" => "paid", "REFUND" => "refunded", "CLOSED" or "REVOKED" => "closed", _ => "pending" }, false);
    }

    private async Task StripeAccountAsync(PaymentChannel c)
    {
        if (Text(await StripeAsync(c, HttpMethod.Get, "/v1/account"), "id") != c.MerchantId) throw SignatureError();
    }
    private async Task<JsonElement> StripeAsync(PaymentChannel c, HttpMethod method, string path, Dictionary<string, string>? fields = null, string? key = null)
    {
        using var request = new HttpRequestMessage(method, "https://api.stripe.com" + path);
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", c.SecretKey);
        // Fixed API contract, independent of future account default version changes.
        request.Headers.Add("Stripe-Version", "2024-06-20");
        if (key != null) request.Headers.Add("Idempotency-Key", key);
        if (fields != null) request.Content = new FormUrlEncodedContent(fields);
        var body = await SendAsync(request);
        using var document = JsonDocument.Parse(body);
        return document.RootElement.Clone();
    }
    private static SortedDictionary<string, string> AlipayParameters(PaymentChannel c, string method, object business) => new(StringComparer.Ordinal)
    {
        ["app_id"] = c.AppId, ["method"] = method, ["format"] = "JSON", ["charset"] = "utf-8", ["sign_type"] = "RSA2", ["version"] = "1.0",
        ["timestamp"] = DateTime.UtcNow.AddHours(8).ToString("yyyy-MM-dd HH:mm:ss", CultureInfo.InvariantCulture), ["biz_content"] = JsonSerializer.Serialize(business)
    };
    private static string AlipayHost(PaymentChannel c) => c.TestMode ? "https://openapi-sandbox.dl.alipaydev.com/gateway.do" : "https://openapi.alipay.com/gateway.do";
    private async Task<JsonElement> AlipayAsync(PaymentChannel c, string method, object business, bool allowMissing = false)
    {
        var values = AlipayParameters(c, method, business); values["sign"] = Sign(c.PrivateKey, Canonical(values));
        using var request = new HttpRequestMessage(HttpMethod.Post, AlipayHost(c)) { Content = new FormUrlEncodedContent(values) };
        var body = await SendAsync(request);
        using var document = JsonDocument.Parse(body);
        var row = document.RootElement.GetProperty(method.Replace('.', '_') + "_response");
        if (!Verify(c.PublicKey, row.GetRawText(), Text(document.RootElement, "sign"))) throw SignatureError();
        if (Text(row, "code") != "10000" && !(allowMissing && Text(row, "sub_code") == "ACQ.TRADE_NOT_EXIST")) throw ProviderError();
        return row.Clone();
    }
    private async Task<JsonElement> WechatAsync(PaymentChannel c, HttpMethod method, string path, object? payload = null)
    {
        var body = payload == null ? "" : JsonSerializer.Serialize(payload);
        var timestamp = DateTimeOffset.UtcNow.ToUnixTimeSeconds().ToString(CultureInfo.InvariantCulture);
        var nonce = Convert.ToHexString(RandomNumberGenerator.GetBytes(16));
        using var request = new HttpRequestMessage(method, "https://api.mch.weixin.qq.com" + path);
        request.Headers.TryAddWithoutValidation("Authorization", $"WECHATPAY2-SHA256-RSA2048 mchid=\"{c.MerchantId}\",nonce_str=\"{nonce}\",timestamp=\"{timestamp}\",serial_no=\"{c.SerialNo}\",signature=\"{Sign(c.PrivateKey, method.Method + "\n" + path + "\n" + timestamp + "\n" + nonce + "\n" + body + "\n")}\"");
        request.Headers.Add("Accept", "application/json");
        request.Headers.Add("Wechatpay-Serial", c.PublicKeyId);
        if (payload != null) request.Content = new StringContent(body, Encoding.UTF8, "application/json");
        using var response = await http.SendAsync(request);
        var text = await response.Content.ReadAsStringAsync();
        if (!response.IsSuccessStatusCode) throw ProviderError();
        if (response.StatusCode == System.Net.HttpStatusCode.NoContent) return JsonSerializer.SerializeToElement(new { });
        VerifyWechat(c, text, response.Headers.ToDictionary(x => x.Key, x => string.Join(",", x.Value), StringComparer.OrdinalIgnoreCase));
        using var document = JsonDocument.Parse(text);
        return document.RootElement.Clone();
    }
    private async Task<string> SendAsync(HttpRequestMessage request)
    {
        using var response = await http.SendAsync(request);
        var body = await response.Content.ReadAsStringAsync();
        if (!response.IsSuccessStatusCode) throw ProviderError();
        return body;
    }
    private static void VerifyWechat(PaymentChannel c, string body, IReadOnlyDictionary<string, string> headers)
    {
        var timestamp = headers.GetValueOrDefault("Wechatpay-Timestamp", ""); Recent(timestamp);
        if (headers.GetValueOrDefault("Wechatpay-Serial") != c.PublicKeyId || !Verify(c.PublicKey,
                timestamp + "\n" + headers.GetValueOrDefault("Wechatpay-Nonce", "") + "\n" + body + "\n", headers.GetValueOrDefault("Wechatpay-Signature", ""))) throw SignatureError();
    }
    private static void Recent(string timestamp)
    {
        if (!long.TryParse(timestamp, out var seconds) || seconds < DateTimeOffset.UtcNow.ToUnixTimeSeconds() - 300 || seconds > DateTimeOffset.UtcNow.ToUnixTimeSeconds() + 300) throw SignatureError();
    }
    private static bool EqualHex(byte[] expected, string hex) => hex.Length == expected.Length * 2 && hex.All(char.IsAsciiHexDigit) && CryptographicOperations.FixedTimeEquals(expected, Convert.FromHexString(hex));
    private static string Canonical(IEnumerable<KeyValuePair<string, string>> values) => string.Join("&", values.Where(x => x.Value != "").OrderBy(x => x.Key, StringComparer.Ordinal).Select(x => x.Key + "=" + x.Value));
    private static string Sign(string pem, string value) { using var rsa = RSA.Create(); rsa.ImportFromPem(pem); return Convert.ToBase64String(rsa.SignData(Encoding.UTF8.GetBytes(value), HashAlgorithmName.SHA256, RSASignaturePadding.Pkcs1)); }
    private static bool Verify(string pem, string value, string signature) { using var rsa = RSA.Create(); rsa.ImportFromPem(pem); return rsa.VerifyData(Encoding.UTF8.GetBytes(value), Convert.FromBase64String(signature), HashAlgorithmName.SHA256, RSASignaturePadding.Pkcs1); }
    private static string Text(JsonElement row, string name) => row.TryGetProperty(name, out var item) && item.ValueKind == JsonValueKind.String ? item.GetString()! : "";
    private static string Yuan(long minor) => (minor / 100m).ToString("0.00", CultureInfo.InvariantCulture);
    private static long Minor(string value) => decimal.TryParse(value, NumberStyles.AllowDecimalPoint, CultureInfo.InvariantCulture, out var amount) && amount > 0 && amount <= 1_000_000 && amount * 100 == decimal.Truncate(amount * 100)
        ? (long)(amount * 100) : throw SignatureError();
    private static CmsException SignatureError() => new(400, "INVALID_PAYMENT_SIGNATURE", "支付通知或应答校验失败。");
    private static CmsException ProviderError() => new(502, "PAYMENT_PROVIDER_ERROR", "支付平台暂未接受请求，请核对渠道配置或稍后重试；请勿重复付款。");
}
