using System.Security.Cryptography;
using System.Text;
using Cms.Data;

namespace Cms.Services;

/// <summary>Allowlisted permissions for content automation.</summary>
public static class IntegrationScopes
{
    /// <summary>Read editorial content and taxonomy.</summary>
    public const string Read = "content:read";
    /// <summary>Create and edit drafts.</summary>
    public const string Write = "content:write";
    /// <summary>Publish an explicitly selected content version.</summary>
    public const string Publish = "content:publish";
    /// <summary>Upload verified media.</summary>
    public const string Upload = "asset:upload";
    /// <summary>All supported permissions.</summary>
    public static readonly string[] All = [Read, Write, Publish, Upload];
}

/// <summary>Administrator request to issue an expiring machine credential.</summary>
public record AccessTokenInput(string Name, string UserId, string[] Scopes, DateTimeOffset ExpiresAt);
/// <summary>Safe credential metadata, with no secret or hash.</summary>
public record AccessTokenView(string Id, string Name, string UserId, string UserDisplayName, string[] Scopes, DateTime CreatedAt, DateTime ExpiresAt, DateTime? LastUsedAt, DateTime? RevokedAt, string Status);
/// <summary>The secret is returned only in this issuance response.</summary>
public record IssuedAccessToken(AccessTokenView Token, string Secret);

/// <summary>Issue, revoke and authenticate scoped integration credentials.</summary>
public sealed class AccessTokenService(CmsRepository repository, TimeProvider clock)
{
    /// <summary>Return paged metadata without credential hashes.</summary>
    public async Task<PageResult<AccessTokenView>> ListAsync(int page)
    {
        var result = await repository.PageAsync<AccessToken>(x => true, page, 20);
        var users = (await repository.ListAsync<CmsUser>()).ToDictionary(x => x.Id);
        return new(result.Items.Select(x => View(x, users.GetValueOrDefault(x.UserId))).ToList(), result.Total, result.Page, result.PageSize);
    }

    /// <summary>Create an explicit bounded credential and audit the issuance atomically.</summary>
    public Task<IssuedAccessToken> CreateAsync(string actor, AccessTokenInput input) => repository.WriteAsync(actor, "token.create", async repo =>
    {
        var now = clock.GetUtcNow();
        if (string.IsNullOrWhiteSpace(input.Name) || input.Name.Length > 100 || input.Name.Any(c => char.IsControl(c) || c is '<' or '>') || input.UserId is not { Length: 32 } || input.Scopes is not { Length: > 0 and <= 4 } || input.Scopes.Any(x => !IntegrationScopes.All.Contains(x)) || input.ExpiresAt <= now || input.ExpiresAt > now.AddDays(365))
            throw new CmsException(400, "INVALID_TOKEN", "请填写名称、有效账号、至少一项权限，并设置一年内的有效期。");
        var user = await repo.FindAsync<CmsUser>(input.UserId);
        if (user is not { Enabled: true } || user.Role is not ("Admin" or "Editor")) throw new CmsException(400, "INVALID_TOKEN_USER", "请选择已启用的管理员或编辑账号。");
        if (await repo.CountAsync<AccessToken>(x => x.UserId == user.Id && x.RevokedAt == null && x.ExpiresAt > now.UtcDateTime) >= 100)
            throw new CmsException(409, "TOKEN_LIMIT", "该账号最多保留 100 个未过期令牌，请先撤销不用的令牌。");
        var secret = Convert.ToHexStringLower(RandomNumberGenerator.GetBytes(32));
        var row = new AccessToken { Name = input.Name.Trim(), UserId = user.Id, Scopes = string.Join(' ', input.Scopes.Distinct().Order()), ExpiresAt = input.ExpiresAt.UtcDateTime, SecretHash = Hash(secret), CreatedAt = now.UtcDateTime };
        repo.SetAuditTarget("token", row.Id, row.Name);
        await repo.InsertAsync(row);
        return new IssuedAccessToken(View(row, user), $"cms_{row.Id}.{secret}");
    });

    /// <summary>Irreversibly revoke a credential.</summary>
    public Task<bool> RevokeAsync(string actor, string id) => repository.WriteAsync(actor, "token.revoke", async repo =>
    {
        var token = await repo.FindAsync<AccessToken>(id) ?? throw new CmsException(404, "NOT_FOUND", "令牌不存在。");
        token.RevokedAt ??= clock.GetUtcNow().UtcDateTime;
        repo.SetAuditTarget("token", token.Id, token.Name);
        await repo.UpdateAsync(token);
        return true;
    });

    /// <summary>Verify a high-entropy credential without revealing whether its identifier exists.</summary>
    public async Task<AccessToken?> AuthenticateAsync(string value)
    {
        if (value.Length != 101 || !value.StartsWith("cms_", StringComparison.Ordinal) || value[36] != '.' || !value.AsSpan(4, 32).ToString().All(c => c is >= '0' and <= '9' or >= 'a' and <= 'f') || !value.AsSpan(37).ToString().All(c => c is >= '0' and <= '9' or >= 'a' and <= 'f')) return null;
        var row = await repository.FindAsync<AccessToken>(value[4..36]);
        if (row == null || !CryptographicOperations.FixedTimeEquals(Encoding.ASCII.GetBytes(row.SecretHash), Encoding.ASCII.GetBytes(Hash(value[37..])))) return null;
        try { await RequireAsync(row.Id); }
        catch (CmsException e) when (e.Status == 401) { return null; }
        await repository.TouchTokenAsync(row.Id, clock.GetUtcNow().UtcDateTime);
        return row;
    }

    /// <summary>Recheck live account, expiry, revocation and scope inside the write transaction, including retries.</summary>
    public async Task<AccessToken> RequireAsync(string id, string? scope = null)
    {
        var token = await repository.FindAsync<AccessToken>(id);
        var user = token == null ? null : await repository.FindAsync<CmsUser>(token.UserId);
        if (token == null || token.RevokedAt != null || token.ExpiresAt <= clock.GetUtcNow().UtcDateTime || user is not { Enabled: true } || user.Role is not ("Admin" or "Editor"))
            throw new CmsException(401, "INVALID_ACCESS_TOKEN", "访问令牌无效、已过期或已撤销。");
        if (scope != null && !token.Scopes.Split(' ').Contains(scope)) throw new CmsException(403, "INSUFFICIENT_SCOPE", "访问令牌没有执行此操作的权限。");
        return token;
    }

    private AccessTokenView View(AccessToken token, CmsUser? user) => new(token.Id, token.Name, token.UserId, user?.DisplayName ?? "已删除账号", token.Scopes.Split(' '), token.CreatedAt, token.ExpiresAt, token.LastUsedAt, token.RevokedAt,
        token.RevokedAt != null ? "revoked" : token.ExpiresAt <= clock.GetUtcNow().UtcDateTime ? "expired" : user is not { Enabled: true } ? "disabled" : "active");
    /// <summary>Compute a stable lowercase digest for credentials and request fingerprints.</summary>
    public static string Hash(string value) => Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(value)));
}
