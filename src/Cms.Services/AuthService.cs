using System.Text.RegularExpressions;
using System.Net.Mail;
using Cms.Data;
using MapsterMapper;
using Microsoft.AspNetCore.Identity;

namespace Cms.Services;

/// <summary>Account authentication and administration.</summary>
public sealed class AuthService(CmsRepository repository, IMapper mapper, LoginProtection protection)
{
    private static readonly Lazy<string> DummyHash = new(() =>
        new PasswordHasher<CmsUser>().HashPassword(new CmsUser(), Guid.NewGuid().ToString()));

    private readonly PasswordHasher<CmsUser> hasher = new();

    /// <summary>Verify credentials without exposing account existence.</summary>
    public async Task<CmsUser> LoginAsync(LoginInput input, string? browser)
    {
        var name = (input.Username ?? "").Trim().ToLowerInvariant();
        protection.BeginAttempt(name, browser, input);
        var user = await repository.FirstAsync<CmsUser>(x => x.Username == name);
        // Use a dummy hash for missing users so both paths perform the password KDF.
        var candidate = user ?? new CmsUser { PasswordHash = DummyHash.Value };
        if (input.Password is not { Length: <= 200 } ||
            hasher.VerifyHashedPassword(candidate, candidate.PasswordHash, input.Password) ==
            PasswordVerificationResult.Failed || user is not { Enabled: true })
            throw new CmsException(401, "INVALID_CREDENTIALS", "账号或密码错误。");
        protection.Succeeded(name);
        return user;
    }

    /// <summary>Validate a session against live account state.</summary>
    public Task<CmsUser?> FindAsync(string id)
    {
        return repository.FindAsync<CmsUser>(id);
    }

    /// <summary>Map an account without credentials.</summary>
    public UserView View(CmsUser user)
    {
        return mapper.Map<UserView>(user);
    }

    /// <summary>List safe account information.</summary>
    public async Task<IReadOnlyList<UserView>> ListAsync()
    {
        return (await repository.ListAsync<CmsUser>()).Select(View).ToList();
    }

    /// <summary>Initialize the first administrator only; never replace existing accounts.</summary>
    public Task<UserView> InitializeAsync(string username, string password)
    {
        return repository.WriteAsync("operator", "initialize", async repo =>
        {
            var existing = await repo.FirstAsync<CmsUser>(x => x.Role == "Admin" && x.Enabled);
            if (existing != null)
            {
                repo.SetAuditTarget("user", existing.Id, existing.DisplayName);
                return View(existing);
            }

            if (await repo.CountAsync<CmsUser>() != 0) throw new CmsException(409, "INITIALIZED", "数据库已有账号，拒绝重新初始化。");
            var user = Build(new UserInput(username, "管理员", "Admin", true, password));
            user.PasswordHash = hasher.HashPassword(user, password);
            repo.SetAuditTarget("user", user.Id, user.DisplayName);
            await repo.InsertAsync(user);
            if (await repo.FindAsync<SiteSettings>("site") == null)
                await repo.InsertAsync(new SiteSettings { Id = "site" });
            return View(user);
        });
    }

    /// <summary>Create or update an account and revoke old sessions.</summary>
    public Task<UserView> SaveAsync(string actor, string? id, UserInput input)
    {
        return repository.WriteAsync(actor, "user.save", async repo =>
        {
            var incoming = Build(input);
            var existing = id == null ? null : await repo.FindAsync<CmsUser>(id) ?? throw Missing();
            if (await repo.FirstAsync<CmsUser>(x => x.Username == incoming.Username && x.Id != (id ?? "")) != null)
                throw new CmsException(409, "DUPLICATE_USERNAME", "账号已存在。");
            if (existing?.Role == "Admin" && existing.Enabled && (input.Role != "Admin" || !input.Enabled))
                await ProtectLastAdmin(repo);
            if (existing != null)
            {
                incoming.Id = existing.Id;
                incoming.CreatedAt = existing.CreatedAt;
                incoming.PasswordHash = existing.PasswordHash;
            }

            if (!string.IsNullOrEmpty(input.Password))
                incoming.PasswordHash = hasher.HashPassword(incoming, input.Password);
            if (incoming.PasswordHash.Length == 0) throw new CmsException(400, "PASSWORD_REQUIRED", "新账号必须设置密码。");
            if (existing == null) await repo.InsertAsync(incoming);
            else await repo.UpdateAsync(incoming);
            repo.SetAuditTarget("user", incoming.Id, incoming.DisplayName);
            return View(incoming);
        });
    }

    /// <summary>Delete an account while preserving an active administrator.</summary>
    public Task<bool> DeleteAsync(string actor, string id)
    {
        return repository.WriteAsync(actor, "user.delete", async repo =>
        {
            var user = await repo.FindAsync<CmsUser>(id) ?? throw Missing();
            if (user.Role == "Admin" && user.Enabled) await ProtectLastAdmin(repo);
            repo.SetAuditTarget("user", user.Id, user.DisplayName);
            await repo.DeleteAsync<CmsUser>(id);
            return true;
        });
    }

    /// <summary>Rotate a password after verifying the current password.</summary>
    public Task<bool> ChangePasswordAsync(string id, PasswordInput input)
    {
        return repository.WriteAsync(id, "password.change", async repo =>
        {
            var user = await repo.FindAsync<CmsUser>(id) ?? throw Missing();
            if (input.CurrentPassword == null ||
                hasher.VerifyHashedPassword(user, user.PasswordHash, input.CurrentPassword) ==
                PasswordVerificationResult.Failed)
                throw new CmsException(400, "PASSWORD_MISMATCH", "当前密码不正确。");
            ValidatePassword(input.NewPassword);
            user.PasswordHash = hasher.HashPassword(user, input.NewPassword);
            user.SecurityStamp = Guid.NewGuid().ToString("N");
            repo.SetAuditTarget("user", user.Id, user.DisplayName);
            await repo.UpdateAsync(user);
            return true;
        });
    }

    private static CmsUser Build(UserInput input)
    {
        var name = (input.Username ?? "").Trim().ToLowerInvariant();
        if (!Regex.IsMatch(name, "^[a-z0-9][a-z0-9._-]{2,63}$") || string.IsNullOrWhiteSpace(input.DisplayName) ||
            input.DisplayName.Length > 100 || input.Role is not ("Admin" or "Editor" or "Support"))
            throw new CmsException(400, "INVALID_USER", "账号需为 3–64 位字母、数字或 ._-，请填写姓名并选择有效角色。");
        if (!string.IsNullOrEmpty(input.Password)) ValidatePassword(input.Password);
        var email = input.Email?.Trim() ?? "";
        if (email.Length > 254 || email != "" && (!MailAddress.TryCreate(email, out var address) || address.Address != email))
            throw new CmsException(400, "INVALID_EMAIL", "请填写有效的通知邮箱，或留空使用站点收件人。");
        return new CmsUser
            { Username = name, DisplayName = input.DisplayName.Trim(), Role = input.Role, Enabled = input.Enabled, Email = email };
    }

    /// <summary>Recover an existing administrator from the server console, revoking sessions and machine credentials.</summary>
    public Task<bool> ResetAdministratorPasswordAsync(string username, string password) => repository.WriteAsync("operator", "password.recover", async repo =>
    {
        ValidatePassword(password);
        var name = username.Trim().ToLowerInvariant();
        var user = await repo.FirstAsync<CmsUser>(x => x.Username == name && x.Role == "Admin") ?? throw Missing();
        user.PasswordHash = hasher.HashPassword(user, password);
        user.SecurityStamp = Guid.NewGuid().ToString("N");
        user.Enabled = true;
        await repo.UpdateAsync(user);
        foreach (var token in await repo.ListAsync<AccessToken>(x => x.UserId == user.Id && x.RevokedAt == null))
        {
            token.RevokedAt = DateTime.UtcNow;
            await repo.UpdateAsync(token);
        }
        repo.SetAuditTarget("user", user.Id, user.DisplayName);
        protection.Succeeded(name);
        return true;
    });

    private static void ValidatePassword(string? value)
    {
        if (value is not { Length: >= 12 and <= 200 })
            throw new CmsException(400, "INVALID_PASSWORD", "密码需为 12–200 个字符。");
    }

    private static async Task ProtectLastAdmin(CmsRepository repo)
    {
        if (await repo.CountAsync<CmsUser>(x => x.Role == "Admin" && x.Enabled) <= 1)
            throw new CmsException(409, "LAST_ADMIN", "必须保留至少一名启用的管理员。");
    }

    private static CmsException Missing()
    {
        return new CmsException(404, "NOT_FOUND", "账号不存在。");
    }
}
