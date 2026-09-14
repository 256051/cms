# 主题功能验收记录

本页保留 schema 3 的历史验收结果。当前多级菜单和 schema 4 结果见 [菜单验收记录](menus-verification.md)。

日期：2026-09-14。预置主题、后台配置、启用前预览及 schema 3 已实现并在本地验收；未部署到外部服务器。

[机器可读结果](themes-results.json)保存四库及 Docker 最终结果。四库运行编号 `6f0398c4ae`，最终 Docker / 浏览器运行编号 `docker-195dd087cc`。原始日志位于本地 `artifacts/` 对应目录。

## 实现范围

- 四套固定主题：经典博客、极简阅读、杂志资讯、暗色科技，覆盖首页、文章、独立页面、归档、搜索、分页和评论。后台样式独立。
- 主题目录使用实际首页截图；每套保存自己的主色、首页标题、首页介绍。恢复默认只修改表单；保存与启用一次提交。
- 管理员身份、CSRF、主题白名单、颜色与纯文本长度校验；全局整数版本防止多管理员覆盖；主题设置、启用与包含主题名称的审计记录同事务。
- 新增 `cms_theme`，配置 JSON 作为长文本，不使用专有 JSON 查询。显式逐级升级至 schema 3，旧站默认经典布局；普通启动不改表。
- 正式页面直接服务端输出当前主题。预览使用现有 Cookie 会话校验管理员身份，复用公开页面组件，只读取已发布内容；导航、搜索和分页保持预览参数，评论不可提交，设置 noindex、不进入 sitemap。
- OpenAPI 与生成的 TypeScript 接口已更新；未新增或升级运行时依赖。

主要实现：`src/Cms.Services/ThemeService.cs`、`src/Cms.Data/Entities.cs`、`CmsRepository.cs`、`src/Cms.Api/Controllers.cs`；`web/src/components/admin/ThemeManager.tsx`、`PublicPages.tsx`、`SiteShell.tsx`、`ContentList.tsx`、`CommentSection.tsx`；`web/src/lib/theme.ts`、`web/src/app/themes.css` 和主题预览路由。缩略图在 `web/public/themes/`，web 镜像显式复制 `public` 目录。

## 实际测试

### 构建

.NET 构建通过，0 警告、0 错误；前端类型检查和生产构建通过；API 与 Next.js Docker 镜像构建通过。接口契约从集成测试运行中的 API 导出，再生成前端类型。

### 四库：89 组通过

SQLite 23 组；PostgreSQL、MySQL、SQL Server 各 22 组。组表示验收场景集合，并非 89 个独立单元测试。数据库版本范围保持首版基线：项目 SQLite 引擎、PostgreSQL 17、MySQL 8.4、SQL Server 2022 Developer。

复用并重新执行认证、内容发布隔离、附件引用、审核评论、中文与长正文、唯一约束、排序分页、审计、备份恢复和 Consul 验收；本轮主题检查包括：

1. 新库初始化及重复初始化；schema 1 → 2 → 3、schema 2 → 3 和重复升级。普通启动旧库就绪返回 503，表结构不变；升级保留旧数据。
2. 四套主题独立保存中文配置，切换回来仍保留；公开接口只返回当前主题生效配置，不泄露其他主题的未启用设置。
3. 未登录、编辑角色越权、缺少 CSRF、未知主题、非法颜色、超长或包含标记的文本均拒绝；失败不改变状态。
4. 预览校验不修改主题、版本或审计记录；两个并发请求使用同一个版本时只有一个成功，另一个返回 409。
5. 实际数据库事务同时回滚主题 ID、配置 JSON、版本和审计写入；成功日志包含主题 ID 与名称。
6. 重启及恢复到独立新数据库后，整份主题管理状态一致；恢复配套附件和密钥后原会话仍有效。

### 浏览器与 Docker HTTPS：通过

Windows Microsoft Edge 无头浏览器，随机端口、随机凭据、独立 Docker 数据及附件/密钥卷，Production HTTPS 配置。**3 个 Playwright 综合用例通过，总计 42.0 秒**，主题用例 16.1 秒。

- 原有编辑发布、未保存保护、SEO、加载失败恢复、键盘导航及审计用例仍通过。
- 选择主题、修改标题、新标签预览、启用、前台阅读、恢复已保存设置；恢复默认在提交前不改变公开网站。
- 预览内文章、搜索、下一页保留主题和编辑值；草稿返回 404。未登录跳转登录，编辑角色服务端拒绝并返回后台。预览 noindex/nofollow、无 canonical，评论按钮禁用，公开主题保持原值。
- 注入一次 503，提示含追踪编号且输入保留；取消离开和取消切换编辑主题仍保留输入；重试可成功。真实制造旧版本写入，显示明确冲突并保留表单，不能覆盖另一请求的启用结果。
- 四套主题逐一检查 375、768、1440 像素宽度的首页、文章、独立页面、分类、标签、搜索和后续分页，没有页面横向溢出；检查无封面和空搜索结果。
- 六类公开页面的原始 HTML 含当前主题、标题、描述和关键词；文章含正文，公开页面 canonical、搜索 noindex、sitemap 和 robots 保持正确，sitemap 没有预览地址。
- 白、黑、黄色、灰色和默认主色，按钮文字及链接与普通背景/浅色块的对比度均至少 4.5；暗色表格表头配色也经过浏览器断言。
- 后台主题图片实际加载；375、768 像素后台无横向溢出，配置标题聚焦和 Tab 到主色色值输入框可用；前台主题切换不改变后台底色。
- HTTPS 同域 API/附件/页面、Secure 认证及 CSRF Cookie、SSR、sitemap、robots、重启后的主题状态、媒体字节和会话均通过。最终镜像包含四张静态缩略图。

首轮截图捕获运行 `docker-34d5709d5d` 生成内置图片；随后重新构建 web 镜像验证图片交付。截图检查发现暗色表头沿用浅色背景，已修正并重跑最终浏览器验收。一次中间测试把 Next.js 的空播报区域匹配成业务错误提示，已收紧测试定位；以上统计只计最终通过运行。

### 截图复核

已查看四套首页缩略图、经典主题平板首页、杂志手机首页、极简与暗色手机正文，以及后台桌面、手机和平板主题管理页。正文、表格、代码块、评论与表单可读，暗色表头修正后再次查看确认。

本地原图：`artifacts/theme-{id}-{home|article}-{375|768|1440}.png`、`themes-admin.png`、`themes-admin-375.png`、`themes-admin-768.png`；交付缩略图：`web/public/themes/{classic|paper|magazine|midnight}.png`。

## 本地预览保护与升级

停止预览后，使用 SQLite 备份 API 备份数据库，并复制附件与认证密钥到 `.local/backups/pre-v3-20260914-154846/`，生成 SHA-256 清单。显式执行 `--migrate`，将版本 2 升级至 3。

逐表比较旧字段和原有行：原账号、5 篇内容、5 条附件记录、站点设置和历史日志均保留，仅 schema 版本变化并新增经典主题状态。附件与密钥哈希一致，SQLite 完整性检查通过。重启后健康检查、原凭据登录、经典主题服务器 HTML 及四张缩略图文件均通过；没有向日常预览写入浏览器验收的示例内容。证明文件为 `.local/preview-v3-verification.json`，凭据与备份不进入源码版本管理。

## 复现与边界

```powershell
dotnet build --no-restore
python tests/run_matrix.py all
npm --prefix web run api:types
npm --prefix web run typecheck
npm --prefix web run build
docker build -f deploy/Dockerfile.api -t cms-api:local .
docker build -f deploy/Dockerfile.web -t cms-web:local .
python tests/docker_smoke.py
```

测试需要 Docker、项目 npm 依赖、Microsoft Edge 和 Python `cryptography`。不得把集成/浏览器测试目标改成日常站点。主题使用和升级操作见 [主题说明](themes.md) 与 [部署说明](deployment.md)。

此次浏览器验收为 Edge 与模拟视口，未在 Safari、Firefox 或真实手机设备验收；不存在外部服务器上线结果。保留单 API 实例边界，未做多副本写协调或长期压力测试。预览是主题外观预览，不提供未发布内容预览；未增加主题上传、市场、任意模板执行、站点搭建器或跨库搬迁工具。
