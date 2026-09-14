using System.Security.Cryptography;
using System.Text;
using Cms.Data;
using Microsoft.Extensions.Caching.Memory;

namespace Cms.Services;

/// <summary>Bounded, single-use browser challenges and account login throttling.</summary>
public sealed class LoginProtection(TimeProvider clock) : IDisposable
{
    // ponytail: protection state is local to one API process and resets on restart; use shared Redis before scaling out.
    private readonly MemoryCache challenges = new(new MemoryCacheOptions { SizeLimit = 4096 });
    private readonly MemoryCache attempts = new(new MemoryCacheOptions { SizeLimit = 4096 });
    private readonly object gate = new();
    private static readonly TimeSpan ChallengeLifetime = TimeSpan.FromMinutes(3);
    private static readonly TimeSpan AttemptWindow = TimeSpan.FromMinutes(15);
    private sealed record Challenge(string Id, byte[] AnswerHash, DateTimeOffset Expires);
    private sealed record Attempts(int Count, DateTimeOffset Expires);
    private static readonly string[] Glyphs = [
        "01110100010000100010001000100011111", // 2
        "11110000010000101110000010000111110", // 3
        "00010001100101010010111110001000010", // 4
        "11111100001000011110000010000111110", // 5
        "01110100001000011110100011000101110", // 6
        "11111000010001000100010000100001000", // 7
        "01110100011000101110100011000101110", // 8
        "01110100011000101111000010000101110", // 9
    ];

    /// <summary>Replace this browser's previous challenge without exposing the answer.</summary>
    public CaptchaView Create(string browser)
    {
        var answer = new string(Enumerable.Range(0, 6).Select(_ => (char)('2' + RandomNumberGenerator.GetInt32(8))).ToArray());
        var item = new Challenge(RandomNumberGenerator.GetHexString(64), SHA256.HashData(Encoding.UTF8.GetBytes(answer)), clock.GetUtcNow() + ChallengeLifetime);
        lock (gate) Store(challenges, browser, item, ChallengeLifetime);
        return new(item.Id, "data:image/svg+xml;base64," + Convert.ToBase64String(Encoding.UTF8.GetBytes(Render(answer))), (int)ChallengeLifetime.TotalSeconds);
    }

    /// <summary>Consume a browser-bound challenge and reserve a password attempt atomically.</summary>
    public void BeginAttempt(string name, string? browser, LoginInput input)
    {
        lock (gate)
        {
            if (browser == null || !challenges.TryGetValue<Challenge>(browser, out var challenge) || challenge == null)
                throw InvalidCaptcha();
            // A copied challenge cannot invalidate a different browser's challenge.
            if (challenge.Id != input.CaptchaId) throw InvalidCaptcha();
            challenges.Remove(browser);
            if (challenge.Expires <= clock.GetUtcNow() || input.CaptchaCode is not { Length: <= 16 } ||
                !CryptographicOperations.FixedTimeEquals(challenge.AnswerHash, SHA256.HashData(Encoding.UTF8.GetBytes(input.CaptchaCode.Trim()))))
                throw InvalidCaptcha();
            if (name.Length is < 1 or > 64 || input.Password is not { Length: > 0 and <= 200 })
                throw new CmsException(401, "INVALID_CREDENTIALS", "账号或密码错误。");
            var key = AccountKey(name);
            attempts.TryGetValue<Attempts>(key, out var state);
            var now = clock.GetUtcNow();
            if (state != null && state.Expires <= now) state = null;
            if (state is { Count: >= 5 })
            {
                var retry = (int)Math.Ceiling((state.Expires - now).TotalSeconds);
                throw new CmsException(429, "LOGIN_LOCKED", $"该账号登录尝试过多，请在约 {Math.Ceiling(retry / 60d)} 分钟后重试。", retry);
            }
            var next = new Attempts((state?.Count ?? 0) + 1, state?.Expires ?? now + AttemptWindow);
            // The fifth reservation starts a full cooldown, including simultaneous attempts.
            if (next.Count == 5) next = next with { Expires = now + AttemptWindow };
            Store(attempts, key, next, next.Expires - now);
        }
    }

    /// <summary>Clear the account's attempt window after successful authentication.</summary>
    public void Succeeded(string name) { lock (gate) attempts.Remove(AccountKey(name)); }

    /// <summary>Release the bounded process-local caches.</summary>
    public void Dispose() { challenges.Dispose(); attempts.Dispose(); }

    private static string AccountKey(string name) => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(name)));
    private static CmsException InvalidCaptcha() => new(400, "CAPTCHA_INVALID", "验证码错误或已失效，请刷新后重试。");
    private static void Store<T>(MemoryCache cache, string key, T value, TimeSpan lifetime) where T : class
    {
        cache.Set(key, value, new MemoryCacheEntryOptions { Size = 1, AbsoluteExpirationRelativeToNow = lifetime, Priority = CacheItemPriority.NeverRemove });
        if (!cache.TryGetValue(key, out var saved) || !ReferenceEquals(saved, value))
            throw new CmsException(503, "LOGIN_BUSY", "登录服务繁忙，请稍后重试。");
    }

    private static string Render(string answer)
    {
        var svg = new StringBuilder("<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"200\" height=\"64\" viewBox=\"0 0 200 64\"><rect width=\"200\" height=\"64\" rx=\"6\" fill=\"#f1f5f9\"/>");
        for (var i = 0; i < 16; i++)
            svg.Append($"<path d=\"M{RandomNumberGenerator.GetInt32(200)} {RandomNumberGenerator.GetInt32(64)}L{RandomNumberGenerator.GetInt32(200)} {RandomNumberGenerator.GetInt32(64)}\" stroke=\"#cbd5e1\" fill=\"none\"/>");
        for (var i = 0; i < answer.Length; i++)
        {
            svg.Append($"<path fill=\"#1e3a5f\" transform=\"translate({14 + i * 29} {16 + RandomNumberGenerator.GetInt32(7)}) rotate({RandomNumberGenerator.GetInt32(-9, 10)} 10 14)\" d=\"");
            var glyph = Glyphs[answer[i] - '2'];
            for (var pixel = 0; pixel < glyph.Length; pixel++)
                if (glyph[pixel] == '1') svg.Append($"M{pixel % 5 * 4} {pixel / 5 * 4}h4v4h-4z");
            svg.Append("\"/>");
        }
        return svg.Append("</svg>").ToString();
    }
}
