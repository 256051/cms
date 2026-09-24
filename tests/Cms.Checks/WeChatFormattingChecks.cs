using AngleSharp.Html.Parser;
using Cms.Services;

/// <summary>Check mobile typography without changing editorial content; return a reusable preview fragment.</summary>
public static class WeChatFormattingChecks
{
    /// <summary>Verify formatting preservation and emit the exact HTML used for visual checks.</summary>
    public static string Run()
    {
        const string sample = """
            <p>把文章写好，也让它在手机上读起来舒服。清晰的层级、恰当的留白，让读者更容易抓住重点。</p>
            <h2>01 · 让内容成为主角</h2>
            <p>正文保持舒适的字号和行距。<strong>关键结论用加粗强调</strong>，<em>少量斜体用于补充说明</em>，不需要给每句话加上装饰。</p>
            <p style="text-align:center"><span style="color:#047857;font-size:40px;line-height:2.5">保留作者设置的颜色与居中</span></p>
            <blockquote><p>好的排版，是让读者把注意力放在内容上。</p></blockquote>
            <h3>三个简单的阅读习惯</h3>
            <ol start="3"><li><p>一个段落只讲一个重点。</p></li><li><p>用 <mark style="background-color:#fef08a">高亮标记</mark> 少量关键信息。</p><ul><li>补充说明保持紧凑，层级清楚。</li></ul></li></ol>
            <img src="https://mmbiz.qpic.cn/preview.png" alt="文章配图示意" data-width="100" data-align="center">
            <h2>02 · 复杂内容也要清楚</h2>
            <p>代码中的 <code>AutoPublish</code> 保持清晰，长行在手机上自然换行：</p>
            <pre><code class="language-json">{
              "Enabled": true,
              "AutoPublish": false,
              "Description": "这是一段用于检查手机长行自动换行的示例文字，不应该撑破文章的阅读区域。"
            }</code></pre>
            <table><thead><tr><th>内容</th><th>呈现方式</th></tr></thead><tbody><tr><td>正文与标题</td><td>统一间距，突出层级</td></tr><tr><td>图片与表格</td><td>适应手机宽度，保留完整信息</td></tr></tbody></table>
            <div data-type="columns"><div data-type="column"><p>第一栏内容。</p></div><div data-type="column"><p>第二栏紧随其后，形成自然的阅读顺序。</p></div></div>
            <hr><p>保留<a href="https://example.com/article?a=1&amp;b=2">原有链接</a>、<u>下划线</u>和<sup>上标</sup>。</p>
            """;
        var safe = ContentHtml.Sanitize(sample);
        var parser = new HtmlParser();
        var source = parser.ParseDocument(safe).Body!;
        var text = source.TextContent;
        var code = source.QuerySelector("pre")!.TextContent;
        var formatted = WeChatArticleFormatter.Format(source);
        var result = parser.ParseDocument(formatted).Body!;
        void Check(bool value, string message) { if (!value) throw new Exception(message); }
        Check(result.TextContent == text && result.QuerySelector("pre")!.TextContent == code, "formatting preserves text and code whitespace");
        Check(result.QuerySelector("a")!.GetAttribute("href") == "https://example.com/article?a=1&b=2" &&
            result.QuerySelector("img")!.GetAttribute("src") == "https://mmbiz.qpic.cn/preview.png", "formatting preserves link and uploaded image URLs");
        Check(result.QuerySelector("ol")!.GetAttribute("start") == "3" && result.QuerySelectorAll("strong,em,mark,u,sup").Length == 5,
            "numbering and semantic emphasis survive");
        Check(!formatted.Contains("40px") && !formatted.Contains("data-type") && !formatted.Contains("class="), "website sizes and layout classes do not leak");
        Check(result.QuerySelector("span")!.GetAttribute("style")!.Contains("rgba(4, 120, 87, 1)") &&
            result.QuerySelector("span")!.ParentElement!.GetAttribute("style")!.Contains("text-align: center"), "editorial color and alignment survive");
        Check(result.QuerySelector("table")!.GetAttribute("style")!.Contains("table-layout:fixed") &&
            result.QuerySelector("pre")!.GetAttribute("style")!.Contains("pre-wrap"), "wide content has a mobile layout");
        var smallImage = parser.ParseDocument("<img src='/media/example' data-width='50' data-align='right' alt='small'>").Body!;
        var smallResult = parser.ParseDocument(WeChatArticleFormatter.Format(smallImage)).QuerySelector("img")!;
        Check(smallResult.GetAttribute("style")!.Contains("width:50%") && smallResult.GetAttribute("style")!.Contains("18px 0 18px auto"), "image size and alignment survive");
        return formatted;
    }
}
