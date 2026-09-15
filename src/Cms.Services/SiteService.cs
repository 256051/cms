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

    /// <summary>Resolve live destinations, omitting unavailable branches from the public navigation.</summary>
    public async Task<IReadOnlyList<MenuView>> MenuAsync(bool published = false)
    {
        var rows = await repository.ListAsync<MenuItem>();
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
        if (q.Length > 200 || type is not ("post" or "page" or "category" or "tag")) throw Bad("菜单类型或搜索条件无效。");
        if (type is "post" or "page")
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
        return $"/{(row.Kind == "post" ? "posts" : "pages")}/{row.Slug}";
    }

    private static async Task<List<MenuView>> ResolveMenuAsync(CmsRepository repo, List<MenuItem> rows)
    {
        var contentIds = rows.Where(x => x.Type is "post" or "page").Select(x => x.TargetId).Distinct().ToArray();
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
                row.Version, row.Type == "custom" || post != null || term != null);
        }).ToList();
    }

    /// <summary>Page audit events.</summary>
    public Task<PageResult<AuditEntry>> AuditAsync(int page)
    {
        return repository.PageAsync<AuditEntry>(x => true, page, 30);
    }

    /// <summary>Obtain real dashboard counts.</summary>
    public async Task<StatsView> StatsAsync()
    {
        return new StatsView(await repository.CountAsync<Content>(x => x.Kind == "post"),
            await repository.CountAsync<Content>(x => x.Published),
            await repository.CountAsync<Content>(x => x.Kind == "page"),
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
            Text(input.Name, 100);
            if (input.Kind is not ("category" or "tag") || input.Slug is not { Length: > 0 and <= 100 } ||
                !Regex.IsMatch(input.Slug, "^[a-z0-9]+(?:-[a-z0-9]+)*$")) throw Bad("分类类型或地址无效。");
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

    /// <summary>Reject deletion of taxonomy referenced by drafts or published snapshots.</summary>
    public Task<bool> DeleteTaxonomyAsync(string actor, string id)
    {
        return repository.WriteAsync(actor, "taxonomy.delete", async repo =>
        {
            var row = await repo.FindAsync<Taxonomy>(id) ?? throw Missing();
            repo.SetAuditTarget(row.Kind, row.Id, row.Name);
            var marker = "|" + id + "|";
            if (await repo.CountAsync<MenuItem>(x => x.TargetId == id && x.Type == row.Kind) > 0)
                throw new CmsException(409, "MENU_IN_USE", "导航菜单引用了此分类或标签，请先修改或删除对应菜单项。");
            if (await repo.CountAsync<Content>(x =>
                    x.CategoryId == id || x.PublishedCategoryId == id || x.TagIds.Contains(marker) ||
                    x.PublishedTagIds.Contains(marker)) > 0)
                throw new CmsException(409, "IN_USE", "已有内容引用此分类或标签，请先移除引用。");
            await repo.DeleteAsync<Taxonomy>(id);
            return true;
        });
    }

    /// <summary>Save safe site navigation.</summary>
    public Task<MenuView> SaveMenuAsync(string actor, string? id, MenuInput input)
    {
        return repository.WriteAsync(actor, "menu.save", async repo =>
        {
            if (input.Type is not ("custom" or "post" or "page" or "category" or "tag") || input.Version < 0 ||
                input.Version == int.MaxValue) throw Bad("菜单类型或版本号无效。");
            var row = id == null ? new MenuItem() : await repo.FindAsync<MenuItem>(id) ?? throw Missing();
            row.ParentId = input.ParentId ?? "";
            row.Type = input.Type;
            row.TargetId = input.TargetId ?? "";
            row.OpenInNewTab = input.OpenInNewTab;
            row.Sort = input.Sort;
            if (row.ParentId.Length > 32 || row.TargetId.Length > 32) throw Bad("上级菜单或关联内容无效。");
            if (input.Type == "custom")
            {
                Text(input.Label, 60);
                Text(input.Url, 500);
                var url = input.Url.Trim();
                if (url.Contains('\\') || url.Any(char.IsControl) || !((url.StartsWith('/') && !url.StartsWith("//")) ||
                                                                       url.StartsWith('#') ||
                                                                       (Uri.TryCreate(url, UriKind.Absolute,
                                                                            out var uri) &&
                                                                        uri.Scheme == "https")))
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

            var all = (await repo.ListAsync<MenuItem>()).ToDictionary(x => x.Id);
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

            repo.SetAuditTarget("menu", row.Id, row.Label);
            if (id == null) await repo.InsertAsync(row);
            else await repo.SaveMenuAsync(row, input.Version);
            return (await ResolveMenuAsync(repo, [row]))[0];
        });
    }

    /// <summary>Remove a leaf navigation entry without leaving orphaned children.</summary>
    public Task<bool> DeleteMenuAsync(string actor, string id, int? version = null)
    {
        return repository.WriteAsync(actor, "menu.delete", async repo =>
        {
            var row = await repo.FindAsync<MenuItem>(id) ?? throw Missing();
            if (version.HasValue && version != row.Version)
                throw new CmsException(409, "VERSION_CONFLICT", "菜单已被其他管理员修改，请重新加载。");
            if (await repo.CountAsync<MenuItem>(x => x.ParentId == id) > 0)
                throw new CmsException(409, "MENU_HAS_CHILDREN", "请先移动或删除子菜单，再删除此菜单项。");
            repo.SetAuditTarget("menu", row.Id, row.Label);
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
            if (await repo.FirstAsync<Content>(x => x.Id == input.ContentId && x.Published) == null) throw Missing();
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
        if (await repository.FirstAsync<Content>(x => x.Id == contentId && x.Published) == null) throw Missing();
        if (!(await SettingsAsync()).CommentsEnabled) return new PageResult<Comment>([], 0, Math.Max(1, page), 30);
        return await repository.PageAsync<Comment>(x => x.ContentId == contentId && x.Approved, page, 30);
    }

    /// <summary>Page comments for moderation.</summary>
    public Task<PageResult<Comment>> CommentsAsync(int page, bool pending)
    {
        return repository.PageAsync<Comment>(x => !pending || !x.Approved, page, 30);
    }

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