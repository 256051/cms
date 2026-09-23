using Cms.Data;
using Cms.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;

namespace Cms.Api;

/// <summary>Administrator-only digital products, merchant settings and orders.</summary>
[Route("api/v1/admin/commerce")]
[Authorize(AuthenticationSchemes = "cms", Roles = "Admin")]
public sealed class CommerceAdminController(CommerceService commerce, CommerceSettings settings) : ApiController
{
    /// <summary>Read redacted payment configuration.</summary>
    [HttpGet("settings")]
    public async Task<ApiResponse<CommerceSettingsView>> Settings() => Result(await settings.ViewAsync());
    /// <summary>Save encrypted merchant configuration.</summary>
    [HttpPut("settings")]
    public async Task<ApiResponse<CommerceSettingsView>> SaveSettings(CommerceOptions input) => Result(await settings.SaveAsync(Actor, input));
    /// <summary>Read product sale terms.</summary>
    [HttpGet("products/{id}")]
    public async Task<ApiResponse<ShopProductView>> Product(string id) => Result(await commerce.ProductAsync(id));
    /// <summary>Update sale terms without changing previously purchased files or amounts.</summary>
    [HttpPut("products/{id}")]
    public async Task<ApiResponse<ShopProductView>> SaveProduct(string id, ShopProductInput input) => Result(await commerce.SaveProductAsync(Actor, id, input));
    /// <summary>Upload a private digital deliverable.</summary>
    [HttpPost("files")]
    [RequestSizeLimit(55_000_000)]
    public async Task<ApiResponse<ShopFile>> Upload(IFormFile file, CancellationToken cancellation)
    {
        await using var stream = file.OpenReadStream();
        return Result(await commerce.UploadAsync(Actor, file.FileName, stream, cancellation));
    }
    /// <summary>Page transactions without exposing receipt credentials.</summary>
    [HttpGet("orders")]
    public async Task<ApiResponse<PageResult<ShopOrderView>>> Orders(int page = 1, string status = "") => Result(await commerce.OrdersAsync(page, status));
    /// <summary>Reconcile payment/refund state with the gateway.</summary>
    [HttpPost("orders/{id}/refresh")]
    public async Task<ApiResponse<ShopOrderView>> Refresh(string id) => Result(await commerce.RefreshAsync(id, null, true));
    /// <summary>Close an unpaid checkout at the gateway.</summary>
    [HttpPost("orders/{id}/close")]
    public async Task<ApiResponse<ShopOrderView>> Close(string id) => Result(await commerce.CloseAsync(id, null, true));
}

/// <summary>Receipt-authorized public purchases; every write still requires the site's CSRF token.</summary>
[Route("api/v1/shop")]
[EnableRateLimiting("commerce")]
[ResponseCache(NoStore = true, Location = ResponseCacheLocation.None)]
public sealed class ShopController(CommerceService commerce) : ApiController
{
    private string Token => Request.Headers["X-Order-Token"].ToString();
    /// <summary>Read available channels and immutable purchase price.</summary>
    [HttpGet("products/{id}")]
    public async Task<ApiResponse<ShopOffer?>> Product(string id) => Result(await commerce.OfferAsync(id));
    /// <summary>Create a single-item order idempotently.</summary>
    [HttpPost("orders")]
    public async Task<ApiResponse<ShopOrderView>> Create(ShopOrderInput input) => Result(await commerce.CreateAsync(input));
    /// <summary>Read a private order by receipt token.</summary>
    [HttpGet("orders/{id}")]
    public async Task<ApiResponse<ShopOrderView>> Order(string id) => Result(await commerce.OrderAsync(id, Token));
    /// <summary>Obtain the selected gateway's checkout.</summary>
    [HttpPost("orders/{id}/pay")]
    public async Task<ApiResponse<PaymentLink>> Pay(string id) => Result(await commerce.PayAsync(id, Token));
    /// <summary>Refresh payment status from its gateway.</summary>
    [HttpPost("orders/{id}/refresh")]
    public async Task<ApiResponse<ShopOrderView>> Refresh(string id) => Result(await commerce.RefreshAsync(id, Token));
    /// <summary>Cancel an unpaid order after closing its gateway checkout.</summary>
    [HttpPost("orders/{id}/close")]
    public async Task<ApiResponse<ShopOrderView>> Close(string id) => Result(await commerce.CloseAsync(id, Token));
    /// <summary>Stream a private paid attachment with no caching or inline execution.</summary>
    [HttpGet("orders/{id}/download")]
    public async Task<IActionResult> Download(string id)
    {
        var file = await commerce.DownloadAsync(id, Token);
        Response.Headers.CacheControl = "no-store, private";
        Response.Headers["X-Content-Type-Options"] = "nosniff";
        return PhysicalFile(file.Path, file.ContentType, file.Name);
    }
}

/// <summary>Only these server callbacks bypass CSRF; the service verifies their provider signature and order snapshot.</summary>
[Route("api/v1/payments")]
[RequestSizeLimit(65536)]
public sealed class PaymentNotificationController(CommerceService commerce) : ControllerBase
{
    /// <summary>Accept an authenticated provider notification and return the provider-required acknowledgement.</summary>
    [HttpPost("{channel}/notify")]
    public async Task<IActionResult> Notify(string channel)
    {
        Dictionary<string, string>? fields = null;
        var body = "";
        if (channel == "alipay")
        {
            if (!Request.HasFormContentType) return BadRequest();
            var form = await Request.ReadFormAsync();
            if (form.Any(x => x.Value.Count != 1)) return BadRequest();
            fields = form.ToDictionary(x => x.Key, x => x.Value.ToString(), StringComparer.Ordinal);
        }
        else body = await new StreamReader(Request.Body).ReadToEndAsync(HttpContext.RequestAborted);
        await commerce.NotifyAsync(channel, body, Request.Headers.ToDictionary(x => x.Key, x => x.Value.ToString(), StringComparer.OrdinalIgnoreCase), fields);
        return channel == "alipay" ? Content("success", "text/plain") : Ok(new { code = "SUCCESS" });
    }
}
