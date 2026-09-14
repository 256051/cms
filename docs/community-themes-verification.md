# 第一批社区主题验收

日期：2026-09-15。新增 `fuwari`、`retypeset`、`cactus`，目录总计七套。采用原作固定提交，详见 [来源记录](theme-upstreams.json) 和 [完整许可](../THIRD_PARTY_NOTICES.md)。

## 实现范围

- Fuwari 圆角卡片、站点介绍侧栏、分类标签与右侧封面；Retypeset 侧边导航、文字列表与系统衬线阅读；Cactus 深色等宽日期列表。
- 所有 CMS 公开路由沿用服务端内容读取、净化正文、SEO、搜索、分页和评论；新主题提供渐进增强的二、三级标题目录。
- 继续使用已有三项外观设置、私密预览、CSRF、版本检测及原子保存日志；无 API 契约或 schema 变更，无新增依赖。
- 主题缩略图来自独立测试站点的实际页面；原作链接和完整许可随源码与 web 镜像交付。

## 构建与数据库

- `dotnet build -c Release --no-restore`：通过，0 警告、0 错误。
- `npm --prefix web run typecheck`：通过。
- API、web Docker 镜像构建及 web 生产构建：通过。
- `CMS_TEST_CONFIGURATION=Release` 下执行 `python tests/run_matrix.py all`：SQLite 45、PostgreSQL 44、MySQL 44、SQL Server 44 组，共 **177 组通过**。原始记录：`artifacts/74a37d0ae4/results.json`。
- 覆盖七套主题的管理员权限、CSRF、输入白名单、只读预览、独立配置、恢复默认、公开接口隔离、过期版本冲突和并发启用日志；同时执行原有内容、媒体、菜单、设置、Agent API、事务及升级检查。

## 浏览器与镜像

- 最终 web 镜像在独立 Docker HTTPS 站点运行 **9 项 Playwright 流程，全部通过**。浏览器为 Edge，窗口宽度覆盖 375、768、1440 像素。日志：`artifacts/docker-8f7d2faf39/browser.log`。
- 最终复测重启 API、web 和 HTTPS 网关后，已登录会话、七套主题配置、菜单和站点设置均保持有效且一致；结果：`artifacts/docker-8f7d2faf39/results.json`。
- 七套主题逐一检查首页、文章、独立页面、分类标签、关键词搜索与后续分页；检查正文 HTML、标题、描述、canonical、搜索 noindex、私密预览、配置恢复、保存错误、版本冲突、空结果和颜色对比度。
- 新三套主题检查未保存预览与访客外观隔离、重复标题独立锚点、无标题时隐藏目录、折叠/键盘操作、关闭 JavaScript 仍有正文、跳转链接对比度及 Fuwari 手机阅读顺序。
- 七套主题均通过多级菜单键盘展开/收起、子项可见范围，以及丰富编辑器的图片集、音视频、表格、代码与分栏展示检查。
- 缩略图经首次真实页面生成后重新构建 web 镜像；最终普通验收检查七张后台图片均可加载。镜像包含 `THIRD_PARTY_NOTICES.md` 与三个完整 MIT 许可，已检查文件及 SHA-256。
- 初次截图验收为 8/9，通过日志位于 `artifacts/docker-4584ce84bd/browser.log`；原脚本假设标题不会被下拉菜单覆盖，已改为点击可见页脚验证外部点击收起。后续复测 `docker-1cc1a1b44b` 发现 Cactus 左侧导航沿用右对齐菜单导致平板宽度下偏出左边界，已修正定位并补充边界断言。最终记录采用 `docker-8f7d2faf39`，不将前两次失败标成通过。
- 初次 HTTPS 脚本已执行安全 Cookie、发布媒体和 Agent 接口检查，后续使用独立 Compose HTTPS 浏览器与重启复测，不重复执行四库数据检查。

## 本地预览与数据保留

- 更新前停止本项目预览进程，备份数据库、附件、认证密钥和原凭据；构建后逐表比对已有字段及每行内容，并比对附件和密钥文件哈希。未执行建库、迁移或密码重置。
- 首次备份：`.local/backups/themes-20260915-001401`；最终菜单修复更新前备份：`.local/backups/themes-20260915-001709`。结果分别在对应的 `artifacts/themes-20260915-001401/results.json` 与 `artifacts/themes-20260915-001709/results.json`。
- schema 保持 6；原有 **1 个管理员、23 篇内容、28 个附件、1 个 API 令牌**及其他业务记录保留，当前主题仍为 `classic`。
- 使用原管理员通过本地登录验证码进入后台，确认七张缩略图加载，三套主题可使用站点现有文章进行私密预览；读取前后主题状态与文章列表相同，没有保存主题或内容。记录：`artifacts/themes-local-browser.json`，截图：`artifacts/themes-local-admin.png` 与 `artifacts/themes-local-{themeId}.png`。
- 本地前台：`http://localhost:3000`；主题管理：`http://localhost:3000/admin/themes`。

## 复现

1. 使用锁定依赖构建 .NET 项目及 `deploy/Dockerfile.api`、`deploy/Dockerfile.web`，镜像分别命名 `cms-api:local`、`cms-web:local`。
2. 执行 `python tests/run_matrix.py all` 检查四库；脚本创建独立数据库，不要改接日常预览库。
3. 执行 `python tests/docker_smoke.py` 创建独立 HTTPS 站点，运行 HTTP、Playwright 和重启持久化检查。
4. 重生成缩略图的步骤见 [主题说明](themes.md)。修改图片后重新构建 web 镜像并执行普通浏览器验收，确认最终镜像包含图片。

## 边界

这是三套原作风格的 CMS 适配，不是原作完整功能或 Halo 兼容运行时。使用系统字体，不携带上游字体、头像、演示文章、统计服务或第三方评论 SDK。Fuwari 采用无横幅布局；原作图库、瞬间、音乐、数学引擎和全部动画不在本批范围。

文章正文在关闭 JavaScript 时仍可阅读，自动目录需要浏览器 JavaScript；目录不是服务端生成的目录数据。主题配置保持现有单 API 实例部署边界。本次验收不包含外部服务器上线。
