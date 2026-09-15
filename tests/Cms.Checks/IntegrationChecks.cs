using Cms.Data;
using Cms.Services;
using Microsoft.Extensions.Configuration;

internal static class IntegrationChecks
{
    internal static async Task RunAsync(CmsRepository repo)
    {
        var clock = new TestClock();
        var owner = (await repo.FirstAsync<CmsUser>(x => x.Role == "Admin" && x.Enabled))!;
        var tokens = new AccessTokenService(repo, clock);
        var issued = await tokens.CreateAsync(owner.Id,
            new AccessTokenInput("transaction check", owner.Id, IntegrationScopes.All, clock.GetUtcNow().AddHours(1)));
        var token = (await repo.FindAsync<AccessToken>(issued.Token.Id))!;
        if (token.SecretHash.Length != 64 || token.SecretHash == issued.Secret ||
            await tokens.AuthenticateAsync(issued.Secret) == null)
            throw new Exception("Credential hashing/authentication failed.");
        var root = Path.Combine(Path.GetTempPath(), "cms-integration-" + Guid.NewGuid().ToString("N"));
        var config = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?> { ["Storage:Path"] = root }).Build();
        var beforeAudit = await repo.CountAsync<AuditEntry>();
        var beforeAssets = await repo.CountAsync<Asset>();
        var beforeContent = await repo.CountAsync<Content>();
        var key = Guid.NewGuid().ToString("N");
        try
        {
            await repo.ExecuteOnceAsync<bool>(token.Id, key, "rollback", clock.GetUtcNow().UtcDateTime,
                _ => Task.CompletedTask, async scoped =>
                {
                    scoped.SetIntegrationActor(token.Id, token.Name);
                    await new ContentService(scoped, new ContentValidator()).SaveAsync(owner.Id, null,
                        new ContentInput("post", "rollback-" + key, "必须回滚", "", "<p>事务测试</p>", "", "", [], 0));
                    using var png = new MemoryStream(Convert.FromBase64String(
                        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a0foAAAAASUVORK5CYII="));
                    await new AssetService(scoped, config).UploadAsync(owner.Id, "rollback.png", png,
                        CancellationToken.None);
                    throw new InvalidOperationException("integration rollback");
                });
        }
        catch (InvalidOperationException e) when (e.Message == "integration rollback")
        {
        }

        if (await repo.CountAsync<AuditEntry>() != beforeAudit || await repo.CountAsync<Asset>() != beforeAssets ||
            await repo.CountAsync<Content>() != beforeContent ||
            await repo.FirstAsync<IntegrationRequest>(x => x.KeyHash == key) != null ||
            Directory.EnumerateFiles(root).Any())
            throw new Exception("Integration write/audit/receipt/file rollback failed.");
        Directory.Delete(root); // The empty, uniquely named test directory only.

        var requestKey = AccessTokenService.Hash("clock-" + key);
        var runs = 0;

        Task<int> Execute()
        {
            return repo.ExecuteOnceAsync(token.Id, requestKey, "same-input", clock.GetUtcNow().UtcDateTime,
                _ => Task.CompletedTask, _ => Task.FromResult(++runs));
        }

        if (await Execute() != 1 || await Execute() != 1 || runs != 1)
            throw new Exception("Replay ran the write twice.");
        clock.Advance(TimeSpan.FromHours(1) + TimeSpan.FromSeconds(2)); // Account for provider timestamp rounding.
        if (await tokens.AuthenticateAsync(issued.Secret) != null) throw new Exception("Expired token authenticated.");
        clock.Advance(TimeSpan.FromHours(24));
        if (await Execute() != 2) throw new Exception("Expired replay record did not clear.");
        await repo.DeleteAsync<AccessToken>(token.Id);
        var receipt = (await repo.FirstAsync<IntegrationRequest>(x => x.KeyHash == requestKey))!;
        await repo.DeleteAsync<IntegrationRequest>(receipt.Id);
        Console.WriteLine(
            "PASS: integration credential hashing/expiry, 24-hour retry window, and atomic content/asset/audit/receipt/file rollback");
    }

    private sealed class TestClock : TimeProvider
    {
        // Keep this simulated expiry window in the past so its cleanup cannot expire other suite receipts.
        private DateTimeOffset now = DateTimeOffset.UtcNow.AddDays(-2);

        /// <summary>Return a deterministic test clock.</summary>
        public override DateTimeOffset GetUtcNow()
        {
            return now;
        }

        internal void Advance(TimeSpan amount)
        {
            now += amount;
        }
    }
}