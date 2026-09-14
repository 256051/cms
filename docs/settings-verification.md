# 站点设置验收记录

日期：2026-09-14，schema **5**。按确认范围实现基础信息、文章显示、SEO、评论和纯文本页脚，使用说明见 [站点设置](settings.md)。本次没有增加通知、访客注册或自定义网址规则。

## 实现与构建

后台按五组编辑，完整设置以单一版本保存；前台四套主题共用名称、副标题、图标、语言、分页、搜索收录和评论规则。设置写入沿用 Controller → Service → Repository → FreeSql，管理员权限、CSRF、输入验证、并发冲突及同事务日志均在服务端执行。

新增数据库字段位于 `cms_settings`，显式逐级升级至 5；普通启动不修改表结构。没有新增或升级运行时依赖，没有新增部署配置或 Consul 键。接口契约及生成的 TypeScript 类型同步更新。

.NET 构建通过，0 警告、0 错误；前端类型检查、生产构建，以及 API 和前端 Docker 镜像构建通过。

主要实现：`src/Cms.Data/Entities.cs`、`CmsRepository.cs`、`src/Cms.Services/SiteService.cs`、`Contracts.cs`、`ContentService.cs`、`AssetService.cs`、`src/Cms.Api/Controllers.cs`、`Program.cs`；`web/src/components/admin/SettingsManager.tsx`、`AssetSelector.tsx`、`SiteShell.tsx`、`PublicPages.tsx`、`CommentSection.tsx`，以及根布局、robots、sitemap 和样式。

## 四库：129 组通过

最终运行 **`37411d65f4`**，SQLite **33** 组，PostgreSQL、MySQL、SQL Server 各 **32** 组。组为场景集合，不代表 129 个单独的单元测试。数据库为项目 SQLite 引擎、PostgreSQL 17、MySQL 8.4、SQL Server 2022 Developer。

复用原有内容、权限、附件、评论、主题、菜单、审计和备份恢复检查，新增：

1. 未登录、编辑越权、缺少 CSRF、非法文本、空值、非法语言、无效图标、越界/小数条数、非法版本均拒绝，失败不改设置和日志。
2. 副标题、内容语言、页脚、收录规则和图标持久化；图标启用前不可公开读取，启用后可读取，引用中禁止删除；四类条数与实际分页一致。
3. 两个并发保存同一版本只有一个成功，另一个返回 409；旧版本不能覆盖；成功日志记录站点对象。真实数据库事务同时回滚设置内容、版本与审计。
4. 全局关闭评论时提交被拒绝且公开列表为空，后台原评论保留；审核策略仅影响新评论；登录限制在后端生效，账号署名不能通过提交字段冒充；独立页面也可评论。
5. schema 1、2、3、4 分别升级至 5、重复升级、新库重复初始化；冻结旧设置映射验证名称、介绍、Logo、关键词、菜单版本和主题版本保留，新设置默认值正确。
6. 旧库正常启动就绪为 503、结构不变；重启与恢复到独立数据库后，全部设置（含非默认值）、主题和菜单状态一致；配套附件及原会话可用。

SQLite 额外复验 Consul 优先级及启用后读取失败的启动行为。测试源：`tests/site_settings.py`、`tests/run_matrix.py`、`tests/Cms.Checks/Program.cs`。

## 浏览器与 Docker HTTPS

最终运行 **`docker-815b544744`**，**5 个综合用例通过，约 1.1 分钟**，其中设置用例 **12.2 秒**。使用 Windows Microsoft Edge 无头浏览器、独立 Docker 项目和随机端口/凭据，Production HTTPS；结果见 [机器可读记录](settings-results.json)，日志位于本地 `artifacts/docker-815b544744/`。

- 五组表单填写、分组键盘定位、连续保存后的版本更新；注入 503 和真实制造 409 冲突，表单保留输入；取消刷新保留未保存修改。
- 四套主题分别检查 375、768、1440 像素：名称、副标题、页脚、内容语言、首页条数生效，无横向溢出。分类、标签、关键词搜索和空搜索使用各自条数，下一页可访问。
- 首页、文章、分类、标签和搜索的原始 HTML 包含 Favicon 和禁收录标记；robots 提示禁止抓取，sitemap 不列出 URL；关闭开关后站点地图恢复。
- 访客评论等待审核；关闭审核后新评论即刻出现，原待审核评论仍隐藏；仅登录模式禁用访客表单，已登录账号署名和提交正常；关闭评论后前台隐藏整个评论区。
- 原内容编辑发布、菜单键盘操作、主题预览/配置、SEO、权限、未保存和加载恢复用例继续通过；HTTPS、Secure Cookie、附件、SSR，以及重启后的完整设置/主题/菜单和原会话通过。

截图复核查看了后台桌面和手机表单，以及经典桌面、极简平板、暗色手机、杂志手机的前台，副标题、分页和多行页脚显示一致。原图在 `artifacts/settings-admin-{375|768|1440}.png` 和 `settings-{classic|paper|magazine|midnight}-{375|768|1440}.png`。完整页面截图中的保存栏按拍摄时视口停留在可见底部，实际滚动时持续可用。

中间运行修正了测试定位方式：通过文本框的可访问名称定位已有介绍，并为取消刷新后的等待设置上限。应用保留输入的行为符合预期，以上统计仅计最终完成的运行。

## 本地预览保护

已停止服务，将数据库以 SQLite 备份 API 备份，同时复制附件和认证密钥，备份位置为 `.local/backups/pre-v5-20260914-170714/`，包含 SHA-256 清单。随后显式升级 4 → 5，并恢复本地预览。

逐表比较原字段和行，确认原 **1 个账号、5 篇内容、5 条附件、1 个菜单项、站点设置、40 条历史日志和所有主题配置**保留；用户当前 **paper（极简阅读）** 保持不变。附件与密钥哈希一致，SQLite 完整性检查通过。

重启后健康检查、原凭据登录、菜单/目标读取、原主题服务端 HTML 和全部原附件读取通过；原有记录一致，初始化可追加审计。证明文件为 `.local/preview-v5-verification.json`。独立验收的示例内容和配置没有写入日常预览，凭据与备份不进入源码管理。

## 复现与限制

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

测试要求 Docker、项目依赖、Microsoft Edge 及 Python `cryptography`；只在测试脚本创建的独立数据库和容器执行。保留单 API 实例写入边界，没有多副本协调、长期压力测试或外部服务器上线。浏览器验收为 Edge 模拟视口，不代表 Safari、Firefox 或真实手机验收。
