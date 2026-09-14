using System.Security.Claims;
using System.Threading.RateLimiting;
using Autofac;
using Autofac.Extensions.DependencyInjection;
using MapsterMapper;
using Cms.Api;
using Cms.Data;
using Cms.Services;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.HttpOverrides;

var builder = WebApplication.CreateBuilder(new WebApplicationOptions { Args = args.Where(x => x is not ("--initialize" or "--migrate")).ToArray(), ContentRootPath = AppContext.BaseDirectory });
await Configuration.AddConsulAsync(builder.Configuration);
builder.Host.UseServiceProviderFactory(new AutofacServiceProviderFactory());
builder.Host.ConfigureContainer<ContainerBuilder>(container =>
{
    container.Register(_ => Configuration.Database(builder.Configuration)).As<IFreeSql>().SingleInstance();
    container.RegisterType<CmsRepository>().InstancePerLifetimeScope();
    container.RegisterType<ContentValidator>().SingleInstance();
    container.RegisterType<ContentService>().InstancePerLifetimeScope();
    container.RegisterType<AuthService>().InstancePerLifetimeScope();
    container.RegisterType<SiteService>().InstancePerLifetimeScope();
    container.RegisterType<SettingsValidator>().SingleInstance();
    container.RegisterType<ThemeOptionsValidator>().SingleInstance();
    container.RegisterType<ThemeService>().InstancePerLifetimeScope();
    container.RegisterType<AssetService>().InstancePerLifetimeScope();
});
builder.Services.AddSingleton<IMapper>(new Mapper(MappingConfiguration.Create()));
var keys = Path.GetFullPath(builder.Configuration["Security:KeyPath"] ?? "data/keys");
Directory.CreateDirectory(keys);
builder.Services.AddDataProtection().SetApplicationName("Cms").PersistKeysToFileSystem(new DirectoryInfo(keys));
builder.Services.AddAntiforgery(options => { options.HeaderName = "X-CSRF-TOKEN"; options.Cookie.Name = "cms.csrf"; options.Cookie.SameSite = SameSiteMode.Strict; options.Cookie.SecurePolicy = builder.Environment.IsDevelopment() ? CookieSecurePolicy.SameAsRequest : CookieSecurePolicy.Always; });
builder.Services.AddAuthentication("cms").AddCookie("cms", options =>
{
    options.Cookie.Name = "cms.session"; options.Cookie.HttpOnly = true; options.Cookie.SameSite = SameSiteMode.Strict;
    options.Cookie.SecurePolicy = builder.Environment.IsDevelopment() ? CookieSecurePolicy.SameAsRequest : CookieSecurePolicy.Always;
    options.ExpireTimeSpan = TimeSpan.FromHours(8); options.SlidingExpiration = false;
    options.Events.OnRedirectToLogin = ctx => Denied(ctx.HttpContext, 401, "UNAUTHENTICATED", "请先登录。");
    options.Events.OnRedirectToAccessDenied = ctx => Denied(ctx.HttpContext, 403, "FORBIDDEN", "没有执行此操作的权限。");
    options.Events.OnValidatePrincipal = async ctx =>
    {
        var id = ctx.Principal?.FindFirstValue(ClaimTypes.NameIdentifier);
        var user = id == null ? null : await ctx.HttpContext.RequestServices.GetRequiredService<AuthService>().FindAsync(id);
        if (user is not { Enabled: true } || user.SecurityStamp != ctx.Principal?.FindFirstValue("stamp")) { ctx.RejectPrincipal(); await ctx.HttpContext.SignOutAsync("cms"); }
    };
});
builder.Services.AddAuthorization();
builder.Services.AddSingleton(TimeProvider.System);
builder.Services.AddSingleton<LoginProtection>();
builder.Services.Configure<ForwardedHeadersOptions>(options =>
{
    options.ForwardedHeaders = ForwardedHeaders.XForwardedFor | ForwardedHeaders.XForwardedProto;
    foreach (var network in builder.Configuration.GetSection("ForwardedHeaders:KnownNetworks").Get<string[]>() ?? [])
        options.KnownIPNetworks.Add(System.Net.IPNetwork.Parse(network));
});
builder.Services.AddControllers(options => options.Filters.Add<CsrfFilter>())
    .AddJsonOptions(options => { options.JsonSerializerOptions.NumberHandling = System.Text.Json.Serialization.JsonNumberHandling.Strict; options.JsonSerializerOptions.Converters.Add(new UtcDateTimeConverter()); })
    .ConfigureApiBehaviorOptions(options => options.InvalidModelStateResponseFactory = ctx => new BadRequestObjectResult(new ApiResponse<object>("VALIDATION_ERROR", "请求字段无效，请检查必填项与数据类型。", null, ctx.HttpContext.TraceIdentifier)));
builder.Services.AddOpenApi();
builder.Services.ConfigureHttpJsonOptions(options => options.SerializerOptions.NumberHandling = System.Text.Json.Serialization.JsonNumberHandling.Strict);
builder.Services.AddRateLimiter(options =>
{
    options.AddPolicy("login", ctx => RateLimitPartition.GetSlidingWindowLimiter(ctx.Connection.RemoteIpAddress?.MapToIPv6().ToString() ?? "unknown", _ => new SlidingWindowRateLimiterOptions { PermitLimit = 10, Window = TimeSpan.FromMinutes(1), SegmentsPerWindow = 6, QueueLimit = 0 }));
    options.AddPolicy("captcha", ctx => RateLimitPartition.GetSlidingWindowLimiter(ctx.Connection.RemoteIpAddress?.MapToIPv6().ToString() ?? "unknown", _ => new SlidingWindowRateLimiterOptions { PermitLimit = 30, Window = TimeSpan.FromMinutes(1), SegmentsPerWindow = 6, QueueLimit = 0 }));
    options.AddPolicy("comments", ctx => RateLimitPartition.GetFixedWindowLimiter(ctx.Connection.RemoteIpAddress?.ToString() ?? "unknown", _ => new FixedWindowRateLimiterOptions { PermitLimit = 5, Window = TimeSpan.FromMinutes(1), QueueLimit = 0 }));
    options.OnRejected = async (ctx, ct) => { ctx.HttpContext.Response.StatusCode = 429; ctx.HttpContext.Response.Headers.RetryAfter = ctx.Lease.TryGetMetadata(MetadataName.RetryAfter, out var delay) ? Math.Ceiling(delay.TotalSeconds).ToString(System.Globalization.CultureInfo.InvariantCulture) : "60"; await ctx.HttpContext.Response.WriteAsJsonAsync(new ApiResponse<object>("RATE_LIMITED", "操作过于频繁，请稍后重试。", null, ctx.HttpContext.TraceIdentifier), ct); };
});
builder.Services.Configure<Microsoft.AspNetCore.Http.Features.FormOptions>(x => x.MultipartBodyLengthLimit = 55_000_000);
var app = builder.Build();
if (args.Contains("--initialize") || args.Contains("--migrate"))
{
    using var scope = app.Services.CreateScope();
    var repo = scope.ServiceProvider.GetRequiredService<CmsRepository>();
    await repo.InitializeSchemaAsync();
    if (args.Contains("--initialize")) await scope.ServiceProvider.GetRequiredService<AuthService>().InitializeAsync(builder.Configuration["Setup:Username"] ?? "", builder.Configuration["Setup:Password"] ?? "");
    app.Logger.LogInformation("Explicit database operation completed.");
    return;
}
app.UseMiddleware<ExceptionMiddleware>();
app.UseForwardedHeaders();
app.UseStatusCodePages(async status =>
{
    if (status.HttpContext.Request.Path.StartsWithSegments("/api"))
        await status.HttpContext.Response.WriteAsJsonAsync(new ApiResponse<object>("HTTP_" + status.HttpContext.Response.StatusCode, "请求地址或方法无效。", null, status.HttpContext.TraceIdentifier));
});
app.Use(async (ctx, next) => { ctx.Response.Headers.XContentTypeOptions = "nosniff"; ctx.Response.Headers.CacheControl = "no-store"; await next(); });
app.UseRouting();
app.UseAuthentication(); app.UseAuthorization(); app.UseRateLimiter();
app.MapControllers();
app.MapOpenApi().RequireAuthorization(policy => policy.RequireRole("Admin"));
app.MapGet("/health/live", () => Results.Json(new { status = "live" }));
app.MapGet("/health/ready", async (CmsRepository repo) => { try { return await repo.ReadyAsync() ? Results.Json(new { status = "ready" }) : Results.StatusCode(503); } catch { return Results.StatusCode(503); } });
app.Run();

static Task Denied(HttpContext ctx, int status, string code, string message)
{
    ctx.Response.StatusCode = status;
    return ctx.Response.WriteAsJsonAsync(new ApiResponse<object>(code, message, null, ctx.TraceIdentifier));
}
