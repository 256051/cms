using System.Net.Mail;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using Cms.Data;
using Microsoft.Extensions.Configuration;

namespace Cms.Services;

/// <summary>Versioned digital sale terms; prices are integer minor units.</summary>
public record ShopProductInput(bool Enabled, long Price, string Currency, string FileId, int Version);
/// <summary>Safe sale information without a storage path.</summary>
public record ShopProductView(string ProductId, bool Enabled, long Price, string Currency, string FileId, string FileName, long FileSize, int Version);
/// <summary>Publicly selectable configured channel.</summary>
public record PaymentChoice(string Id, bool TestMode);
/// <summary>Public product checkout availability.</summary>
public record ShopOffer(bool Enabled, long Price, string Currency, string FileName, int Version, PaymentChoice[] Channels);
/// <summary>Browser request; the server determines the title, price, currency and file.</summary>
public record ShopOrderInput(string ProductId, string Channel, string Email, string ReceiptToken, int ProductVersion);
/// <summary>Owner/admin-safe order details; receipt secrets and storage paths never appear here.</summary>
public record ShopOrderView(string Id, string ProductId, string Title, long Amount, string Currency, string Channel, string Status,
    string Email, bool TestMode, DateTime CreatedAt, DateTime? PaidAt, DateTime ExpiresAt, bool CanDownload, string FileName);

/// <summary>Audited single-item digital sales, provider reconciliation and private delivery.</summary>
public sealed class CommerceService(CmsRepository repository, CommerceSettings settings, PaymentGateway gateway, IConfiguration config)
{
    // ponytail: serialize checkout creation/closure in this single API process; use distributed order locks before scaling out.
    private static readonly SemaphoreSlim Checkouts = new(1, 1);
    private readonly string uploads = Path.GetFullPath(config["Storage:Path"] ?? "data/uploads");
    internal static string FileName(string id) => Regex.IsMatch(id, "^[a-f0-9]{32}$") ? "shop-" + id + ".bin" : throw Missing();
    private static CmsException Missing() => new(404, "NOT_FOUND", "商品、订单或凭证无效。");
    private static CmsException Bad(string text, int status = 400) => CommerceSettings.Bad(text, status);

    /// <summary>Read sale terms for an existing product without exposing private bytes.</summary>
    public async Task<ShopProductView> ProductAsync(string id)
    {
        if (await repository.FirstAsync<Content>(x => x.Id == id && x.Kind == "product" && x.DeletedAt == null) == null) throw Missing();
        var row = await repository.FindAsync<ShopProduct>(id) ?? new() { Id = id };
        var file = await repository.FindAsync<ShopFile>(row.FileId);
        return new(id, row.Enabled, row.Price, row.Currency, row.FileId, file?.Name ?? "", file?.Size ?? 0, row.Version);
    }

    /// <summary>Save a price and immutable deliverable reference, preserving files already sold.</summary>
    public async Task<ShopProductView> SaveProductAsync(string actor, string id, ShopProductInput input)
    {
        if (input.Currency is not ("CNY" or "USD" or "EUR" or "HKD" or "GBP") || input.Price is < 1 or > 100_000_000 || input.FileId == null)
            throw Bad("价格须为 0.01–1,000,000.00，币种请选择人民币、美元、欧元、港币或英镑。");
        await repository.WriteAsync(actor, "commerce.product", async repo =>
        {
            var product = await repo.FirstAsync<Content>(x => x.Id == id && x.Kind == "product" && x.DeletedAt == null) ?? throw Missing();
            var row = await repo.FindAsync<ShopProduct>(id); var fresh = row == null;
            if ((row?.Version ?? 0) != input.Version) throw Bad("商品售价或交付文件已被修改，请刷新后重试。", 409);
            if ((input.Enabled || input.FileId != "") && await repo.FindAsync<ShopFile>(input.FileId) == null) throw Bad("请先上传付费交付文件。");
            row ??= new() { Id = id }; row.Version++; row.Enabled = input.Enabled; row.Price = input.Price;
            row.Currency = input.Currency; row.FileId = input.FileId;
            repo.SetAuditTarget("product", id, product.Title);
            if (fresh) await repo.InsertAsync(row); else await repo.UpdateAsync(row);
            return true;
        });
        return await ProductAsync(id);
    }

    /// <summary>Upload a bounded private delivery file; it is never an editorial Asset or public media URL.</summary>
    public async Task<ShopFile> UploadAsync(string actor, string name, Stream input, CancellationToken cancellation)
    {
        if (string.IsNullOrWhiteSpace(name) || name.Length > 200 || name != Path.GetFileName(name) || name.Any(c => char.IsControl(c) || c is '/' or '\\' or ':')) throw Bad("文件名无效。");
        var file = new ShopFile { Name = name };
        Directory.CreateDirectory(uploads);
        var path = Path.Combine(uploads, FileName(file.Id));
        try
        {
            using var hash = IncrementalHash.CreateHash(HashAlgorithmName.SHA256);
            await using (var output = new FileStream(path, FileMode.CreateNew, FileAccess.Write, FileShare.None, 81920, true))
            {
                var buffer = new byte[81920]; int read;
                while ((read = await input.ReadAsync(buffer, cancellation)) > 0)
                {
                    file.Size += read;
                    if (file.Size > 52_428_800) throw Bad("交付文件不能超过 50 MB。", 413);
                    hash.AppendData(buffer, 0, read); await output.WriteAsync(buffer.AsMemory(0, read), cancellation);
                }
            }
            if (file.Size == 0) throw Bad("不能上传空文件。");
            file.Sha256 = Convert.ToHexString(hash.GetHashAndReset());
            await repository.WriteAsync(actor, "commerce.upload", async repo =>
            { repo.SetAuditTarget("commerce-file", file.Id, name); return await repo.InsertAsync(file); });
            return file;
        }
        catch { File.Delete(path); throw; }
    }

    /// <summary>Offer only published, available products and fully configured matching-currency channels.</summary>
    public async Task<ShopOffer?> OfferAsync(string id)
    {
        var content = await repository.FirstAsync<Content>(x => x.Id == id && x.Kind == "product" && x.Published && x.DeletedAt == null);
        var product = await repository.FindAsync<ShopProduct>(id);
        if (content == null || product == null || !product.Enabled) return null;
        var file = await repository.FindAsync<ShopFile>(product.FileId);
        if (file == null) return null;
        var options = await settings.LoadAsync();
        return new(true, product.Price, product.Currency, file.Name, product.Version, options.Channels!.Where(x =>
            x.Value.Enabled && (product.Currency == "CNY" || x.Key == "stripe") && CommerceSettings.Error(x.Key, x.Value, options.SiteUrl) == "")
            .Select(x => new PaymentChoice(x.Key, x.Value.TestMode)).ToArray());
    }

    /// <summary>Create or safely replay a one-item purchase; a receipt token doubles as its idempotency secret.</summary>
    public async Task<ShopOrderView> CreateAsync(ShopOrderInput input)
    {
        var hash = TokenHash(input.ReceiptToken);
        if (!CommerceSettings.Channels.Contains(input.Channel) || input.Email is not { Length: > 0 and <= 254 } ||
            !MailAddress.TryCreate(input.Email, out var email) || email.Address != input.Email || input.ProductId is not { Length: 32 }) throw Bad("请检查商品、支付方式和邮箱地址。");
        var options = await settings.LoadAsync(); var channel = options.Channels![input.Channel];
        if (!channel.Enabled || CommerceSettings.Error(input.Channel, channel, options.SiteUrl) != "") throw Bad("此支付渠道尚未开通，请选择其他方式。", 409);
        var row = await repository.WriteAsync("visitor", "commerce.order", async repo =>
        {
            var previous = await repo.FirstAsync<ShopOrder>(x => x.TokenHash == hash);
            if (previous != null)
            {
                if (previous.ProductId != input.ProductId || previous.Channel != input.Channel || previous.Email != input.Email) throw Bad("订单凭证已用于其他购买，请重新发起。", 409);
                repo.SetAuditTarget("order", previous.Id, previous.Title); return previous;
            }
            var product = await repo.FindAsync<ShopProduct>(input.ProductId) ?? throw Missing();
            var content = await repo.FirstAsync<Content>(x => x.Id == input.ProductId && x.Kind == "product" && x.Published && x.DeletedAt == null) ?? throw Missing();
            if (!product.Enabled || product.Version != input.ProductVersion) throw Bad("商品已下架或价格已更新，请刷新后购买。", 409);
            if (product.Currency != "CNY" && input.Channel != "stripe") throw Bad("支付宝和微信支付仅支持人民币商品。");
            if (await repo.FindAsync<ShopFile>(product.FileId) == null || !File.Exists(Path.Combine(uploads, FileName(product.FileId)))) throw Bad("商品交付文件暂不可用，请联系商家。", 409);
            var order = new ShopOrder { ProductId = product.Id, Title = content.PublishedTitle, Amount = product.Price, Currency = product.Currency,
                FileId = product.FileId, Channel = input.Channel, Email = input.Email, TokenHash = hash, TestMode = channel.TestMode,
                AccountHash = CommerceSettings.AccountHash(input.Channel, channel), ExpiresAt = DateTime.UtcNow.AddHours(1) };
            order.PaymentIdentity = "pending:" + order.Id;
            repo.SetAuditTarget("order", order.Id, order.Title); await repo.InsertAsync(order); return order;
        });
        return await ViewAsync(row);
    }

    /// <summary>Read an order only with its receipt credential.</summary>
    public async Task<ShopOrderView> OrderAsync(string id, string token) => await ViewAsync(await OwnedAsync(id, token));
    /// <summary>Page commerce orders for administrators without any bearer secrets.</summary>
    public async Task<PageResult<ShopOrderView>> OrdersAsync(int page, string status = "")
    {
        if (status is not ("" or "pending" or "paid" or "closed" or "refunded")) throw Bad("订单状态无效。");
        var rows = await repository.PageAsync<ShopOrder>(x => status == "" || x.Status == status, page, 20);
        var views = new List<ShopOrderView>(); foreach (var row in rows.Items) views.Add(await ViewAsync(row));
        return new(views, rows.Total, rows.Page, rows.PageSize);
    }

    /// <summary>Start/retry payment for an authorized order; provider idempotency prevents duplicate checkouts.</summary>
    public Task<PaymentLink> PayAsync(string id, string token) => Checkout(async () =>
    {
        var row = await OwnedAsync(id, token);
        if (row.Status != "pending" || row.ExpiresAt <= DateTime.UtcNow) throw Bad("订单已付款、关闭或已过期，请刷新订单状态。", 409);
        var options = await AccountAsync(row);
        if (!options.Channels![row.Channel].Enabled) throw Bad("此支付方式已暂停，请联系商家。", 409);
        if (row.PaymentUrl != "") return new(row.ProviderReference, row.PaymentUrl);
        if (row.Channel == "stripe" && row.ExpiresAt < DateTime.UtcNow.AddMinutes(31))
            throw Bad("此订单剩余付款时间不足，请关闭订单后重新购买。", 409);
        var link = await Remote(() => gateway.CreateAsync(row, options));
        await repository.WriteAsync("visitor", "commerce.checkout", async repo =>
        {
            var current = await repo.FindAsync<ShopOrder>(id) ?? throw Missing();
            repo.SetAuditTarget("order", id, current.Title);
            current.ProviderReference = link.Reference; current.PaymentUrl = link.Url;
            await repo.UpdateAsync(current); return true;
        });
        return link;
    });

    /// <summary>Query the payment platform for the buyer or an authenticated administrator.</summary>
    public async Task<ShopOrderView> RefreshAsync(string id, string? token, bool administrator = false)
    {
        var row = administrator ? await repository.FindAsync<ShopOrder>(id) ?? throw Missing() : await OwnedAsync(id, token ?? "");
        var options = await AccountAsync(row);
        var result = await Remote(() => gateway.QueryAsync(row, options));
        if (result.OrderId != row.Id) throw Bad("支付平台返回的订单编号不匹配。", 409);
        await ApplyAsync(row.Channel, options.Channels![row.Channel], result);
        return await ViewAsync((await repository.FindAsync<ShopOrder>(id))!);
    }

    /// <summary>Close an unpaid remote order before closing it locally; a paid order cannot be silently discarded.</summary>
    public Task<ShopOrderView> CloseAsync(string id, string? token, bool administrator = false) => Checkout(async () =>
    {
        var row = administrator ? await repository.FindAsync<ShopOrder>(id) ?? throw Missing() : await OwnedAsync(id, token ?? "");
        if (row.Status != "pending") throw Bad("仅待付款订单可以关闭。", 409);
        var options = await AccountAsync(row);
        if (row.ProviderReference != "") await Remote(async () => { await gateway.CloseAsync(row, options); return true; });
        await repository.WriteAsync(administrator ? "operator" : "visitor", "commerce.close", async repo =>
        {
            var current = await repo.FindAsync<ShopOrder>(id) ?? throw Missing(); repo.SetAuditTarget("order", id, current.Title);
            if (current.Status == "pending") { current.Status = "closed"; await repo.UpdateAsync(current); }
            return true;
        });
        return await ViewAsync((await repository.FindAsync<ShopOrder>(id))!);
    });

    /// <summary>Verify the gateway notification before performing an idempotent audited transition.</summary>
    public async Task NotifyAsync(string channel, string body, IReadOnlyDictionary<string, string> headers, IReadOnlyDictionary<string, string>? form)
    {
        if (!CommerceSettings.Channels.Contains(channel)) throw Missing();
        var options = await settings.LoadAsync(); var c = options.Channels![channel];
        if (CommerceSettings.Error(channel, c, options.SiteUrl) != "") throw Bad("支付通知渠道未配置。", 503);
        var result = gateway.Notification(channel, c, body, headers, form);
        if (result != null) await ApplyAsync(channel, c, result);
    }

    private Task<bool> ApplyAsync(string channel, PaymentChannel account, PaymentResult result) => repository.WriteAsync("payment", "commerce.reconcile", async repo =>
    {
        var row = await repo.FindAsync<ShopOrder>(result.OrderId) ?? throw Missing(); repo.SetAuditTarget("order", row.Id, row.Title);
        if (row.Channel != channel || row.TestMode != result.TestMode || row.AccountHash != CommerceSettings.AccountHash(channel, account) ||
            row.Amount != result.Amount || row.Currency != result.Currency) throw Bad("支付订单、收款账户、金额或币种不匹配。", 409);
        if (channel == "stripe" && (result.CheckoutReference != "" || row.ProviderReference != "" || result.State != "pending"))
        {
            if (!result.CheckoutReference.StartsWith("cs_", StringComparison.Ordinal) || result.CheckoutReference.Length > 200 ||
                row.ProviderReference != "" && row.ProviderReference != result.CheckoutReference)
                throw Bad("支付结账会话不匹配。", 409);
            row.ProviderReference = result.CheckoutReference;
        }
        if (result.State is "paid" or "refunded")
        {
            if (string.IsNullOrEmpty(result.Transaction) || result.Transaction.Length > 180) throw Bad("支付流水号无效。");
            var identity = channel + ":" + result.Transaction;
            if (await repo.FirstAsync<ShopOrder>(x => x.PaymentIdentity == identity && x.Id != row.Id) != null ||
                !row.PaymentIdentity.StartsWith("pending:", StringComparison.Ordinal) && row.PaymentIdentity != identity) throw Bad("支付流水号已用于其他订单。", 409);
            row.PaymentIdentity = identity;
            // A late paid notification must never undo a confirmed refund.
            if (row.Status != "refunded") row.Status = result.State;
            row.PaidAt ??= DateTime.UtcNow;
        }
        else if (result.State == "closed") row.Status = row.Status == "paid" ? "refunded" : row.Status == "refunded" ? "refunded" : "closed";
        await repo.UpdateAsync(row); return true;
    });

    /// <summary>Open only the paid production order's frozen deliverable; caller emits a private attachment response.</summary>
    public async Task<FileView> DownloadAsync(string id, string token)
    {
        var order = await OwnedAsync(id, token);
        if (order.Status != "paid" || order.TestMode) throw Bad(order.TestMode ? "测试订单不会开放正式文件下载。" : "付款确认后才能下载；已退款订单不可下载。", 403);
        // Recheck external refunds even if the merchant dashboard did not send a refund callback.
        var current = await RefreshAsync(id, token);
        if (!current.CanDownload) throw Bad("此订单的下载权限已关闭。", 403);
        var file = await repository.FindAsync<ShopFile>(order.FileId) ?? throw Missing();
        var path = Path.Combine(uploads, FileName(file.Id));
        if (!File.Exists(path)) throw Bad("交付文件暂不可用，请联系商家。", 503);
        return new(path, "application/octet-stream", file.Name);
    }

    private async Task<ShopOrder> OwnedAsync(string id, string token)
    {
        var hash = TokenHash(token); var row = await repository.FindAsync<ShopOrder>(id);
        if (row == null || !CryptographicOperations.FixedTimeEquals(Encoding.ASCII.GetBytes(row.TokenHash), Encoding.ASCII.GetBytes(hash))) throw Missing();
        return row;
    }
    private static string TokenHash(string token) => token != null && Regex.IsMatch(token, "^[a-f0-9]{64}$")
        ? Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(token))) : throw Missing();
    private async Task<CommerceOptions> AccountAsync(ShopOrder order)
    {
        var options = await settings.LoadAsync(); var channel = options.Channels![order.Channel];
        if (CommerceSettings.Error(order.Channel, channel, options.SiteUrl) != "" || order.AccountHash != CommerceSettings.AccountHash(order.Channel, channel))
            throw Bad("此订单对应的支付账户配置已变更，请联系商家恢复原账户后核对。", 409);
        return options;
    }
    private async Task<ShopOrderView> ViewAsync(ShopOrder row) => new(row.Id, row.ProductId, row.Title, row.Amount, row.Currency,
        row.Channel, row.Status, row.Email, row.TestMode, DateTime.SpecifyKind(row.CreatedAt, DateTimeKind.Utc),
        row.PaidAt is { } paid ? DateTime.SpecifyKind(paid, DateTimeKind.Utc) : null, DateTime.SpecifyKind(row.ExpiresAt, DateTimeKind.Utc), row.Status == "paid" && !row.TestMode,
        (await repository.FindAsync<ShopFile>(row.FileId))?.Name ?? "");
    private static async Task<T> Checkout<T>(Func<Task<T>> work)
    {
        await Checkouts.WaitAsync();
        try { return await work(); } finally { Checkouts.Release(); }
    }
    private static async Task<T> Remote<T>(Func<Task<T>> work)
    {
        try { return await work(); }
        catch (Exception e) when (e is HttpRequestException or TaskCanceledException or System.Text.Json.JsonException or InvalidOperationException or KeyNotFoundException)
        { throw Bad("支付平台暂时不可用，请稍后核对订单状态；请勿重复付款。", 502); }
    }
}
