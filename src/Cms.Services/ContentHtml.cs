using System.Globalization;
using System.Text.RegularExpressions;
using AngleSharp.Dom;
using AngleSharp.Html.Parser;
using Cms.Data;
using Ganss.Xss;

namespace Cms.Services;

/// <summary>Allowlisted rich text shared by the browser editor and integration API.</summary>
public static class ContentHtml
{
    private static readonly HtmlSanitizer Sanitizer = CreateSanitizer();
    private static HtmlSanitizer CreateSanitizer()
    {
        var s = new HtmlSanitizer();
        s.AllowedTags.Clear(); s.AllowedAttributes.Clear(); s.AllowedSchemes.Clear(); s.AllowedCssProperties.Clear();
        foreach (var tag in "p br h2 h3 h4 strong b em i u s ul ol li blockquote pre code a img table thead tbody tr th td hr span mark sub sup div video audio iframe".Split(' ')) s.AllowedTags.Add(tag);
        foreach (var attr in "href src alt title colspan rowspan start style class data-type data-columns data-width data-align data-color controls preload sandbox loading referrerpolicy".Split(' ')) s.AllowedAttributes.Add(attr);
        foreach (var css in "color background-color font-size font-family text-align line-height".Split(' ')) s.AllowedCssProperties.Add(css);
        foreach (var scheme in new[] { "https", "http", "mailto" }) s.AllowedSchemes.Add(scheme);
        return s;
    }

    /// <summary>Remove executable markup and normalize the fixed editor formatting vocabulary.</summary>
    public static string Sanitize(string value)
    {
        var document = new HtmlParser().ParseDocument(Sanitizer.Sanitize(value));
        foreach (var element in document.Body!.QuerySelectorAll("*").ToArray())
        {
            var tag = element.LocalName;
            var kind = element.GetAttribute("data-type");
            if (tag == "iframe")
            {
                if (kind != "embed") { element.Remove(); continue; }
                if (!IsEmbedUrl(element.GetAttribute("src") ?? "")) throw new CmsException(400, "INVALID_EMBED", "嵌入网页仅支持公开域名的 HTTPS 地址，不能使用本机、内网或带账号的地址。");
                var title = element.GetAttribute("title")?.Trim();
                element.SetAttribute("title", string.IsNullOrEmpty(title) ? "嵌入网页" : title[..Math.Min(title.Length, 150)]);
                // Never allow same-origin, navigation, popups, forms, downloads or permissions.
                element.SetAttribute("sandbox", "allow-scripts");
                element.SetAttribute("referrerpolicy", "no-referrer");
                element.SetAttribute("loading", "lazy");
            }
            else foreach (var attr in new[] { "sandbox", "referrerpolicy", "loading" }) element.RemoveAttribute(attr);
            if (tag is "video" or "audio")
            {
                element.SetAttribute("controls", ""); element.SetAttribute("preload", "metadata");
            }
            else { element.RemoveAttribute("controls"); element.RemoveAttribute("preload"); }
            if (tag == "div" && kind is "columns" or "column" or "gallery")
            {
                if (kind == "columns")
                {
                    if (element.Children.Length is < 2 or > 3 || element.Children.Any(x => x.LocalName != "div" || x.GetAttribute("data-type") != "column")) throw LayoutError();
                    element.SetAttribute("data-columns", element.Children.Length.ToString(CultureInfo.InvariantCulture));
                }
                if (kind == "column" && element.ParentElement?.GetAttribute("data-type") != "columns") throw LayoutError();
                if (kind == "gallery")
                {
                    if (element.Children.Length is < 1 or > 30 || element.Children.Any(x => x.LocalName != "img")) throw LayoutError();
                    element.SetAttribute("data-columns", element.GetAttribute("data-columns") == "2" ? "2" : "3");
                }
            }
            else if (tag != "iframe") element.RemoveAttribute("data-type");
            if (kind is not ("columns" or "gallery") || tag != "div") element.RemoveAttribute("data-columns");
            if (tag != "img" || element.GetAttribute("data-width") is not ("25" or "50" or "75" or "100")) element.RemoveAttribute("data-width");
            if (tag != "img" || element.GetAttribute("data-align") is not ("left" or "center" or "right")) element.RemoveAttribute("data-align");
            if (tag != "mark" || !Color(element.GetAttribute("data-color") ?? "")) element.RemoveAttribute("data-color");
            var language = element.GetAttribute("class") ?? "";
            if (tag != "code" || !Regex.IsMatch(language, "^language-[a-z0-9-]{1,24}$")) element.RemoveAttribute("class");
            if (tag != "ol" || !int.TryParse(element.GetAttribute("start"), out var start) || start is < 1 or > 1_000_000) element.RemoveAttribute("start");
            var styles = new List<string>();
            foreach (var declaration in (element.GetAttribute("style") ?? "").Split(';'))
            {
                var pair = declaration.Split(':', 2); if (pair.Length != 2) continue;
                var name = pair[0].Trim().ToLowerInvariant(); var css = pair[1].Trim().ToLowerInvariant();
                var allowed = name switch
                {
                    "color" => Color(css) || tag == "mark" && css == "inherit",
                    "background-color" => tag is "span" or "mark" && Color(css),
                    "font-size" => Regex.IsMatch(css, "^(1[2-9]|[23][0-9]|40)px$"),
                    "font-family" => css.Trim('"', '\'') is "system-ui" or "serif" or "monospace",
                    "text-align" => tag is "p" or "h2" or "h3" or "h4" && css is "left" or "center" or "right" or "justify",
                    "line-height" => double.TryParse(css, NumberStyles.AllowDecimalPoint, CultureInfo.InvariantCulture, out var height) && height is >= 1.2 and <= 2.5,
                    _ => false
                };
                if (allowed) styles.Add(name + ": " + css);
            }
            if (styles.Count == 0) element.RemoveAttribute("style"); else element.SetAttribute("style", string.Join("; ", styles));
        }
        return document.Body.InnerHtml;
    }

    /// <summary>Validate an iframe destination without making any server-side network request.</summary>
    public static bool IsEmbedUrl(string value) => Uri.TryCreate(value, UriKind.Absolute, out var uri)
        && uri.Scheme == "https" && uri.IsDefaultPort && uri.UserInfo == "" && !uri.IsLoopback
        && uri.HostNameType == UriHostNameType.Dns && uri.IdnHost.TrimEnd('.').Contains('.')
        && !new[] { ".localhost", ".local", ".internal", ".lan", ".home" }.Any(suffix => uri.IdnHost.TrimEnd('.').EndsWith(suffix, StringComparison.OrdinalIgnoreCase));

    private static bool Color(string value)
    {
        if (Regex.IsMatch(value, "^#[0-9a-fA-F]{3}([0-9a-fA-F]{3})?$")) return true;
        // AngleSharp CSS normalizes opaque hex/rgb colors to rgba(..., 1).
        var rgb = Regex.Match(value, "^rgba?\\(\\s*(\\d{1,3})\\s*,\\s*(\\d{1,3})\\s*,\\s*(\\d{1,3})(?:\\s*,\\s*1(?:\\.0+)?)?\\s*\\)$");
        return rgb.Success && rgb.Groups.Cast<Group>().Skip(1).All(x => int.Parse(x.Value, CultureInfo.InvariantCulture) <= 255);
    }
    private static CmsException LayoutError() => new(400, "INVALID_LAYOUT", "分栏需为二至三栏，图片集只能包含一至三十张图片。");
}
