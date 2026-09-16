using Cms.Data;
using Cms.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace Cms.Api;

/// <summary>Administrator-only notification setup status and delivery history.</summary>
[Route("api/v1/admin/notifications")]
[Authorize(AuthenticationSchemes = "cms", Roles = "Admin")]
public sealed class NotificationController(NotificationService notifications) : ApiController
{
    /// <summary>Read redacted deployment configuration status.</summary>
    [HttpGet("settings")]
    public ApiResponse<NotificationSettings> Settings() => Result(notifications.Settings());
    /// <summary>Read delivery outcomes.</summary>
    [HttpGet]
    public async Task<ApiResponse<PageResult<NotificationDelivery>>> List(int page = 1) => Result(await notifications.ListAsync(page));
    /// <summary>Requeue one failed event without sending successful events again.</summary>
    [HttpPost("{id}/retry")]
    public async Task<ApiResponse<bool>> Retry(string id) => Result(await notifications.RetryAsync(Actor, id));
}
