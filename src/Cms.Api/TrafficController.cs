using System.Globalization;
using System.Security.Cryptography;
using Cms.Data;
using Cms.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;

namespace Cms.Api;

/// <summary>Server-authenticated first-party browser identity with a bounded lifetime.</summary>
public sealed class VisitorIdentity(IDataProtectionProvider protection, IWebHostEnvironment environment)
{
    /// <summary>Read or issue a private anonymous cookie; never use forwarded IPs as identities.</summary>
    public string Get(HttpContext context)
    {
        const string name = "cms.visitor";
        var protector = protection.CreateProtector("cms.visitor.v1");
        if (context.Request.Cookies.TryGetValue(name, out var cookie))
        {
            try
            {
                var parts = protector.Unprotect(cookie).Split('|');
                if (parts.Length == 2 && Guid.TryParseExact(parts[0], "N", out _) &&
                    long.TryParse(parts[1], out var expires) && expires > DateTime.UtcNow.Ticks) return parts[0];
            }
            catch (CryptographicException) { }
        }
        var id = Guid.NewGuid().ToString("N");
        var expiry = DateTimeOffset.UtcNow.AddDays(180);
        context.Response.Cookies.Append(name, protector.Protect(id + "|" + expiry.UtcTicks.ToString(CultureInfo.InvariantCulture)),
            new CookieOptions { HttpOnly = true, Secure = !environment.IsDevelopment() || context.Request.IsHttps,
                SameSite = SameSiteMode.Lax, Expires = expiry, Path = "/" });
        return id;
    }
}

/// <summary>CSRF-protected anonymous page observations and private inquiry submission.</summary>
[Route("api/v1/public")]
[RequestSizeLimit(131072)]
public sealed class PublicTrafficController(TrafficService traffic, VisitorIdentity identity) : ApiController
{
    /// <summary>Read additional inquiry field definitions without any customer data.</summary>
    [HttpGet("inquiry-form")]
    public async Task<ApiResponse<InquiryFormView>> InquiryForm() => Result(await traffic.InquiryFormAsync());
    /// <summary>Accept one visible public page navigation.</summary>
    [HttpPost("visits")]
    [EnableRateLimiting("traffic")]
    public async Task<ApiResponse<PageVisitReceipt>> Visit(VisitInput input) => Result(await traffic.VisitAsync(
        identity.Get(HttpContext), input, Request.Headers.UserAgent.ToString(), Request.Host.Host,
        User.Identity?.IsAuthenticated == true, HttpContext.Connection.RemoteIpAddress));

    /// <summary>Update cumulative reading observations without incrementing page views.</summary>
    [HttpPost("visits/{id}/reading")]
    [EnableRateLimiting("traffic")]
    public async Task<ApiResponse<bool>> Reading(string id, ReadingInput input) =>
        Result(await traffic.ReadingAsync(identity.Get(HttpContext), id, input));

    /// <summary>Accept one user-initiated download or consultation click.</summary>
    [HttpPost("visits/{id}/events")]
    [EnableRateLimiting("traffic")]
    public async Task<ApiResponse<bool>> Event(string id, VisitEventInput input) =>
        Result(await traffic.EventAsync(identity.Get(HttpContext), id, input));

    /// <summary>Submit customer information privately and return only a receipt.</summary>
    [HttpPost("leads")]
    [EnableRateLimiting("leads")]
    public async Task<ApiResponse<VisitReceipt>> Lead(LeadInput input) =>
        Result(await traffic.SubmitLeadAsync(identity.Get(HttpContext), input, Request.Host.Host));
}

/// <summary>Administrator-only traffic reports and customer contact management.</summary>
[Route("api/v1/admin")]
[Authorize(Roles = "Admin")]
public sealed class TrafficController(TrafficService traffic) : ApiController
{
    /// <summary>Read current inquiry configuration.</summary>
    [HttpGet("inquiry-form")]
    public async Task<ApiResponse<InquiryFormView>> InquiryForm() => Result(await traffic.InquiryFormAsync());
    /// <summary>Save a validated form definition at an expected revision.</summary>
    [HttpPut("inquiry-form")]
    public async Task<ApiResponse<InquiryFormView>> SaveInquiryForm(InquiryFormView input) => Result(await traffic.SaveInquiryFormAsync(Actor, input));
    /// <summary>Aggregate public traffic and customer inquiries over a bounded date range.</summary>
    [HttpGet("traffic")]
    public async Task<ApiResponse<TrafficReport>> Report(string? from = null, string? to = null) =>
        Result(await traffic.ReportAsync(from, to));

    /// <summary>Page pseudonymous browser profiles.</summary>
    [HttpGet("visitors")]
    public async Task<ApiResponse<PageResult<VisitorProfile>>> Visitors(int page = 1) => Result(await traffic.VisitorsAsync(page));

    /// <summary>Page a browser's accepted public navigation history.</summary>
    [HttpGet("visitors/{id}/visits")]
    public async Task<ApiResponse<PageResult<PageVisit>>> History(string id, int page = 1) => Result(await traffic.VisitorHistoryAsync(id, page));

    /// <summary>Page private customer inquiries.</summary>
    [HttpGet("leads")]
    public async Task<ApiResponse<PageResult<CustomerLead>>> Leads(string status = "", string q = "", int page = 1, string owner = "", bool overdue = false) =>
        Result(await traffic.LeadsAsync(status, q, page, owner, overdue));

    /// <summary>Read append-only contact history.</summary>
    [HttpGet("leads/{id}/followups")]
    public async Task<ApiResponse<PageResult<LeadFollowUp>>> FollowUps(string id, int page = 1) => Result(await traffic.FollowUpsAsync(id, page));

    /// <summary>Read the overdue contact reminder count.</summary>
    [HttpGet("leads/overdue-count")]
    public async Task<ApiResponse<long>> OverdueCount() => Result(await traffic.OverdueLeadsAsync());

    /// <summary>Download a private filtered CSV export.</summary>
    [HttpGet("leads/export")]
    public async Task<FileContentResult> Export(string status = "", string q = "", string owner = "", bool overdue = false) =>
        File(await traffic.ExportLeadsAsync(status, q, owner, overdue), "text/csv; charset=utf-8", "客户咨询.csv");

    /// <summary>Save follow-up state and notes at an expected revision.</summary>
    [HttpPut("leads/{id}")]
    public async Task<ApiResponse<CustomerLead>> Update(string id, LeadUpdateInput input) => Result(await traffic.UpdateLeadAsync(Actor, id, input));

    /// <summary>Delete private contact data at an expected revision.</summary>
    [HttpDelete("leads/{id}")]
    public async Task<ApiResponse<bool>> Delete(string id, int version) => Result(await traffic.DeleteLeadAsync(Actor, id, version));
}
