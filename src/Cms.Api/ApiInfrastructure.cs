using System.Globalization;
using System.Security.Claims;
using Cms.Data;
using FluentValidation;
using Microsoft.AspNetCore.Antiforgery;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Filters;

namespace Cms.Api;

/// <summary>Consistent HTTP response envelope.</summary>
public record ApiResponse<T>(string Code, string Message, T? Data, string TraceId);

/// <summary>Common HTTP serialization and identity helpers only.</summary>
[ApiController]
public abstract class ApiController : ControllerBase
{
    /// <summary>Authenticated actor identifier.</summary>
    protected string Actor => User.FindFirstValue(ClaimTypes.NameIdentifier)!;

    /// <summary>Wrap a successful service result.</summary>
    protected ApiResponse<T> Result<T>(T data)
    {
        return new ApiResponse<T>("OK", "", data, HttpContext.TraceIdentifier);
    }
}

/// <summary>Validate CSRF tokens on every unsafe controller action including login and comments.</summary>
public sealed class CsrfFilter(IAntiforgery antiforgery) : IAsyncActionFilter
{
    /// <summary>Validate before invoking the endpoint.</summary>
    public async Task OnActionExecutionAsync(ActionExecutingContext context, ActionExecutionDelegate next)
    {
        var machine = context.Controller is IntegrationController && context.HttpContext.User.Identities.Any(x =>
            x.IsAuthenticated && x.AuthenticationType == IntegrationAuthenticationHandler.SchemeName);
        if (!machine && context.HttpContext.Request.Method is not ("GET" or "HEAD" or "OPTIONS"))
            await antiforgery.ValidateRequestAsync(context.HttpContext);
        await next();
    }
}

/// <summary>Translate known failures without leaking database or filesystem details.</summary>
public sealed class ExceptionMiddleware(RequestDelegate next, ILogger<ExceptionMiddleware> logger)
{
    /// <summary>Run the downstream pipeline with safe failure serialization.</summary>
    public async Task InvokeAsync(HttpContext context)
    {
        try
        {
            await next(context);
        }
        catch (Exception exception)
        {
            if (context.Response.HasStarted) throw;
            var (status, code, message) = exception switch
            {
                CmsException e => (e.Status, e.Code, e.Message),
                ValidationException e => (400, "VALIDATION_ERROR",
                    string.Join("；", e.Errors.Select(x => x.ErrorMessage))),
                AntiforgeryValidationException => (400, "CSRF_INVALID", "页面验证已失效，请刷新后重试。"),
                BadHttpRequestException e => (e.StatusCode, "INVALID_REQUEST", "请求格式或大小无效。"),
                _ => (500, "INTERNAL_ERROR", "操作失败，请根据追踪编号联系管理员。")
            };
            if (status == 500) logger.LogError(exception, "Request failed. Trace: {Trace}", context.TraceIdentifier);
            context.Response.StatusCode = status;
            if (exception is CmsException { RetryAfterSeconds: { } retry })
                context.Response.Headers.RetryAfter = retry.ToString(CultureInfo.InvariantCulture);
            await context.Response.WriteAsJsonAsync(new ApiResponse<object>(code, message, null,
                context.TraceIdentifier));
        }
    }
}