using System.Security.Cryptography;
using System.Text.Json;
using Cms.Data;
using Microsoft.Extensions.Configuration;

namespace Cms.Services;

/// <summary>Published state and its site-relative reading address.</summary>
public record IntegrationPublication(ContentView Content, string Path);

/// <summary>Scoped, retry-safe automation using the same editorial services as the admin UI.</summary>
public sealed class IntegrationService(
    CmsRepository repository,
    ContentValidator validator,
    IConfiguration configuration,
    TimeProvider clock,
    WeChatSettingsService? wechatSettings = null)
{
    /// <summary>List editorial content without full bodies.</summary>
    public Task<PageResult<ContentView>> ListAsync(string kind, string? query, int page)
    {
        if (kind is "template" or "block") throw new CmsException(400, "INVALID_KIND", "模板和公共区块请通过后台管理。");
        return new ContentService(repository, validator).ListAsync(false, kind, query, null, null, page, 20);
    }

    /// <summary>Read one current draft and its version.</summary>
    public async Task<ContentView> GetAsync(string id)
    {
        var content = await new ContentService(repository, validator).GetAsync(id);
        if (content.Kind is "template" or "block") throw new CmsException(404, "NOT_FOUND", "内容不存在。");
        return content;
    }

    /// <summary>Read selectable category and tag identifiers.</summary>
    public Task<List<Taxonomy>> TaxonomyAsync()
    {
        return repository.ListAsync<Taxonomy>();
    }

    /// <summary>Create or update one draft, preserving the public snapshot.</summary>
    public Task<ContentView> SaveAsync(string tokenId, string key, string? id, ContentInput input)
    {
        if (input.Kind is "template" or "block") throw new CmsException(400, "INVALID_KIND", "模板和公共区块请通过后台管理。");
        return OnceAsync(tokenId, key, IntegrationScopes.Write, new { operation = "save", id, input },
            (repo, token) => new ContentService(repo, validator).SaveAsync(token.UserId, id, input));
    }

    /// <summary>Publish the caller's expected version and return its public path.</summary>
    public Task<IntegrationPublication> PublishAsync(string tokenId, string key, string id, ContentPublishInput input)
    {
        return OnceAsync(tokenId, key, IntegrationScopes.Publish, new { operation = "publish", id, input },
            async (repo, token) =>
            {
                if ((await repo.FindAsync<Content>(id))?.Kind is "template" or "block")
                    throw new CmsException(404, "NOT_FOUND", "内容不存在。");
                var content =
                    await new ContentService(repo, validator, wechatSettings).PublishAsync(token.UserId, id, input.Version, true, input.SyncToWeChat);
                return new IntegrationPublication(content,
                    ContentService.PublicPath(content.Kind, content.Slug));
            });
    }

    /// <summary>Fingerprint file bytes and name independently of multipart boundaries, then upload once.</summary>
    public async Task<AssetView> UploadAsync(string tokenId, string key, string filename, Stream input,
        CancellationToken cancellation)
    {
        CheckKey(key);
        var limit = Math.Clamp(configuration.GetValue<long?>("Storage:MaxBytes") ?? 10_485_760, 1, 52_428_800);
        using var buffer = new MemoryStream();
        var block = new byte[81920];
        int read;
        while ((read = await input.ReadAsync(block, cancellation)) > 0)
        {
            if (buffer.Length + read > limit) throw new CmsException(413, "FILE_TOO_LARGE", "文件超过上传大小限制。");
            await buffer.WriteAsync(block.AsMemory(0, read), cancellation);
        }

        var hash = Convert.ToHexStringLower(SHA256.HashData(buffer.GetBuffer().AsSpan(0, checked((int)buffer.Length))));
        buffer.Position = 0;
        return await OnceAsync(tokenId, key, IntegrationScopes.Upload,
            new { operation = "upload", filename = Path.GetFileName(filename), hash },
            (repo, token) =>
                new AssetService(repo, configuration).UploadAsync(token.UserId, filename, buffer, cancellation));
    }

    private Task<T> OnceAsync<T>(string tokenId, string key, string scope, object request,
        Func<CmsRepository, AccessToken, Task<T>> work)
    {
        CheckKey(key);
        AccessToken? token = null;
        return repository.ExecuteOnceAsync(tokenId, AccessTokenService.Hash(key),
            AccessTokenService.Hash(JsonSerializer.Serialize(request)), clock.GetUtcNow().UtcDateTime, async repo =>
            {
                token = await new AccessTokenService(repo, clock).RequireAsync(tokenId, scope);
                repo.SetIntegrationActor(token.Id, token.Name);
            }, repo => work(repo, token!));
    }

    private static void CheckKey(string key)
    {
        if (key.Length is < 8 or > 128 || !key.All(c => char.IsAsciiLetterOrDigit(c) || c is '-' or '_' or '.'))
            throw new CmsException(400, "INVALID_IDEMPOTENCY_KEY",
                "写入请求必须提供 8–128 位的 Idempotency-Key，仅允许字母、数字、连字符、下划线和点。");
    }
}
