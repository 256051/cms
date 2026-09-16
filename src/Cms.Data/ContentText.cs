using System.Net;
using System.Text.RegularExpressions;

namespace Cms.Data;

/// <summary>Plain searchable text from already sanitized publication HTML.</summary>
public static class ContentText
{
    /// <summary>Discard markup, decode entities and collapse whitespace.</summary>
    public static string Plain(string html) => Regex.Replace(
        WebUtility.HtmlDecode(Regex.Replace(html, "<[^>]*>", " ")), @"\s+", " ").Trim();
}
