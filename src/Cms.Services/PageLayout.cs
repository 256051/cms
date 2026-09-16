using System.Net;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using Cms.Data;

namespace Cms.Services;

/// <summary>A versioned, non-executable page composition stored with the content snapshot.</summary>
public record PageLayout(PageBlock[] Blocks, int Version = 1, string Width = "wide", bool ShowTitle = false,
    bool ShowHeader = true, bool ShowFooter = true);

/// <summary>One bounded page section; presentation choices are named tokens rather than CSS or code.</summary>
public record PageBlock(string Id, string Type, string Title = "", string Text = "", string ImageId = "",
    string ImageAlt = "", string LinkText = "", string LinkUrl = "", PageBlockItem[]? Items = null,
    string CategoryId = "", int Limit = 6, int Columns = 3, string Tone = "plain", string Align = "left",
    string Spacing = "normal", bool Hidden = false, string Html = "", PageBlockMobile? Mobile = null, string SharedId = "", string ContentKind = "post");

/// <summary>Optional narrow-screen overrides; empty tokens inherit the desktop presentation.</summary>
public record PageBlockMobile(string Align = "", string Spacing = "", int Columns = 1,
    string TextSize = "", bool Hidden = false);

/// <summary>A card or frequently asked question in a page section.</summary>
public record PageBlockItem(string Title = "", string Text = "", string ImageId = "", string ImageAlt = "",
    string LinkText = "", string LinkUrl = "");

/// <summary>Validate portable page data and derive its searchable static content.</summary>
public static class PageLayouts
{
    /// <summary>Reject malformed layouts, executable values and unbounded collections before any write.</summary>
    public static PageLayout Validate(PageLayout layout)
    {
        if (layout.Version != 1 || layout.Width is not ("narrow" or "normal" or "wide") ||
            layout.Blocks is not { Length: <= 40 } || layout.Blocks.Any(x => x == null) ||
            layout.Blocks.Select(x => x.Id).Distinct().Count() != layout.Blocks.Length ||
            layout.Blocks.Count(x => x.Type == "contact") > 1) throw Bad();
        foreach (var block in layout.Blocks)
        {
            if (!Identifier(block.Id, false) || block.Type is not ("hero" or "text" or "image" or "cards" or "posts" or "faq" or "cta" or "contact" or "shared") ||
                !Identifier(block.SharedId, block.Type != "shared") || block.Type != "shared" && block.SharedId != "" ||
                block.ContentKind is not ("post" or "product" or "case") ||
                block.Tone is not ("plain" or "soft" or "accent") || block.Align is not ("left" or "center") ||
                block.Spacing is not ("small" or "normal" or "large") || block.Limit is < 1 or > 12 ||
                block.Columns is < 1 or > 4 || !Identifier(block.CategoryId) ||
                block.Html == null || block.Html.Length > 50000 ||
                block.Mobile is { } mobile && (mobile.Align is not ("" or "left" or "center") ||
                    mobile.Spacing is not ("" or "small" or "normal" or "large") || mobile.Columns is < 1 or > 2 ||
                    mobile.TextSize is not ("" or "small" or "normal" or "large")) ||
                block.Items is { Length: > 12 } || block.Items?.Any(x => x == null) == true) throw Bad();
            Check(block.Title, block.Text, block.ImageId, block.ImageAlt, block.LinkText, block.LinkUrl);
            foreach (var item in block.Items ?? []) Check(item.Title, item.Text, item.ImageId, item.ImageAlt, item.LinkText, item.LinkUrl);
        }
        if (JsonSerializer.Serialize(layout).Length > 300_000) throw Bad();
        return layout with { Blocks = layout.Blocks.Select(x => x with {
            Items = x.Items ?? [], Html = ContentHtml.Sanitize(x.Html), Mobile = x.Mobile ?? new() }).ToArray() };
    }

    private static void Check(string title, string text, string image, string alt, string linkText, string link)
    {
        if (!Plain(title, 200) || !Plain(text, 10000) || !Identifier(image) || !Plain(alt, 300) ||
            !Plain(linkText, 100) || !SafeLink(link)) throw Bad();
    }

    private static bool Plain(string? value, int max) => value != null && value.Length <= max &&
        !value.Any(c => c is '<' or '>' || char.IsControl(c) && c is not ('\r' or '\n' or '\t'));
    private static bool Identifier(string? value, bool empty = true) => value != null &&
        (empty && value == "" || Regex.IsMatch(value, "^[a-f0-9]{32}$"));
    private static bool SafeLink(string? value)
    {
        if (value == null || value.Length > 1000 || value.Any(c => char.IsWhiteSpace(c) || char.IsControl(c) || c is '<' or '>' or '\\')) return false;
        if (value == "" || value.StartsWith('#')) return true;
        if (value.StartsWith('/')) return !value.StartsWith("//") && !Uri.UnescapeDataString(value).StartsWith("//") &&
            !Uri.UnescapeDataString(value).Any(c => char.IsControl(c) || c == '\\');
        return Uri.TryCreate(value, UriKind.Absolute, out var uri) && uri.Scheme is "https" or "http" or "mailto" or "tel";
    }

    /// <summary>Build escaped semantic text and media links for search and existing attachment validation.</summary>
    public static string Html(PageLayout layout, bool includeHidden = false)
    {
        var html = new StringBuilder();
        static string Encode(string value) => WebUtility.HtmlEncode(value);
        void Item(string title, string text, string image, string alt, string linkText, string link)
        {
            if (title != "") html.Append("<h2>").Append(Encode(title)).Append("</h2>");
            if (text != "") html.Append("<p>").Append(Encode(text).Replace("\n", "<br>")).Append("</p>");
            if (image != "") html.Append("<img src=\"/media/").Append(image).Append("\" alt=\"").Append(Encode(alt)).Append("\">");
            if (link != "") html.Append("<a href=\"").Append(Encode(link)).Append("\">").Append(Encode(linkText)).Append("</a>");
        }
        foreach (var block in layout.Blocks.Where(x => includeHidden || !x.Hidden))
        {
            Item(block.Title, block.Html == "" ? block.Text : "", block.ImageId, block.ImageAlt, block.LinkText, block.LinkUrl);
            html.Append(block.Html);
            foreach (var item in block.Items ?? []) Item(item.Title, item.Text, item.ImageId, item.ImageAlt, item.LinkText, item.LinkUrl);
        }
        return html.ToString();
    }

    private static CmsException Bad() => new(400, "INVALID_LAYOUT", "页面布局无效：请检查模块类型、文字、链接和数量，最多支持 40 个模块及每组 12 个项目。");
}
