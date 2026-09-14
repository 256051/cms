# 体验与审计补充验收

本页保留 schema 2 的历史验收结果。当前主题功能与 schema 3 结果见 [主题验收记录](themes-verification.md)。

日期：2026-09-14。范围为“未保存保护 → 全站 SEO → 加载与键盘交互 → 操作日志”。四项已实现并完成本地验收；没有部署到外部服务器。

[机器可读结果](improvements-results.json)记录本轮实际结果。四库运行编号为 `24c867fa45`，最终 Docker / 浏览器运行编号为 `docker-fc40c06e59`。原始日志位于本地 `artifacts/` 对应目录；首版基线保留在 [原验收记录](verification.md)。

## 实现内容

- **未保存保护**：文章、独立页面、设置、分类标签、菜单、成员、修改密码共用离开检查。后台使用原生页面导航，浏览器前进、后退、刷新、关闭标签都会触发保护；取消离开保留表单，取消退出不会注销会话。切换编辑对象、取消编辑同样检查。成功保存解除保护，失败保留输入；正在编辑的条目不能再次点击“编辑”误清状态。
- **全站 SEO**：站点名称用于全局标题后缀，站点介绍与关键词由公开页面继承；文章有摘要时优先使用摘要，没有摘要时使用站点介绍。首页、文章、独立页面、分类、标签、搜索的服务器 HTML 均检查标题和描述。分类、标签加入 sitemap；搜索与后台维持 noindex，原有 canonical、robots 保留。设置实时读取，不开启页面缓存。
- **加载与键盘交互**：后台统计、内容、附件、分类标签、菜单、评论、设置、成员、日志、预览与附件选择器具有加载或失败重试反馈，故障不显示为“没有数据”。错误提示包含服务器返回的追踪编号；旧请求不能覆盖新筛选结果。手机菜单限制焦点范围、支持 Tab 循环与 Escape、关闭后恢复按钮焦点，关闭状态下菜单不可聚焦；较矮屏幕可滚动菜单。
- **操作日志**：每个成功的业务写入保存对象类型、ID、当时名称，与业务更新处于同一事务；改名或删除对象不改变既有日志。包括内容发布/下架、附件、分类标签、菜单、评论、账号、密码变更、设置及初始化，不记录密码、哈希或正文。后台展示对象标识，接口类型已从新版 OpenAPI 重新生成。

主要文件：`web/src/components/admin/unsaved.ts`、`AdminApp.tsx`、`ContentEditor.tsx`、`ContentManager.tsx`、`Management.tsx`、`shared.tsx`、`AssetSelector.tsx`；`web/src/app/layout.tsx`、`[archive]/[slug]/page.tsx`、`sitemap.ts`；`src/Cms.Data/Entities.cs`、`CmsRepository.cs` 及四个业务 Service。

## 实际验证

### 构建与契约

.NET 构建通过，0 警告、0 错误；前端类型检查、生产构建通过；API 与 Next.js Docker 镜像构建通过。OpenAPI 已导出并重新生成 TypeScript 类型。未新增或升级运行时依赖。

### 四数据库：69 组通过

SQLite 18 组；PostgreSQL、MySQL、SQL Server 各 17 组。引擎范围与首版验收一致：SQLite 随项目引擎、PostgreSQL 17、MySQL 8.4、SQL Server 2022 Developer。

复用首版登录、CSRF、权限、并发、发布隔离、附件引用、评论审核、事务回滚、中文长文本、唯一约束、重启、备份恢复及 Consul 检查。新增两类检查分别在四库执行：

1. 构造旧版 schema 1、旧日志和中文内容；普通 API 启动保持 schema 1，就绪检查返回 503；显式升级至 2，重复升级不更改数据，旧日志与正文、版本号仍保留。
2. 新日志均具有操作对象；内容、附件、成员等对象删除后，日志仍保留相应标识与名称；日志不包含密码及正文。

“组”表示一组验收场景，不等于 69 个独立单元测试。

### 浏览器及 Docker：通过

使用 Windows Microsoft Edge 无头浏览器访问独立 Docker HTTPS 站点，**2 个 Playwright 综合用例通过，最终耗时 23.2 秒**。测试使用随机端口、随机凭据和独立数据库/附件/密钥卷，不写入日常预览数据。

- 原有登录、富文本、上传、附件库插图、保存草稿、发布、失败重试、前台正文、草稿隔离与手机布局流程仍通过。
- 取消后退、前进、刷新、关闭标签、侧栏跳转，验证输入保留；确认放弃后才切换页面。设置、分类标签、菜单、成员、密码表单均覆盖；切换分类标签和取消编辑也覆盖。
- 注入一次设置保存失败，验证追踪编号、输入与离开保护仍保留，再保存成功；保存后导航无需重复确认。
- 修改站点名称、介绍、关键词，经六类公开页面的原始 HTML 核对标题、描述、关键词，以及 canonical / 搜索 noindex；核对分类与标签 sitemap。
- 注入账号读取失败，以及八类后台页面的延迟和 503，验证加载提示、追踪编号、没有错误的空状态、重试恢复。
- 在 375 × 667 视口验证菜单焦点、Tab / Shift+Tab 循环、Escape 关闭、焦点恢复和隐藏菜单不可聚焦；日志页显示操作对象；取消退出后会话仍有效，确认退出后失效。
- HTTPS 同域代理、生产安全 Cookie、容器重启后数据库、图片字节与已登录会话保持有效。

中途发现并修正了测试脚本对有初始值的 textarea 的定位，以及把 Next.js 无障碍播报区域误算作错误提示的问题；最终结果只计最终通过的运行。

## 数据库升级与本地预览

当前 schema 为 **2**。版本 1 → 2 只添加日志的 `TargetType`、`TargetId`、`TargetName` 字段；历史记录不猜测补填，在界面明确显示“旧版记录未保存操作对象”。普通生产启动仍不改表。按 [部署说明](deployment.md) 停止服务、备份，再显式执行 `--migrate`；已完成四库升级和重复执行验证。

本地预览已停止后备份至 `.local/backups/pre-v2-20260914-134853/`，包含完整 SQLite 数据库、附件和认证密钥。升级后与备份逐表比较原有字段和行，仅 schema 版本变化；附件和密钥文件 SHA-256 一致。现有账号、服务器 HTML 标题及新日志读取已在重启后确认。详细记录保存在 `.local/preview-v2-verification.json`，备份及本地凭据不进入源码版本管理。

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

测试工具需要 Docker、项目 npm 依赖、Microsoft Edge 和 Python `cryptography`。浏览器测试没有提供目标与凭据时拒绝运行，避免误写用户正在使用的预览站点。

未保存保护使用浏览器原生确认框，文案由浏览器决定；手机系统强制结束进程等情况不能保证触发提醒，没有增加自动保存或断电恢复功能。此次浏览器验证为 Edge 和不同视口，不代表已经在真实 iOS / Safari 设备验收。操作日志没有历史正文或差异恢复功能。首版的单 API 实例、普通关键词搜索及附件扫描等容量边界保持不变。
