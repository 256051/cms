using System.Globalization;
using System.Security.Claims;
using System.Text.Json.Serialization;
using System.Threading.RateLimiting;
using Autofac;
using Autofac.Extensions.DependencyInjection;
using Cms.Api;
using Cms.Data;
using Cms.Services;
using MapsterMapper;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.Http.Features;
using Microsoft.AspNetCore.HttpOverrides;
using Microsoft.AspNetCore.Mvc;
using Microsoft.OpenApi;
using IPNetwork = System.Net.IPNetwork;

var builder = WebApplication.CreateBuilder(new WebApplicationOptions
{
    Args = args.Where(x => x is not ("--initialize" or "--migrate") && !x.StartsWith("--restore=", StringComparison.Ordinal) && !x.StartsWith("--reset-admin=", StringComparison.Ordinal)).ToArray(),
    ContentRootPath = AppContext.BaseDirectory
});
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
    container.RegisterType<AccessTokenService>().InstancePerLifetimeScope();
    container.RegisterType<IntegrationService>().InstancePerLifetimeScope();
    container.RegisterType<TrafficService>().InstancePerLifetimeScope();
    container.RegisterType<IpLocationService>().SingleInstance();
    container.RegisterType<VisitorIdentity>().InstancePerLifetimeScope();
    container.RegisterType<MaintenanceService>().InstancePerLifetimeScope();
    container.RegisterType<NotificationService>().InstancePerLifetimeScope();
    container.RegisterType<WeChatDraftService>().InstancePerLifetimeScope();
    container.RegisterType<WeChatSettingsService>().InstancePerLifetimeScope();
    container.RegisterType<AiSettingsService>().InstancePerLifetimeScope();
    container.Register(_ => AiWritingService.CreateClient()).Named<HttpClient>("ai").SingleInstance();
    container.Register(c => new AiWritingService(c.Resolve<CmsRepository>(), c.Resolve<AiSettingsService>(), c.ResolveNamed<HttpClient>("ai"))).InstancePerLifetimeScope();
    container.RegisterType<CommerceSettings>().InstancePerLifetimeScope();
    container.RegisterType<CommerceService>().InstancePerLifetimeScope();
});
builder.Services.AddHttpClient<PaymentGateway>(client => client.Timeout = TimeSpan.FromSeconds(20))
    .ConfigurePrimaryHttpMessageHandler(() => new HttpClientHandler { AllowAutoRedirect = false });
builder.Services.AddHostedService<MaintenanceWorker>();
builder.Services.AddHostedService<NotificationWorker>();
// Deliberately no HTTP request logging: WeChat requires access_token in query strings.
builder.Services.AddSingleton(_ => new WeChatClient(new HttpClient(new SocketsHttpHandler { AllowAutoRedirect = false })));
builder.Services.AddHostedService<WeChatWorker>();
builder.Services.AddSingleton<IMapper>(new Mapper(MappingConfiguration.Create()));
var keys = Path.GetFullPath(builder.Configuration["Security:KeyPath"] ?? "data/keys");
Directory.CreateDirectory(keys);
builder.Services.AddDataProtection().SetApplicationName("Cms").PersistKeysToFileSystem(new DirectoryInfo(keys));
builder.Services.AddAntiforgery(options =>
{
    options.HeaderName = "X-CSRF-TOKEN";
    options.Cookie.Name = "cms.csrf";
    options.Cookie.SameSite = SameSiteMode.Strict;
    options.Cookie.SecurePolicy = builder.Environment.IsDevelopment()
        ? CookieSecurePolicy.SameAsRequest
        : CookieSecurePolicy.Always;
});
builder.Services.AddAuthentication("request").AddPolicyScheme("request", null, options =>
        options.ForwardDefaultSelector = context =>
            context.Request.Path.StartsWithSegments("/api/v1/integration")
                ? IntegrationAuthenticationHandler.SchemeName
                : "cms")
    .AddScheme<AuthenticationSchemeOptions, IntegrationAuthenticationHandler>(
        IntegrationAuthenticationHandler.SchemeName, null)
    .AddCookie("cms", options =>
    {
        options.Cookie.Name = "cms.session";
        options.Cookie.HttpOnly = true;
        options.Cookie.SameSite = SameSiteMode.Strict;
        options.Cookie.SecurePolicy = builder.Environment.IsDevelopment()
            ? CookieSecurePolicy.SameAsRequest
            : CookieSecurePolicy.Always;
        options.ExpireTimeSpan = TimeSpan.FromHours(8);
        options.SlidingExpiration = false;
        options.Events.OnRedirectToLogin = ctx => Denied(ctx.HttpContext, 401, "UNAUTHENTICATED", "请先登录。");
        options.Events.OnRedirectToAccessDenied = ctx => Denied(ctx.HttpContext, 403, "FORBIDDEN", "没有执行此操作的权限。");
        options.Events.OnValidatePrincipal = async ctx =>
        {
            var id = ctx.Principal?.FindFirstValue(ClaimTypes.NameIdentifier);
            var user = id == null
                ? null
                : await ctx.HttpContext.RequestServices.GetRequiredService<AuthService>().FindAsync(id);
            if (user is not { Enabled: true } || user.SecurityStamp != ctx.Principal?.FindFirstValue("stamp"))
            {
                ctx.RejectPrincipal();
                await ctx.HttpContext.SignOutAsync("cms");
            }
        };
    });
builder.Services.AddAuthorization(options =>
{
    foreach (var scope in IntegrationScopes.All)
        options.AddPolicy(scope,
            policy => policy.AddAuthenticationSchemes(IntegrationAuthenticationHandler.SchemeName)
                .RequireAuthenticatedUser().RequireClaim("scope", scope));
});
builder.Services.AddSingleton(TimeProvider.System);
builder.Services.AddSingleton<LoginProtection>();
builder.Services.Configure<ForwardedHeadersOptions>(options =>
{
    options.ForwardedHeaders = ForwardedHeaders.XForwardedFor | ForwardedHeaders.XForwardedProto;
    foreach (var network in builder.Configuration.GetSection("ForwardedHeaders:KnownNetworks").Get<string[]>() ?? [])
        options.KnownIPNetworks.Add(IPNetwork.Parse(network));
});
builder.Services.AddControllers(options => options.Filters.Add<CsrfFilter>())
    .AddJsonOptions(options =>
    {
        options.JsonSerializerOptions.NumberHandling = JsonNumberHandling.Strict;
        options.JsonSerializerOptions.Converters.Add(new UtcDateTimeConverter());
    })
    .ConfigureApiBehaviorOptions(options => options.InvalidModelStateResponseFactory = ctx =>
        new BadRequestObjectResult(new ApiResponse<object>("VALIDATION_ERROR", "请求字段无效，请检查必填项与数据类型。", null,
            ctx.HttpContext.TraceIdentifier)));
builder.Services.AddOpenApi(options => options.AddDocumentTransformer((document, context, cancellation) =>
{
    document.Components ??= new OpenApiComponents();
    document.Components.SecuritySchemes ??= new Dictionary<string, IOpenApiSecurityScheme>();
    document.Components.SecuritySchemes["IntegrationToken"] = new OpenApiSecurityScheme
    {
        Type = SecuritySchemeType.Http, Scheme = "bearer",
        Description =
            "Expiring CMS access token issued by an administrator. HTTPS required; no cookie or CSRF token is used on integration endpoints."
    };
    foreach (var path in document.Paths.Where(x => x.Key.StartsWith("/api/v1/integration/", StringComparison.Ordinal)))
    foreach (var operation in path.Value.Operations?.Values.AsEnumerable() ?? [])
    {
        operation.Security =
        [
            new OpenApiSecurityRequirement { [new OpenApiSecuritySchemeReference("IntegrationToken", document)] = [] }
        ];
        foreach (var parameter in (operation.Parameters ?? []).OfType<OpenApiParameter>()
                 .Where(x => x.Name == "Idempotency-Key")) parameter.Required = true;
        operation.Responses ??= new OpenApiResponses();
        foreach (var (status, description) in new[]
                 {
                     ("400", "Invalid input or missing idempotency key"), ("401", "Invalid, expired or revoked token"),
                     ("403", "Missing scope"), ("409", "Version or idempotency conflict"),
                     ("429", "Rate limited; see Retry-After")
                 })
            operation.Responses.TryAdd(status, new OpenApiResponse { Description = description });
    }

    return Task.CompletedTask;
}));
builder.Services.ConfigureHttpJsonOptions(options =>
    options.SerializerOptions.NumberHandling = JsonNumberHandling.Strict);
builder.Services.AddRateLimiter(options =>
{
    options.AddPolicy("ai", ctx => RateLimitPartition.GetFixedWindowLimiter(
        ctx.User.FindFirstValue(ClaimTypes.NameIdentifier) ?? "anonymous",
        _ => new FixedWindowRateLimiterOptions { PermitLimit = 10, Window = TimeSpan.FromMinutes(1), QueueLimit = 0 }));
    options.AddPolicy("login",
        ctx => RateLimitPartition.GetSlidingWindowLimiter(
            ctx.Connection.RemoteIpAddress?.MapToIPv6().ToString() ?? "unknown",
            _ => new SlidingWindowRateLimiterOptions
                { PermitLimit = 10, Window = TimeSpan.FromMinutes(1), SegmentsPerWindow = 6, QueueLimit = 0 }));
    options.AddPolicy("captcha",
        ctx => RateLimitPartition.GetSlidingWindowLimiter(
            ctx.Connection.RemoteIpAddress?.MapToIPv6().ToString() ?? "unknown",
            _ => new SlidingWindowRateLimiterOptions
                { PermitLimit = 30, Window = TimeSpan.FromMinutes(1), SegmentsPerWindow = 6, QueueLimit = 0 }));
    options.AddPolicy("comments",
        ctx => RateLimitPartition.GetFixedWindowLimiter(ctx.Connection.RemoteIpAddress?.ToString() ?? "unknown",
            _ => new FixedWindowRateLimiterOptions
                { PermitLimit = 5, Window = TimeSpan.FromMinutes(1), QueueLimit = 0 }));
    options.AddPolicy("traffic",
        ctx => RateLimitPartition.GetFixedWindowLimiter(ctx.Connection.RemoteIpAddress?.ToString() ?? "unknown",
            _ => new FixedWindowRateLimiterOptions
                { PermitLimit = 120, Window = TimeSpan.FromMinutes(1), QueueLimit = 0 }));
    options.AddPolicy("commerce",
        ctx => RateLimitPartition.GetFixedWindowLimiter(ctx.Connection.RemoteIpAddress?.ToString() ?? "unknown",
            _ => new FixedWindowRateLimiterOptions { PermitLimit = 60, Window = TimeSpan.FromMinutes(1), QueueLimit = 0 }));
    options.AddPolicy("leads",
        ctx => RateLimitPartition.GetFixedWindowLimiter(ctx.Connection.RemoteIpAddress?.ToString() ?? "unknown",
            _ => new FixedWindowRateLimiterOptions
                { PermitLimit = 5, Window = TimeSpan.FromMinutes(1), QueueLimit = 0 }));
    options.AddPolicy("integration",
        ctx => RateLimitPartition.GetFixedWindowLimiter(
            ctx.User.FindFirstValue("token_id") is { } id
                ? "token:" + id
                : "ip:" + (ctx.Connection.RemoteIpAddress?.MapToIPv6().ToString() ?? "unknown"),
            _ => new FixedWindowRateLimiterOptions
                { PermitLimit = 60, Window = TimeSpan.FromMinutes(1), QueueLimit = 0 }));
    options.OnRejected = async (ctx, ct) =>
    {
        ctx.HttpContext.Response.StatusCode = 429;
        ctx.HttpContext.Response.Headers.RetryAfter = ctx.Lease.TryGetMetadata(MetadataName.RetryAfter, out var delay)
            ? Math.Ceiling(delay.TotalSeconds).ToString(CultureInfo.InvariantCulture)
            : "60";
        await ctx.HttpContext.Response.WriteAsJsonAsync(
            new ApiResponse<object>("RATE_LIMITED", "操作过于频繁，请稍后重试。", null, ctx.HttpContext.TraceIdentifier), ct);
    };
});
builder.Services.Configure<FormOptions>(x => x.MultipartBodyLengthLimit = 55_000_000);
var app = builder.Build();
var restore = args.FirstOrDefault(x => x.StartsWith("--restore=", StringComparison.Ordinal));
var resetAdmin = args.FirstOrDefault(x => x.StartsWith("--reset-admin=", StringComparison.Ordinal));
if (resetAdmin != null && (restore != null || args.Contains("--initialize") || args.Contains("--migrate")))
    throw new InvalidOperationException("账号恢复不能与初始化、迁移或恢复备份同时执行。");
var explicitDatabaseOperation = args.Contains("--initialize") || args.Contains("--migrate") || restore != null;
using (var scope = app.Services.CreateScope())
{
    var repo = scope.ServiceProvider.GetRequiredService<CmsRepository>();
    app.Logger.LogInformation("Checking and upgrading database schema before accepting requests.");
    await repo.InitializeSchemaAsync(allowCreate: explicitDatabaseOperation);
    if (resetAdmin != null)
    {
        await scope.ServiceProvider.GetRequiredService<AuthService>().ResetAdministratorPasswordAsync(resetAdmin[14..], RecoveryConsole.ReadPassword());
        Console.WriteLine("管理员密码已重置，旧登录会话及 API 令牌已失效。");
    }
    else if (restore != null)
        await scope.ServiceProvider.GetRequiredService<MaintenanceService>().RestoreAsync(restore[10..]);
    else if (args.Contains("--initialize"))
        await scope.ServiceProvider.GetRequiredService<AuthService>().InitializeAsync(
            builder.Configuration["Setup:Username"] ?? "", builder.Configuration["Setup:Password"] ?? "");
    app.Logger.LogInformation("Database schema is ready.");
}
if (explicitDatabaseOperation || resetAdmin != null) return;

app.Use(async (ctx, next) =>
{
    await next();
    if (ctx.Request.Path.StartsWithSegments("/api/v1/integration"))
        app.Logger.LogInformation(
            "Integration request. TokenId: {TokenId}, Method: {Method}, Status: {Status}, Trace: {Trace}",
            ctx.User.FindFirstValue("token_id") ?? "anonymous", ctx.Request.Method, ctx.Response.StatusCode,
            ctx.TraceIdentifier);
});
app.UseMiddleware<ExceptionMiddleware>();
app.UseForwardedHeaders();
app.UseStatusCodePages(async status =>
{
    if (status.HttpContext.Request.Path.StartsWithSegments("/api"))
        await status.HttpContext.Response.WriteAsJsonAsync(new ApiResponse<object>(
            "HTTP_" + status.HttpContext.Response.StatusCode, "请求地址或方法无效。", null, status.HttpContext.TraceIdentifier));
});
app.Use(async (ctx, next) =>
{
    ctx.Response.Headers.XContentTypeOptions = "nosniff";
    ctx.Response.Headers.CacheControl = "no-store";
    await next();
});
app.UseRouting();
app.UseAuthentication();
app.UseRateLimiter();
app.UseAuthorization();
app.MapControllers();
app.MapOpenApi().RequireAuthorization(policy => policy.RequireRole("Admin"));
app.MapGet("/health/live", () => Results.Json(new { status = "live" }));
app.MapGet("/health/ready", async (CmsRepository repo) =>
{
    try
    {
        return await repo.ReadyAsync() ? Results.Json(new { status = "ready" }) : Results.StatusCode(503);
    }
    catch
    {
        return Results.StatusCode(503);
    }
});
app.Run();

static Task Denied(HttpContext ctx, int status, string code, string message)
{
    ctx.Response.StatusCode = status;
    return ctx.Response.WriteAsJsonAsync(new ApiResponse<object>(code, message, null, ctx.TraceIdentifier));
}
