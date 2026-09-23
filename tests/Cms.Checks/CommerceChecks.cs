using System.Globalization;
using System.Net;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using Cms.Data;
using Cms.Services;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.WebUtilities;
using Microsoft.Extensions.Configuration;

/// <summary>Real RSA/HMAC/AES protocol checks using a fixed fake HTTP transport and an isolated database.</summary>
public static class CommerceChecks
{
    /// <summary>Check merchant settings, all three payment protocols, replay safety and protected delivery.</summary>
    public static async Task RunAsync(CmsRepository repo)
    {
        await repo.InitializeSchemaAsync();
        var root = Path.GetFullPath(Environment.GetEnvironmentVariable("CMS_COMMERCE_TEST_ROOT") ?? throw new Exception("Isolated root required"));
        Directory.CreateDirectory(root);
        using var merchant = RSA.Create(2048); using var platform = RSA.Create(2048);
        var config = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?> {
            ["Storage:Path"] = root + "/uploads", ["Security:KeyPath"] = root + "/keys", ["Maintenance:BackupPath"] = root + "/backups" }).Build();
        var provider = DataProtectionProvider.Create(new DirectoryInfo(root + "/keys"));
        var settings = new CommerceSettings(repo, config, provider);
        var channels = new Dictionary<string, PaymentChannel>
        {
            ["alipay"] = new() { Enabled = true, AppId = "app1", MerchantId = "seller1", PrivateKey = merchant.ExportRSAPrivateKeyPem(), PublicKey = platform.ExportSubjectPublicKeyInfoPem() },
            ["wechat"] = new() { Enabled = true, AppId = "wx1", MerchantId = "123456", SerialNo = "SERIAL1", PublicKeyId = "PUB_KEY_ID_TEST", ApiV3Key = new string('a', 32), PrivateKey = merchant.ExportRSAPrivateKeyPem(), PublicKey = platform.ExportSubjectPublicKeyInfoPem() },
            ["stripe"] = new() { Enabled = true, MerchantId = "acct_fixture", SecretKey = "sk_live_fixture_not_a_real_key", WebhookSecret = "whsec_fixture_not_a_real_key" }
        };
        await settings.SaveAsync("test", new("https://shop.example.com", channels));
        var stored = (await repo.FindAsync<ShopSettings>("site"))!.ProtectedJson;
        Check(!stored.Contains("sk_live_") && !stored.Contains("PRIVATE KEY"), "settings encrypted at rest");
        var view = await settings.ViewAsync();
        Check(view.Channels.All(x => x.Configured && x.Values.PrivateKey == "" && x.Values.SecretKey == "" && x.Values.ApiV3Key == "" && x.Values.WebhookSecret == ""), "secrets redacted");
        await settings.SaveAsync("test", new(view.SiteUrl, view.Channels.ToDictionary(x => x.Id, x => x.Values), view.Version));
        Check((await settings.LoadAsync()).Channels!["stripe"].SecretKey == channels["stripe"].SecretKey, "blank secrets preserved");
        var overrides = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?> { ["Commerce:Channels:stripe:Enabled"] = "false" }).Build();
        Check(!(await new CommerceSettings(repo, overrides, provider).LoadAsync()).Channels!["stripe"].Enabled, "deployment overrides database");
        config["Commerce:Channels:stripe:MerchantId"] = "acct_managed";
        var managed = await settings.ViewAsync();
        var masked = managed.Channels.ToDictionary(x => x.Id, x => x.Values);
        masked["stripe"] = new() { Enabled = true };
        await settings.SaveAsync("test", new(managed.SiteUrl, masked, managed.Version));
        Check((await settings.LoadAsync()).Channels!["stripe"].MerchantId == "acct_managed", "save validates effective deployment configuration");
        config["Commerce:Channels:stripe:MerchantId"] = null;
        var reset = await settings.LoadAsync();
        await settings.SaveAsync("test", new(reset.SiteUrl, channels, reset.Version));

        using var transport = new GatewayTransport(repo, merchant, platform, channels);
        using var http = new HttpClient(transport);
        var gateway = new PaymentGateway(http);
        var service = new CommerceService(repo, settings, gateway, config);
        var content = new Content { Kind = "product", Title = "数字资料", PublishedTitle = "数字资料", Published = true, Slug = "commerce-fixture" };
        await repo.InsertAsync(content);
        var original = await service.UploadAsync("test", "paid.txt", new MemoryStream("original private bytes"u8.ToArray()), default);
        var replacement = await service.UploadAsync("test", "new.txt", new MemoryStream("replacement bytes"u8.ToArray()), default);
        Check(await repo.FindAsync<Asset>(original.Id) == null, "private files never enter public asset library");
        await Reject(() => service.UploadAsync("test", "../bad.txt", new MemoryStream("x"u8.ToArray()), default), 400);
        var product = await service.SaveProductAsync("test", content.Id, new(true, 1250, "CNY", original.Id, 0));
        Check((await service.OfferAsync(content.Id))!.Channels.Length == 3, "three selectable channels");

        foreach (var channel in channels.Keys)
        {
            product = await service.SaveProductAsync("test", content.Id, new(true, 1250, "CNY", original.Id, product.Version));
            var secret = Secret();
            var input = new ShopOrderInput(content.Id, channel, "buyer@example.com", secret, product.Version);
            var copies = await Task.WhenAll(service.CreateAsync(input), service.CreateAsync(input));
            Check(copies[0].Id == copies[1].Id, channel + " idempotent create");
            var order = copies[0];
            await Reject(() => service.DownloadAsync(order.Id, secret), 403);
            await Reject(() => service.OrderAsync(order.Id, Secret()), 404);
            await Reject(() => service.CreateAsync(input with { Email = "other@example.com" }), 409);
            var links = await Task.WhenAll(service.PayAsync(order.Id, secret), service.PayAsync(order.Id, secret));
            Check(links[0] == links[1], channel + " retry reuses checkout");
            if (channel == "alipay")
            {
                var query = QueryHelpers.ParseQuery(new Uri(links[0].Url).Query).ToDictionary(x => x.Key, x => x.Value.ToString());
                var sign = query["sign"]; query.Remove("sign");
                Check(merchant.VerifyData(Encoding.UTF8.GetBytes(Canonical(query)), Convert.FromBase64String(sign), HashAlgorithmName.SHA256, RSASignaturePadding.Pkcs1), "Alipay checkout signature");
            }
            var row = (await repo.FindAsync<ShopOrder>(order.Id))!;
            var notice = Notice(row, channels[channel], platform);
            var bad = notice with { Headers = new Dictionary<string, string>(notice.Headers, StringComparer.OrdinalIgnoreCase) };
            if (channel == "stripe") bad.Headers["Stripe-Signature"] += "0";
            else if (channel == "wechat") bad.Headers["Wechatpay-Signature"] = Convert.ToBase64String(new byte[256]);
            else bad = bad with { Form = new(notice.Form!) { ["sign"] = Convert.ToBase64String(new byte[256]) } };
            await Reject(async () => { await service.NotifyAsync(channel, bad.Body, bad.Headers, bad.Form); return true; }, 400);
            var wrongAmount = Notice(row, channels[channel], platform, amount: row.Amount + 1);
            await Reject(async () => { await service.NotifyAsync(channel, wrongAmount.Body, wrongAmount.Headers, wrongAmount.Form); return true; }, 409);
            transport.States[row.Id] = "paid";
            await service.NotifyAsync(channel, notice.Body, notice.Headers, notice.Form);
            await service.NotifyAsync(channel, notice.Body, notice.Headers, notice.Form);
            Check((await service.OrderAsync(row.Id, secret)).Status == "paid", channel + " signed callback/replay");
            product = await service.SaveProductAsync("test", content.Id, new(false, 2500, "CNY", replacement.Id, product.Version));
            Check((await service.OrderAsync(row.Id, secret)).Amount == 1250, "order amount frozen");
            var file = await service.DownloadAsync(row.Id, secret);
            Check(await File.ReadAllTextAsync(file.Path) == "original private bytes", "purchased file remains frozen after replacement/unlisting");
            transport.States[row.Id] = "refunded";
            await Reject(() => service.DownloadAsync(row.Id, secret), 403);
            await service.NotifyAsync(channel, notice.Body, notice.Headers, notice.Form);
            Check((await service.OrderAsync(row.Id, secret)).Status == "refunded", "late payment callback cannot undo refund");
        }
        product = await service.SaveProductAsync("test", content.Id, new(true, 100, "USD", original.Id, product.Version));
        Check((await service.OfferAsync(content.Id))!.Channels.Select(x => x.Id).SequenceEqual(["stripe"]), "foreign currency channel filtering");
        await Reject(() => service.CreateAsync(new(content.Id, "wechat", "buyer@example.com", Secret(), product.Version)), 400);
        await Reject(() => service.CreateAsync(new(content.Id, "stripe", "buyer@example.com", Secret(), product.Version - 1)), 409);
        var closeSecret = Secret();
        var close = await service.CreateAsync(new(content.Id, "stripe", "buyer@example.com", closeSecret, product.Version));
        var paying = service.PayAsync(close.Id, closeSecret);
        var closing = service.CloseAsync(close.Id, closeSecret);
        await Task.WhenAll(paying, closing);
        Check((await service.OrderAsync(close.Id, closeSecret)).Status == "closed" && transport.States[close.Id] == "closed", "checkout/close race serialized");
        await Reject(() => service.PayAsync(close.Id, closeSecret), 409);

        var current = await settings.LoadAsync();
        channels["stripe"] = channels["stripe"] with { TestMode = true, SecretKey = "sk_test_fixture" };
        await settings.SaveAsync("test", new(current.SiteUrl, channels, current.Version));
        var testSecret = Secret();
        var testOrder = await service.CreateAsync(new(content.Id, "stripe", "buyer@example.com", testSecret, product.Version));
        var testNotice = Notice((await repo.FindAsync<ShopOrder>(testOrder.Id))!, channels["stripe"], platform);
        await service.NotifyAsync("stripe", testNotice.Body, testNotice.Headers, null);
        await Reject(() => service.DownloadAsync(testOrder.Id, testSecret), 403);
        var exported = new Dictionary<string, byte[]>(); await repo.ExportAsync((name, bytes) => { exported[name] = bytes; return Task.CompletedTask; });
        Check(new[] { "ShopProduct.json", "ShopFile.json", "ShopOrder.json", "ShopSettings.json" }.All(exported.ContainsKey), "commerce included in logical backup");
        var maintenance = new MaintenanceService(repo, config);
        await maintenance.BackupAsync("test");
        var backup = await maintenance.DownloadAsync();
        using var restoredDb = new FreeSql.FreeSqlBuilder().UseConnectionString(FreeSql.DataType.Sqlite, "Data Source=" + root + "/restored.db").UseAutoSyncStructure(false).Build();
        var restoredRepo = new CmsRepository(restoredDb);
        await restoredRepo.InitializeSchemaAsync();
        var restoredConfig = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?> {
            ["Storage:Path"] = root + "/restored/uploads", ["Security:KeyPath"] = root + "/restored/keys" }).Build();
        await new MaintenanceService(restoredRepo, restoredConfig).RestoreAsync(backup.Path);
        var restoredSettings = new CommerceSettings(restoredRepo, restoredConfig, DataProtectionProvider.Create(new DirectoryInfo(root + "/restored/keys")));
        Check((await restoredSettings.LoadAsync()).Channels!["stripe"].SecretKey == "sk_test_fixture", "backup restores credential decryption keys");
        Check((await restoredRepo.FindAsync<ShopOrder>(testOrder.Id))!.Status == "paid" &&
            await File.ReadAllTextAsync(root + "/restored/uploads/shop-" + original.Id + ".bin") == "original private bytes", "backup restores paid orders and frozen private files");
        Console.WriteLine("PASS: all three signed payment protocols, settings secrecy/overrides, duplicate orders/callbacks, invalid signatures/amounts, private/frozen downloads, refunds, test-mode isolation and checkout-close race");
    }

    private record Notification(string Body, Dictionary<string, string> Headers, Dictionary<string, string>? Form = null);
    private static Notification Notice(ShopOrder row, PaymentChannel c, RSA platform, long? amount = null)
    {
        var timestamp = DateTimeOffset.UtcNow.ToUnixTimeSeconds().ToString(CultureInfo.InvariantCulture);
        var headers = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        if (row.Channel == "stripe")
        {
            var body = JsonSerializer.Serialize(new { type = "checkout.session.completed", data = new { @object = new { id = "cs_" + row.Id, client_reference_id = row.Id, amount_total = amount ?? row.Amount,
                currency = row.Currency.ToLowerInvariant(), payment_status = "paid", payment_intent = "pi_" + row.Id, livemode = !row.TestMode } } });
            headers["Stripe-Signature"] = "t=" + timestamp + ",v1=" + Convert.ToHexString(HMACSHA256.HashData(Encoding.UTF8.GetBytes(c.WebhookSecret), Encoding.UTF8.GetBytes(timestamp + "." + body))).ToLowerInvariant();
            return new(body, headers);
        }
        if (row.Channel == "alipay")
        {
            var form = new Dictionary<string, string> { ["app_id"] = c.AppId, ["seller_id"] = c.MerchantId, ["out_trade_no"] = row.Id, ["trade_no"] = "ali_" + row.Id,
                ["total_amount"] = ((amount ?? row.Amount) / 100m).ToString("0.00", CultureInfo.InvariantCulture), ["trade_status"] = "TRADE_SUCCESS" };
            form["sign"] = Sign(platform, Canonical(form)); form["sign_type"] = "RSA2"; return new("", headers, form);
        }
        var clear = JsonSerializer.SerializeToUtf8Bytes(new { appid = c.AppId, mchid = c.MerchantId, out_trade_no = row.Id, transaction_id = "wx_" + row.Id,
            trade_state = "SUCCESS", amount = new { total = amount ?? row.Amount, currency = row.Currency } });
        var cipher = new byte[clear.Length]; var tag = new byte[16];
        using var aes = new AesGcm(Encoding.UTF8.GetBytes(c.ApiV3Key), 16);
        aes.Encrypt("123456789012"u8, clear, cipher, tag, "transaction"u8);
        var message = JsonSerializer.Serialize(new { event_type = "TRANSACTION.SUCCESS", resource = new { algorithm = "AEAD_AES_256_GCM", nonce = "123456789012", associated_data = "transaction", ciphertext = Convert.ToBase64String([.. cipher, .. tag]) } });
        SignedHeaders(headers, message, c, platform); return new(message, headers);
    }
    private static void SignedHeaders(Dictionary<string, string> headers, string body, PaymentChannel c, RSA platform)
    {
        var time = DateTimeOffset.UtcNow.ToUnixTimeSeconds().ToString(CultureInfo.InvariantCulture);
        headers["Wechatpay-Timestamp"] = time; headers["Wechatpay-Nonce"] = "fixture"; headers["Wechatpay-Serial"] = c.PublicKeyId;
        headers["Wechatpay-Signature"] = Sign(platform, time + "\nfixture\n" + body + "\n");
    }
    private static string Secret() => Convert.ToHexString(RandomNumberGenerator.GetBytes(32)).ToLowerInvariant();
    private static string Canonical(IEnumerable<KeyValuePair<string, string>> fields) => string.Join("&", fields.Where(x => x.Value != "").OrderBy(x => x.Key, StringComparer.Ordinal).Select(x => x.Key + "=" + x.Value));
    private static string Sign(RSA rsa, string body) => Convert.ToBase64String(rsa.SignData(Encoding.UTF8.GetBytes(body), HashAlgorithmName.SHA256, RSASignaturePadding.Pkcs1));
    private static void Check(bool passed, string message) { if (!passed) throw new Exception(message); }
    private static async Task Reject<T>(Func<Task<T>> action, int status)
    {
        try { await action(); } catch (CmsException e) when (e.Status == status) { return; }
        throw new Exception("Expected rejection " + status);
    }

    private sealed class GatewayTransport(CmsRepository repo, RSA merchant, RSA platform, Dictionary<string, PaymentChannel> channels) : HttpMessageHandler
    {
        public Dictionary<string, string> States { get; } = [];
        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellation)
        {
            var uri = request.RequestUri!; var body = request.Content == null ? "" : await request.Content.ReadAsStringAsync(cancellation);
            if (uri.Host == "api.stripe.com")
            {
                if (uri.AbsolutePath == "/v1/account") return Json(new { id = channels["stripe"].MerchantId });
                if (uri.AbsolutePath.StartsWith("/v1/payment_intents/")) return Json(new { latest_charge = new { refunded = States.GetValueOrDefault(uri.AbsolutePath.Split('/').Last()[3..]) == "refunded" } });
                string id;
                if (uri.AbsolutePath == "/v1/checkout/sessions")
                {
                    var form = QueryHelpers.ParseQuery(body); id = form["client_reference_id"].ToString();
                    Check(request.Headers.GetValues("Idempotency-Key").Single() == id, "Stripe idempotency header");
                    Check(long.Parse(form["expires_at"].ToString()) > DateTimeOffset.UtcNow.AddMinutes(30).ToUnixTimeSeconds(), "checkout expiry preserves UTC after database roundtrip");
                    await Task.Delay(10, cancellation);
                }
                else id = uri.AbsolutePath.Split('/')[4][3..];
                var row = (await repo.FindAsync<ShopOrder>(id))!;
                if (uri.AbsolutePath.EndsWith("/expire")) States[id] = "closed";
                return Json(new { id = "cs_" + id, url = "https://checkout.stripe.com/pay/" + id, client_reference_id = id, amount_total = row.Amount, currency = row.Currency.ToLowerInvariant(),
                    payment_intent = "pi_" + id, livemode = !row.TestMode, payment_status = States.GetValueOrDefault(id) is "paid" or "refunded" ? "paid" : "unpaid", status = States.GetValueOrDefault(id) == "closed" ? "expired" : "open" });
            }
            if (uri.Host == "openapi.alipay.com")
            {
                var form = QueryHelpers.ParseQuery(body).ToDictionary(x => x.Key, x => x.Value.ToString()); var signature = form["sign"]; form.Remove("sign");
                Check(merchant.VerifyData(Encoding.UTF8.GetBytes(Canonical(form)), Convert.FromBase64String(signature), HashAlgorithmName.SHA256, RSASignaturePadding.Pkcs1), "Alipay API signature");
                using var business = JsonDocument.Parse(form["biz_content"]); var id = business.RootElement.GetProperty("out_trade_no").GetString()!;
                var row = (await repo.FindAsync<ShopOrder>(id))!;
                if (form["method"] == "alipay.trade.close") States[id] = "closed";
                var result = JsonSerializer.Serialize(new { code = "10000", out_trade_no = id, trade_no = "ali_" + id, total_amount = (row.Amount / 100m).ToString("0.00", CultureInfo.InvariantCulture),
                    trade_status = States.GetValueOrDefault(id) switch { "paid" => "TRADE_SUCCESS", "refunded" or "closed" => "TRADE_CLOSED", _ => "WAIT_BUYER_PAY" } });
                return Raw("{\"" + form["method"].Replace('.', '_') + "_response\":" + result + ",\"sign\":\"" + Sign(platform, result) + "\"}");
            }
            Check(uri.Host == "api.mch.weixin.qq.com", "fixed provider hosts");
            var auth = request.Headers.GetValues("Authorization").Single();
            string Attribute(string name) => Regex.Match(auth, name + "=\"([^\"]+)\"").Groups[1].Value;
            Check(merchant.VerifyData(Encoding.UTF8.GetBytes(request.Method.Method + "\n" + uri.PathAndQuery + "\n" + Attribute("timestamp") + "\n" + Attribute("nonce_str") + "\n" + body + "\n"), Convert.FromBase64String(Attribute("signature")), HashAlgorithmName.SHA256, RSASignaturePadding.Pkcs1), "WeChat API signature");
            HttpResponseMessage response;
            if (uri.AbsolutePath.EndsWith("/native")) response = Json(new { code_url = "weixin://wxpay/bizpayurl?pr=fixture" });
            else
            {
                var id = uri.AbsolutePath.Split('/')[5]; var row = (await repo.FindAsync<ShopOrder>(id))!;
                if (uri.AbsolutePath.EndsWith("/close")) { States[id] = "closed"; return new(HttpStatusCode.NoContent); }
                response = Json(new { appid = channels["wechat"].AppId, mchid = channels["wechat"].MerchantId, out_trade_no = id, transaction_id = "wx_" + id,
                    trade_state = States.GetValueOrDefault(id) switch { "paid" => "SUCCESS", "refunded" => "REFUND", "closed" => "CLOSED", _ => "NOTPAY" }, amount = new { total = row.Amount, currency = row.Currency } });
            }
            var headers = new Dictionary<string, string>(); SignedHeaders(headers, await response.Content.ReadAsStringAsync(cancellation), channels["wechat"], platform);
            foreach (var field in headers) response.Headers.Add(field.Key, field.Value);
            return response;
        }
        private static HttpResponseMessage Json(object value) => Raw(JsonSerializer.Serialize(value));
        private static HttpResponseMessage Raw(string value) => new(HttpStatusCode.OK) { Content = new StringContent(value, Encoding.UTF8, "application/json") };
    }
}
