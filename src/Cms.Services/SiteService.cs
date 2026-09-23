using System.Text.RegularExpressions;
using Cms.Data;

namespace Cms.Services;

/// <summary>Site configuration, taxonomy, navigation and moderated comments.</summary>
public sealed class SiteService(CmsRepository repository, SettingsValidator settingsValidator)
{
    /// <summary>Get public-safe site metadata.</summary>
    public async Task<SiteSettings> SettingsAsync()
    {
        return await repository.FindAsync<SiteSettings>("site") ?? new SiteSettings { Id = "site" };
    }

    /// <summary>Read all categories and tags.</summary>
    public Task<List<Taxonomy>> TaxonomyAsync()
    {
        return repository.ListAsync<Taxonomy>();
    }

    /// <summary>Resolve navigation or footer links, omitting unavailable branches for visitors.</summary>
    public async Task<IReadOnlyList<MenuView>> MenuAsync(bool published = false, bool friendLinks = false)
    {
        var rows = await repository.ListAsync<MenuItem>(x => friendLinks ? x.Type == "friend" : x.Type != "friend");
        var views = await ResolveMenuAsync(repository, rows);
        var byId = views.ToDictionary(x => x.Id);

        bool Visible(MenuView item)
        {
            var visited = new HashSet<string>();
            while (true)
            {
                if (!item.Available || !visited.Add(item.Id)) return false;
                if (item.ParentId == "") return true;
                if (!byId.TryGetValue(item.ParentId, out item!)) return false;
            }
        }

        return views.Where(x => !published || Visible(x)).OrderBy(x => x.Sort).ThenBy(x => x.Id).ToArray();
    }

    /// <summary>Search safe published destinations for the menu editor.</summary>
    public async Task<PageResult<MenuTarget>> MenuTargetsAsync(string type, string? query, int page)
    {
        var q = (query ?? "").Trim();
        if (q.Length > 200 || type is not ("post" or "page" or "product" or "case" or "category" or "tag")) throw Bad("菜单类型或搜索条件无效。");
        if (type is "post" or "page" or "product" or "case")
        {
            var result = await repository.MenuTargetsAsync(type, q, page);
            return new PageResult<MenuTarget>(
                result.Items.Select(x => new MenuTarget(x.Id, x.PublishedTitle, ContentUrl(x))).ToArray(), result.Total,
                result.Page, result.PageSize);
        }

        var terms = await repository.PageAsync<Taxonomy>(x => x.Kind == type && (q == "" || x.Name.Contains(q)), page,
            20);
        return new PageResult<MenuTarget>(
            terms.Items.Select(x => new MenuTarget(x.Id, x.Name, $"/{x.Kind}/{x.Slug}")).ToArray(), terms.Total,
            terms.Page, terms.PageSize);
    }

    private static string ContentUrl(Content row)
    {
        return ContentService.PublicPath(row.Kind, row.Slug);
    }

    private static async Task<List<MenuView>> ResolveMenuAsync(CmsRepository repo, List<MenuItem> rows)
    {
        var contentIds = rows.Where(x => x.Type is "post" or "page" or "product" or "case").Select(x => x.TargetId).Distinct().ToArray();
        var contents = contentIds.Length == 0 ? [] : await repo.MenuContentsAsync(contentIds);
        var termIds = rows.Where(x => x.Type is "category" or "tag").Select(x => x.TargetId).Distinct().ToArray();
        var terms = termIds.Length == 0 ? [] : await repo.ListAsync<Taxonomy>(x => termIds.Contains(x.Id));
        return rows.Select(row =>
        {
            var post = contents.FirstOrDefault(x => x.Id == row.TargetId && x.Kind == row.Type);
            var term = terms.FirstOrDefault(x => x.Id == row.TargetId && x.Kind == row.Type);
            var label = post?.PublishedTitle ?? term?.Name ?? row.Label;
            var url = post != null ? ContentUrl(post) : term != null ? $"/{term.Kind}/{term.Slug}" : row.Url;
            return new MenuView(row.Id, label, url, row.Sort, row.ParentId, row.Type, row.TargetId, row.OpenInNewTab,
                row.Version, row.Type is "custom" or "friend" || post != null || term != null);
        }).ToList();
    }

    /// <summary>Page audit events.</summary>
    public async Task<PageResult<AuditView>> AuditAsync(int page, string actor = "", string action = "", string target = "", DateTime? from = null, DateTime? to = null)
    {
        Text(actor, 160, true); Text(action, 120, true); Text(target, 300, true);
        if (from.HasValue && to.HasValue && from > to) throw Bad("开始时间不能晚于结束时间。");
        var suffix = " (" + actor + ")";
        var rows = await repository.PageAsync<AuditEntry>(x => (actor == "" || x.Actor == actor || x.Actor.EndsWith(suffix)) &&
            (action == "" || x.Action == action) && (target == "" || x.TargetId == target || x.TargetName.Contains(target)) &&
            (from == null || x.CreatedAt >= from) && (to == null || x.CreatedAt <= to), page, 30);
        var ids = rows.Items.Select(x => AuditActor(x.Actor).Id).Distinct().ToArray();
        var users = (await repository.ListAsync<CmsUser>(x => ids.Contains(x.Id))).ToDictionary(x => x.Id, x => x.DisplayName);
        return new(rows.Items.Select(x => new AuditView(x.Id, x.CreatedAt, x.Actor,
            AuditActor(x.Actor).Name ?? users.GetValueOrDefault(x.Actor) ?? (x.Actor switch { "visitor" => "访客", "operator" => "部署管理员", "scheduler" => "定时任务", _ => x.Actor }),
            x.Action, x.TargetType, x.TargetId, x.TargetName, x.TokenId, x.TokenName)).ToArray(), rows.Total, rows.Page, rows.PageSize);
    }

    /// <summary>Obtain real dashboard counts.</summary>
    public async Task<StatsView> StatsAsync()
    {
        return new StatsView(await repository.CountAsync<Content>(x => x.Kind == "post" && x.DeletedAt == null),
            await repository.CountAsync<Content>(x => x.Published && x.Kind != "template" && x.Kind != "block"),
            await repository.CountAsync<Content>(x => x.Kind == "page" && x.DeletedAt == null),
            await repository.CountAsync<Comment>(x => !x.Approved), await repository.CountAsync<Asset>());
    }

    /// <summary>Update public site settings after validating asset references.</summary>
    public Task<SiteSettings> SaveSettingsAsync(string actor, SettingsInput input)
    {
        return repository.WriteAsync(actor, "settings.save", async repo =>
        {
            var validation = await settingsValidator.ValidateAsync(input);
            if (!validation.IsValid)
                throw Bad("请检查设置：文字只支持纯文本，分页条数为 1–50，语言或版本号须有效。" + validation.Errors[0].ErrorMessage);
            foreach (var assetId in new[] { input.LogoId, input.FaviconId }.Where(x => x != "").Distinct())
            {
                var asset = await repo.FindAsync<Asset>(assetId);
                if (asset == null || !asset.ContentType.StartsWith("image/")) throw Bad("Logo 和浏览器图标必须选择附件库中已上传的图片。");
            }

            var row = await repo.FindAsync<SiteSettings>("site") ?? throw Bad("请先初始化站点。");
            if (input.HomePageId != "" && input.HomePageId != row.HomePageId &&
                await repo.FirstAsync<Content>(x => x.Id == input.HomePageId && x.Kind == "page" && x.Published && x.DeletedAt == null) == null)
                throw Bad("首页请选择已发布的独立页面。");
            row.HomePageId = input.HomePageId;
            row.Title = input.Title.Trim();
            row.Description = input.Description;
            row.Keywords = input.Keywords;
            row.LogoId = input.LogoId ?? "";
            row.Subtitle = input.Subtitle.Trim();
            row.FaviconId = input.FaviconId;
            row.Language = input.Language;
            row.HomePageSize = input.HomePageSize;
            row.CategoryPageSize = input.CategoryPageSize;
            row.TagPageSize = input.TagPageSize;
            row.SearchPageSize = input.SearchPageSize;
            row.BlockSearchEngines = input.BlockSearchEngines;
            row.CommentsEnabled = input.CommentsEnabled;
            row.RequireCommentApproval = input.RequireCommentApproval;
            row.CommentsRequireLogin = input.CommentsRequireLogin;
            row.FooterText = input.FooterText.Trim();
            repo.SetAuditTarget("settings", row.Id, row.Title);
            await repo.SaveSettingsAsync(row, input.Version);
            return row;
        });
    }

    /// <summary>Save a named archive entry.</summary>
    public Task<Taxonomy> SaveTaxonomyAsync(string actor, string? id, TaxonomyInput input)
    {
        return repository.WriteAsync(actor, "taxonomy.save", async repo =>
        {
            ValidateTaxonomy(input);
            var row = id == null ? new Taxonomy() : await repo.FindAsync<Taxonomy>(id) ?? throw Missing();
            if (id != null && row.Kind != input.Kind) throw Bad("分类类型不能修改。");
            if (await repo.FirstAsync<Taxonomy>(x => x.Kind == input.Kind && x.Slug == input.Slug && x.Id != row.Id) !=
                null) throw new CmsException(409, "DUPLICATE_SLUG", "该分类地址已存在。");
            row.Kind = input.Kind;
            row.Name = input.Name.Trim();
            row.Slug = input.Slug;
            repo.SetAuditTarget(row.Kind, row.Id, row.Name);
            if (id == null) await repo.InsertAsync(row);
            else await repo.UpdateAsync(row);
            return row;
        });
    }

    private static (string Id, string? Name) AuditActor(string actor)
    {
        var match = Regex.Match(actor, @"^(.*) \(([a-f0-9]{32})\)$");
        return match.Success ? (match.Groups[2].Value, match.Groups[1].Value) : (actor, null);
    }

    internal static void ValidateTaxonomy(TaxonomyInput input)
    {
        Text(input.Name, 100);
        if (input.Kind is not ("category" or "tag") || input.Slug is not { Length: > 0 and <= 100 } ||
            !Regex.IsMatch(input.Slug, "^[a-z0-9]+(?:-[a-z0-9]+)*$")) throw Bad("分类类型或地址无效。");
    }

    /// <summary>Reject deletion of taxonomy referenced by drafts or published snapshots.</summary>
    public Task<bool> DeleteTaxonomyAsync(string actor, string id)
    {
        return repository.WriteAsync(actor, "taxonomy.delete", async repo =>
        {
            var row = await repo.FindAsync<Taxonomy>(id) ?? throw Missing();
            repo.SetAuditTarget(row.Kind, row.Id, row.Name);
            var marker = "|" + id + "|";
            var menu = await repo.FirstAsync<MenuItem>(x => x.TargetId == id && x.Type == row.Kind);
            if (menu != null)
                throw new CmsException(409, "MENU_IN_USE", $"导航菜单“{menu.Label}”引用了此分类或标签，请先修改或删除该菜单项。");
            var content = await repo.FirstAsync<Content>(x =>
                    x.CategoryId == id || x.PublishedCategoryId == id || x.TagIds.Contains(marker) ||
                    x.PublishedTagIds.Contains(marker) || x.ScheduledJson.Contains(id) || x.LayoutJson.Contains(id) || x.PublishedJson.Contains(id));
            if (content != null)
                throw new CmsException(409, "IN_USE", content.DeletedAt != null
                    ? $"回收站中的“{content.Title}”仍引用此分类或标签。请恢复内容后处理引用，或确认不再需要该内容后彻底删除。"
                    : $"内容“{content.Title}”仍引用此分类或标签，请检查草稿、已发布版本、定时发布和页面模块中的引用。");
            var revision = await repo.FirstAsync<ContentRevision>(x => x.SnapshotJson.Contains(id));
            if (revision != null)
                throw new CmsException(409, "IN_USE", $"“{revision.Title}”的历史版本仍引用此分类或标签，仅修改当前内容不能解除历史引用。保留历史版本时需保留该分类或标签。");
            await repo.DeleteAsync<Taxonomy>(id);
            return true;
        });
    }

    /// <summary>Save a safe navigation or footer link without allowing moves between the two groups.</summary>
    public Task<MenuView> SaveMenuAsync(string actor, string? id, MenuInput input, bool friendLinks = false)
    {
        return repository.WriteAsync(actor, friendLinks ? "friend-link.save" : "menu.save", async repo =>
        {
            if (friendLinks) input = input with { Type = "friend" };
            if ((friendLinks ? input.Type != "friend" : input.Type is not ("custom" or "post" or "page" or "product" or "case" or "category" or "tag")) || input.Version < 0 ||
                input.Version == int.MaxValue) throw Bad("菜单类型或版本号无效。");
            var row = id == null ? new MenuItem() : await repo.FindAsync<MenuItem>(id) ?? throw Missing();
            if (id != null && (row.Type == "friend") != friendLinks) throw Missing();
            if (friendLinks && (!string.IsNullOrEmpty(input.ParentId) || !string.IsNullOrEmpty(input.TargetId)))
                throw Bad("友情链接不支持上级菜单或关联内容。");
            row.ParentId = input.ParentId ?? "";
            row.Type = input.Type;
            row.TargetId = input.TargetId ?? "";
            row.OpenInNewTab = input.OpenInNewTab;
            row.Sort = input.Sort;
            if (row.ParentId.Length > 32 || row.TargetId.Length > 32) throw Bad("上级菜单或关联内容无效。");
            if (input.Type is "custom" or "friend")
            {
                Text(input.Label, 60);
                Text(input.Url, 500);
                var url = input.Url.Trim();
                if (friendLinks && (!Uri.TryCreate(url, UriKind.Absolute, out var friendUri) ||
                    friendUri.Scheme is not ("https" or "http") || string.IsNullOrEmpty(friendUri.Host) ||
                    friendUri.UserInfo != "" || url.Any(char.IsWhiteSpace)))
                    throw Bad("友情链接请填写完整的 HTTP 或 HTTPS 网址。");
                if (url.Contains('\\') || url.Any(char.IsControl) || !((url.StartsWith('/') && !url.StartsWith("//")) ||
                                                                       url.StartsWith('#') ||
                                                                       (Uri.TryCreate(url, UriKind.Absolute,
                                                                            out var uri) &&
                                                                        (uri.Scheme == "https" || friendLinks && uri.Scheme == "http"))))
                    throw Bad("链接仅支持站内路径、页内锚点或 HTTPS 地址。");
                row.Label = input.Label.Trim();
                row.Url = url;
                row.TargetId = "";
            }
            else
            {
                var resolved = (await ResolveMenuAsync(repo, [row]))[0];
                if (!resolved.Available) throw Bad("关联内容不存在、类型不匹配或尚未发布，请重新选择。");
                row.Label = resolved.Label;
                row.Url = resolved.Url;
            }

            var all = (await repo.ListAsync<MenuItem>(x => friendLinks ? x.Type == "friend" : x.Type != "friend")).ToDictionary(x => x.Id);
            all[row.Id] = row;
            foreach (var item in all.Values)
            {
                var current = item;
                var visited = new HashSet<string>();
                while (true)
                {
                    if (!visited.Add(current.Id)) throw Bad("上级菜单不能是自己或自己的子菜单。");
                    if (visited.Count > 5) throw Bad("菜单最多支持 5 级，请减少嵌套层级。");
                    if (current.ParentId == "") break;
                    if (!all.TryGetValue(current.ParentId, out current!)) throw Bad("上级菜单不存在，请重新选择。");
                }
            }

            repo.SetAuditTarget(friendLinks ? "friend-link" : "menu", row.Id, row.Label);
            if (id == null) await repo.InsertAsync(row);
            else await repo.SaveMenuAsync(row, input.Version);
            return (await ResolveMenuAsync(repo, [row]))[0];
        });
    }

    /// <summary>Remove a navigation or footer link without leaving orphaned children.</summary>
    public Task<bool> DeleteMenuAsync(string actor, string id, int? version = null, bool friendLinks = false)
    {
        return repository.WriteAsync(actor, friendLinks ? "friend-link.delete" : "menu.delete", async repo =>
        {
            var row = await repo.FindAsync<MenuItem>(id) ?? throw Missing();
            if ((row.Type == "friend") != friendLinks) throw Missing();
            if (version.HasValue && version != row.Version)
                throw new CmsException(409, "VERSION_CONFLICT", "菜单已被其他管理员修改，请重新加载。");
            if (await repo.CountAsync<MenuItem>(x => x.ParentId == id) > 0)
                throw new CmsException(409, "MENU_HAS_CHILDREN", "请先移动或删除子菜单，再删除此菜单项。");
            repo.SetAuditTarget(friendLinks ? "friend-link" : "menu", row.Id, row.Label);
            await repo.DeleteAsync<MenuItem>(id);
            return true;
        });
    }

    /// <summary>Submit a plain-text comment for moderation on a published article.</summary>
    public Task<Comment> AddCommentAsync(CommentInput input, string? actor = null)
    {
        return repository.WriteAsync(actor ?? "visitor", "comment.submit", async repo =>
        {
            var settings = await repo.FindAsync<SiteSettings>("site") ?? throw Missing();
            if (!settings.CommentsEnabled) throw new CmsException(403, "COMMENTS_DISABLED", "站点已关闭评论。");
            var account = actor == null ? null : await repo.FindAsync<CmsUser>(actor);
            if (settings.CommentsRequireLogin && account is not { Enabled: true })
                throw new CmsException(401, "COMMENT_LOGIN_REQUIRED", "请使用已有账号登录后评论。");
            var author = account is { Enabled: true }
                ? account.DisplayName[..Math.Min(account.DisplayName.Length, 60)]
                : input.Author;
            Text(author, 60);
            Text(input.Body, 2000);
            if (await repo.FirstAsync<Content>(x => x.Id == input.ContentId && x.Published && x.Kind != "template" && x.Kind != "block") == null) throw Missing();
            var row = new Comment
            {
                ContentId = input.ContentId, Author = author.Trim(), Body = input.Body.Trim(),
                Approved = !settings.RequireCommentApproval
            };
            repo.SetAuditTarget("comment", row.Id, row.Author + "的评论");
            await repo.InsertAsync(row);
            return row;
        });
    }

    /// <summary>Read only approved comments for a currently published article.</summary>
    public async Task<PageResult<Comment>> PublicCommentsAsync(string contentId, int page)
    {
        if (await repository.FirstAsync<Content>(x => x.Id == contentId && x.Published && x.Kind != "template" && x.Kind != "block") == null) throw Missing();
        if (!(await SettingsAsync()).CommentsEnabled) return new PageResult<Comment>([], 0, Math.Max(1, page), 30);
        return await repository.PageAsync<Comment>(x => x.ContentId == contentId && x.Approved, page, 30);
    }

    /// <summary>Page comments for moderation.</summary>
    public async Task<PageResult<ManagedComment>> CommentsAsync(int page, bool pending, string contentId = "", string q = "")
    {
        Text(contentId, 32, true); Text(q, 200, true);
        var rows = await repository.PageAsync<Comment>(x => (!pending || !x.Approved) &&
            (contentId == "" || x.ContentId == contentId) && (q == "" || x.Author.Contains(q) || x.Body.Contains(q)), page, 30);
        var ids = rows.Items.Select(x => x.ContentId).Distinct().ToArray();
        var contents = (await repository.ListAsync<Content>(x => ids.Contains(x.Id))).ToDictionary(x => x.Id);
        return new(rows.Items.Select(x => {
            var content = contents.GetValueOrDefault(x.ContentId);
            var section = content?.Kind switch { "post" => "posts", "product" => "products", "case" => "cases", _ => "pages" };
            return new ManagedComment(x.Id, x.ContentId, x.Author, x.Body, x.Approved, x.CreatedAt, x.Reply, x.ReplyBy, x.RepliedAt,
                content?.Title ?? "内容已删除", content is { Published: true } ? $"/{section}/{content.Slug}" : "",
                content == null ? "" : $"/admin/{section}/{content.Id}");
        }).ToArray(), rows.Total, rows.Page, rows.PageSize);
    }

    /// <summary>Save or clear an official response without bypassing comment approval.</summary>
    public Task<Comment> ReplyAsync(string actor, string id, string reply) => repository.WriteAsync(actor, "comment.reply", async repo =>
    {
        Text(reply, 2000, true);
        var user = await repo.FindAsync<CmsUser>(actor);
        if (user is not { Enabled: true, Role: "Admin" }) throw new CmsException(403, "FORBIDDEN", "仅管理员可以回复评论。");
        var row = await repo.FindAsync<Comment>(id) ?? throw Missing();
        row.Reply = reply.Trim(); row.ReplyBy = row.Reply == "" ? "" : user.DisplayName;
        row.RepliedAt = row.Reply == "" ? null : DateTime.UtcNow;
        repo.SetAuditTarget("comment", row.Id, row.Author + "的评论");
        await repo.UpdateAsync(row); return row;
    });

    /// <summary>Validate the full selection before applying one atomic moderation operation.</summary>
    public Task<bool> BatchCommentsAsync(string actor, CommentBatchInput input) => repository.WriteAsync(actor, "comment.batch", async repo =>
    {
        if (input.Ids is not { Length: > 0 and <= 100 } || input.Ids.Distinct().Count() != input.Ids.Length ||
            input.Ids.Any(x => x == null || !Regex.IsMatch(x, "^[a-f0-9]{32}$")) || input.Action is not ("approve" or "hide" or "delete"))
            throw Bad("请选择 1–100 条评论和有效操作。");
        var rows = await repo.ListAsync<Comment>(x => input.Ids.Contains(x.Id));
        if (rows.Count != input.Ids.Length) throw new CmsException(409, "COMMENT_CHANGED", "部分评论已删除，请刷新后重试。");
        foreach (var row in rows)
            if (input.Action == "delete") await repo.DeleteAsync<Comment>(row.Id);
            else { row.Approved = input.Action == "approve"; await repo.UpdateAsync(row); }
        repo.SetAuditTarget("comment", "", $"批量{(input.Action == "approve" ? "通过" : input.Action == "hide" ? "隐藏" : "删除")} {rows.Count} 条评论");
        return true;
    });

    /// <summary>Change approval state.</summary>
    public Task<Comment> ModerateAsync(string actor, string id, bool approved)
    {
        return repository.WriteAsync(actor, "comment.moderate", async repo =>
        {
            var row = await repo.FindAsync<Comment>(id) ?? throw Missing();
            repo.SetAuditTarget("comment", row.Id, row.Author + "的评论");
            row.Approved = approved;
            await repo.UpdateAsync(row);
            return row;
        });
    }

    /// <summary>Remove a comment.</summary>
    public Task<bool> DeleteCommentAsync(string actor, string id)
    {
        return repository.WriteAsync(actor, "comment.delete", async repo =>
        {
            var row = await repo.FindAsync<Comment>(id) ?? throw Missing();
            repo.SetAuditTarget("comment", row.Id, row.Author + "的评论");
            await repo.DeleteAsync<Comment>(id);
            return true;
        });
    }

    private static void Text(string? value, int max, bool empty = false)
    {
        if (value == null || value.Length > max || (!empty && string.IsNullOrWhiteSpace(value)))
            throw Bad($"请填写有效内容，长度不得超过 {max} 字符。");
    }

    private static CmsException Bad(string message)
    {
        return new CmsException(400, "VALIDATION_ERROR", message);
    }

    private static CmsException Missing()
    {
        return new CmsException(404, "NOT_FOUND", "记录不存在。");
    }
}
