using AngleSharp.Dom;

namespace Cms.Services;

/// <summary>Inline mobile typography for sanitized CMS articles sent to WeChat.</summary>
public static class WeChatArticleFormatter
{
    internal const string Version = "wechat-layout-1";

    /// <summary>Format a detached, sanitized article DOM without changing its text, links or image sources.</summary>
    public static string Format(IElement body)
    {
        foreach (var element in body.QuerySelectorAll("*"))
        {
            // Keep editorial emphasis and alignment; normalize font sizes and spacing for mobile reading.
            var emphasis = string.Join(";", (element.GetAttribute("style") ?? "").Split(';').Where(x =>
                x.Split(':', 2)[0].Trim().ToLowerInvariant() is "color" or "background-color" or "text-align"));
            var style = element.LocalName switch
            {
                "p" => element.ParentElement?.LocalName is "li" or "blockquote" or "td" or "th"
                    ? "margin:0 0 8px;" : "margin:0 0 18px;",
                "h1" or "h2" => "font-size:22px;line-height:1.45;font-weight:700;color:#1f2937;margin:30px 0 16px;padding-left:12px;border-left:4px solid #059669;",
                "h3" => "font-size:18px;line-height:1.5;font-weight:700;color:#1f2937;margin:24px 0 12px;",
                "h4" => "font-size:16px;line-height:1.6;font-weight:700;color:#1f2937;margin:20px 0 10px;",
                "blockquote" => "margin:22px 0;padding:14px 16px;border-left:3px solid #cbd5e1;background-color:#f6f8fa;color:#475569;font-size:15px;",
                "ul" => "margin:0 0 18px;padding-left:26px;list-style-type:disc;",
                "ol" => "margin:0 0 18px;padding-left:26px;list-style-type:decimal;",
                "li" => "margin:6px 0;",
                "pre" => "margin:20px 0;padding:14px;background-color:#f6f8fa;border:1px solid #e2e8f0;border-radius:6px;font-family:monospace;font-size:13px;line-height:1.65;letter-spacing:0;white-space:pre-wrap;word-break:break-all;text-align:left;",
                "code" => element.ParentElement?.LocalName == "pre"
                    ? "font-family:monospace;font-size:inherit;white-space:pre-wrap;"
                    : "font-family:monospace;font-size:14px;color:#9d174d;background-color:#fdf2f8;padding:2px 4px;word-break:break-all;",
                "table" => "width:100%;table-layout:fixed;border-collapse:collapse;margin:20px 0;font-size:14px;line-height:1.6;",
                "th" => "border:1px solid #dbe2e8;padding:8px;background-color:#f1f5f9;font-weight:700;text-align:left;word-break:break-word;",
                "td" => "border:1px solid #dbe2e8;padding:8px;text-align:left;word-break:break-word;",
                "a" => "color:#047857;text-decoration:underline;word-break:break-word;",
                "strong" or "b" => "font-weight:700;",
                "em" or "i" => "font-style:italic;",
                "u" => "text-decoration:underline;",
                "s" => "text-decoration:line-through;",
                "mark" => "background-color:#fef08a;color:inherit;",
                "hr" => "border:0;border-top:1px solid #e2e8f0;margin:28px 0;",
                "img" => ImageStyle(element),
                _ => ""
            };
            var combined = style + emphasis;
            if (combined.Length == 0) element.RemoveAttribute("style");
            else element.SetAttribute("style", combined);
            // Columns and galleries become a single reading flow without website CSS dependencies.
            foreach (var attribute in element.Attributes.Where(x => x.Name == "class" || x.Name.StartsWith("data-")).ToArray())
                element.RemoveAttribute(attribute.Name);
        }
        var section = body.Owner!.CreateElement("section");
        section.SetAttribute("style", "font-family:system-ui,-apple-system,'PingFang SC','Microsoft YaHei',sans-serif;font-size:16px;line-height:1.8;color:#333;letter-spacing:0.3px;word-wrap:break-word;padding:0 8px;");
        while (body.FirstChild is { } child) section.AppendChild(child);
        return section.OuterHtml;
    }

    private static string ImageStyle(IElement image)
    {
        var width = image.GetAttribute("data-width") is "25" or "50" or "75" or "100" ? image.GetAttribute("data-width") + "%" : "auto";
        var margin = image.GetAttribute("data-align") switch { "left" => "18px auto 18px 0", "right" => "18px 0 18px auto", _ => "18px auto" };
        return $"display:block;max-width:100%;height:auto;width:{width};margin:{margin};";
    }
}
