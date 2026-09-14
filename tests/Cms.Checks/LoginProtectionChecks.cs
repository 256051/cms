using System.Collections.Concurrent;
using System.Reflection;
using System.Text;
using System.Text.RegularExpressions;
using Cms.Data;
using Cms.Services;

internal static class LoginProtectionChecks
{
    internal static void Run()
    {
        var clock = new TestClock();
        using var protection = new LoginProtection(clock);
        const string browser = "browser", name = "test-user";
        LoginInput Issue(string owner = browser) => Input(protection.Create(owner));
        void Reject(Action action, string code)
        {
            try { action(); throw new Exception("Expected " + code); }
            catch (CmsException e) when (e.Code == code) { }
        }
        var code = Issue();
        Reject(() => protection.BeginAttempt(name, null, code), "CAPTCHA_INVALID");
        Reject(() => protection.BeginAttempt(name, "different-browser", code), "CAPTCHA_INVALID");
        protection.BeginAttempt(name, browser, code);
        Reject(() => protection.BeginAttempt(name, browser, code), "CAPTCHA_INVALID");
        var old = Issue(); var fresh = Issue();
        Reject(() => protection.BeginAttempt(name, browser, old), "CAPTCHA_INVALID");
        protection.BeginAttempt(name, browser, fresh);
        code = Issue();
        Reject(() => protection.BeginAttempt(name, browser, code with { CaptchaCode = "000000" }), "CAPTCHA_INVALID");
        Reject(() => protection.BeginAttempt(name, browser, code), "CAPTCHA_INVALID");
        code = Issue(); clock.Advance(TimeSpan.FromMinutes(3));
        Reject(() => protection.BeginAttempt(name, browser, code), "CAPTCHA_INVALID");
        protection.Succeeded(name);
        for (var i = 0; i < 5; i++) protection.BeginAttempt(name, browser, Issue());
        for (var i = 0; i < 3; i++) Reject(() => protection.BeginAttempt(name, browser, Issue()), "LOGIN_LOCKED");
        clock.Advance(TimeSpan.FromMinutes(14));
        try { protection.BeginAttempt(name, browser, Issue()); throw new Exception("Cooldown bypassed"); }
        catch (CmsException e) when (e.Code == "LOGIN_LOCKED" && e.RetryAfterSeconds == 60) { }
        clock.Advance(TimeSpan.FromMinutes(1));
        protection.BeginAttempt(name, browser, Issue());
        protection.Succeeded(name);
        for (var i = 0; i < 5; i++) protection.BeginAttempt(name, browser, Issue());
        Reject(() => protection.BeginAttempt(name, browser, Issue()), "LOGIN_LOCKED");
        protection.Succeeded(name);
        var outcomes = new ConcurrentBag<string>();
        Parallel.For(0, 12, i => {
            var owner = "parallel-" + i;
            var input = Issue(owner);
            try { protection.BeginAttempt(name, owner, input); outcomes.Add("allowed"); }
            catch (CmsException e) { outcomes.Add(e.Code); }
        });
        if (outcomes.Count(x => x == "allowed") != 5 || outcomes.Count(x => x == "LOGIN_LOCKED") != 7) throw new Exception("Concurrent account limit failed");
        var single = Issue("once"); outcomes.Clear();
        Parallel.For(0, 12, _ => {
            try { protection.BeginAttempt("single", "once", single); outcomes.Add("allowed"); }
            catch (CmsException e) { outcomes.Add(e.Code); }
        });
        if (outcomes.Count(x => x == "allowed") != 1 || outcomes.Count(x => x == "CAPTCHA_INVALID") != 11) throw new Exception("Challenge replay race");
        Console.WriteLine("PASS: browser binding, refresh, wrong/used/expired challenges, 5-attempt limit, cooldown expiry, success reset and concurrent replay/account limits");
    }

    private static LoginInput Input(CaptchaView view)
    {
        // White-box image decoding for the test font; never add an answer endpoint to the app.
        var glyphs = (string[])typeof(LoginProtection).GetField("Glyphs", BindingFlags.NonPublic | BindingFlags.Static)!.GetValue(null)!;
        var svg = Encoding.UTF8.GetString(Convert.FromBase64String(view.Image.Split(',')[1]));
        if (svg.Contains("<text") || svg.Contains("<script")) throw new Exception("Challenge exposes text or scripts");
        var answer = string.Concat(Regex.Matches(svg, "<path fill=\"[^\"]+\" transform=\"[^\"]+\" d=\"([^\"]+)\"").Select(m => {
            var bits = Enumerable.Repeat('0', 35).ToArray();
            foreach (Match pixel in Regex.Matches(m.Groups[1].Value, @"M(\d+) (\d+)h4v4h-4z")) bits[int.Parse(pixel.Groups[2].Value) / 4 * 5 + int.Parse(pixel.Groups[1].Value) / 4] = '1';
            return (Array.IndexOf(glyphs, new string(bits)) + 2).ToString();
        }));
        if (answer.Length != 6) throw new Exception("Invalid image");
        return new("test-user", "Password!123456", view.Id, answer);
    }

    private sealed class TestClock : TimeProvider
    {
        private DateTimeOffset now = DateTimeOffset.UtcNow;
        /// <summary>Return the simulated UTC clock.</summary>
        public override DateTimeOffset GetUtcNow() => now;
        internal void Advance(TimeSpan amount) => now += amount;
    }
}
