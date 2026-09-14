using System.Text.Json;
using Cms.Data;
using FluentValidation;

namespace Cms.Services;

/// <summary>Editable, non-executable theme appearance.</summary>
public record ThemeOptions(string AccentColor, string HeroTitle, string HeroDescription);
/// <summary>One packaged theme and its independent saved options.</summary>
public record ThemeDefinition(string Id, string Name, string Description, string Thumbnail, string DefaultHeroTitle, ThemeOptions Defaults, ThemeOptions Options);
/// <summary>Administrative snapshot used for optimistic writes.</summary>
public record ThemesView(string ActiveThemeId, int Version, IReadOnlyList<ThemeDefinition> Themes);
/// <summary>Public or authenticated-preview rendering configuration.</summary>
public record ThemeView(string ThemeId, ThemeOptions Options);
/// <summary>Atomically save this profile and activate it.</summary>
public record ThemeApplyInput(string ThemeId, ThemeOptions Options, int Version);

/// <summary>Validate colors and plain-text options before rendering or persisting them.</summary>
public sealed class ThemeOptionsValidator : AbstractValidator<ThemeOptions>
{
    /// <summary>Define the fixed, safe customization surface.</summary>
    public ThemeOptionsValidator()
    {
        RuleFor(x => x.AccentColor).NotEmpty().Matches("^#[0-9a-fA-F]{6}$").WithMessage("主色必须为六位十六进制颜色，例如 #2563EB。");
        RuleFor(x => x.HeroTitle).NotNull().MaximumLength(100).Must(x => Plain(x, false)).WithMessage("首页标题最多 100 字，只能使用纯文本。");
        RuleFor(x => x.HeroDescription).NotNull().MaximumLength(500).Must(x => Plain(x, true)).WithMessage("首页介绍最多 500 字，只能使用纯文本。");
    }
    private static bool Plain(string? value, bool multiline) => value != null && !value.Any(c => c is '<' or '>' || char.IsControl(c) && !(multiline && c is '\r' or '\n' or '\t'));
}

/// <summary>Built-in theme catalogue and audited database-backed appearance.</summary>
public sealed class ThemeService(CmsRepository repository, ThemeOptionsValidator validator)
{
    private static readonly ThemeDefinition[] Catalogue = [
        Define("classic", "经典博客", "清爽蓝白、舒展首页与图文卡片。", "#2563EB", "让每一个想法，\n都值得被看见。"),
        Define("paper", "极简阅读", "暖白纸感、单列目录，留出安静阅读的空间。", "#166534", "记录日常，认真阅读。"),
        Define("magazine", "杂志资讯", "醒目的头条与多列图文，让新鲜内容成为焦点。", "#B45309", "值得关注，值得阅读。"),
        Define("midnight", "暗色科技", "深色背景、青色强调，专注技术与灵感。", "#38BDF8", "探索，记录，持续创造。"),
        Define("fuwari", "Fuwari · 清新卡片", "柔和色彩、圆角卡片与个人侧栏，让日常记录轻盈展开。", "#7C5CC4", "记录生活，也记录灵感。"),
        Define("retypeset", "Retypeset · 重新编排", "舒展留白、细致排版与时间目录，让文字成为阅读主角。", "#9A5B36", "把日子写成值得重读的篇章。"),
        Define("cactus", "Cactus · 极简技术", "紧凑目录、清晰代码与绿色点缀，专注技术分享。", "#2BBC8A", "保持好奇，持续构建。")
    ];
    private static ThemeDefinition Define(string id, string name, string description, string color, string title)
    {
        var defaults = new ThemeOptions(color, "", "");
        return new(id, name, description, $"/themes/{id}.png", title, defaults, defaults);
    }
    private static ThemeDefinition Definition(string id) => Catalogue.FirstOrDefault(x => x.Id == id) ?? throw new CmsException(400, "INVALID_THEME", "请选择系统预置的主题。");
    private static Dictionary<string, ThemeOptions> Profiles(ThemeState state) => JsonSerializer.Deserialize<Dictionary<string, ThemeOptions>>(state.ProfilesJson) ?? [];
    private static ThemesView View(ThemeState state)
    {
        var profiles = Profiles(state);
        return new(state.ActiveThemeId, state.Version, Catalogue.Select(x => x with { Options = profiles.GetValueOrDefault(x.Id) ?? x.Defaults }).ToArray());
    }
    private async Task<ThemeView> ResolveAsync(string id, ThemeOptions options)
    {
        var definition = Definition(id);
        var result = await validator.ValidateAsync(options);
        if (!result.IsValid) throw new CmsException(400, "VALIDATION_ERROR", result.Errors[0].ErrorMessage);
        var site = await repository.FindAsync<SiteSettings>("site") ?? throw new CmsException(503, "NOT_READY", "站点尚未初始化。");
        var title = definition.DefaultHeroTitle;
        return new(id, options with { AccentColor = options.AccentColor.ToUpperInvariant(), HeroTitle = string.IsNullOrWhiteSpace(options.HeroTitle) ? title : options.HeroTitle, HeroDescription = string.IsNullOrWhiteSpace(options.HeroDescription) ? site.Description : options.HeroDescription });
    }
    /// <summary>Read all saved profiles and the current revision for administrators.</summary>
    public async Task<ThemesView> ListAsync() => View(await repository.FindAsync<ThemeState>("site") ?? throw new CmsException(503, "NOT_READY", "请先升级数据库。"));
    /// <summary>Return only the active theme's effective public options.</summary>
    public async Task<ThemeView> PublicAsync()
    {
        var state = await ListAsync();
        var theme = state.Themes.First(x => x.Id == state.ActiveThemeId);
        return await ResolveAsync(theme.Id, theme.Options);
    }
    /// <summary>Validate a read-only preview without saving or activating it.</summary>
    public Task<ThemeView> PreviewAsync(string themeId, string? accentColor, string? heroTitle, string? heroDescription)
    {
        var theme = Definition(themeId);
        return ResolveAsync(themeId, new(accentColor ?? theme.Defaults.AccentColor, heroTitle ?? "", heroDescription ?? ""));
    }
    /// <summary>Save the selected profile and activate it in one versioned, audited transaction.</summary>
    public async Task<ThemesView> ApplyAsync(string actor, ThemeApplyInput input)
    {
        var definition = Definition(input.ThemeId);
        if (input.Options == null || input.Version < 0) throw new CmsException(400, "VALIDATION_ERROR", "主题配置或版本号无效。");
        await ResolveAsync(input.ThemeId, input.Options);
        return await repository.WriteAsync(actor, "theme.apply", async repo =>
        {
            var state = await repo.FindAsync<ThemeState>("site") ?? throw new CmsException(503, "NOT_READY", "请先升级数据库。");
            var profiles = Profiles(state);
            profiles[input.ThemeId] = input.Options with { AccentColor = input.Options.AccentColor.ToUpperInvariant() };
            state.ProfilesJson = JsonSerializer.Serialize(profiles);
            state.ActiveThemeId = input.ThemeId;
            await repo.SaveThemeAsync(state, input.Version);
            repo.SetAuditTarget("theme", definition.Id, definition.Name);
            return View(state);
        });
    }
}
