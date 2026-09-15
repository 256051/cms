# 修改记录

## 2026-09-15 — Docker 离线部署包

- 增加 `scripts/package-docker.py`，构建并导出版本化 API、web 和 Nginx 镜像，默认 Linux amd64 + SQLite；发布包携带 Compose、说明、许可、来源版本及 SHA-256 校验。
- 部署时直接导入镜像，无需在服务器编译；管理员凭据和证书由部署方提供，SQLite、附件和认证密钥统一保存在持久卷，不打包本地数据。
- 增加 [离线部署说明](docs/docker-package.md)，同步修正文档中的 schema 版本与主题数量。
- 补充 [宿主机 Nginx 转发方案](docs/host-nginx.md)：仅在回环地址暴露 API/前端端口，由现有 Nginx 终止 HTTPS 并传递真实客户端 IP，无需重新构建镜像。

## 2026-09-15 — 第一批社区主题适配

- 新增 Fuwari、Retypeset、Cactus 三套内置主题：分别提供圆角卡片与侧栏、书籍式阅读与左侧导航、深色等宽日期列表；原有四套主题继续可用。
- 接入已有主题配置、管理员预览、保存启用、版本冲突和操作日志；共享文章、独立页面、分类标签、搜索、分页、评论及丰富正文展示。
- 新主题增加可折叠文章目录与独立的手机布局，正文继续服务端输出；后台增加真实页面缩略图和原作链接。
- 从三套 MIT 原作的固定提交适配，保留完整许可与文件来源；不引入原作运行时、字体、头像或演示文章，不增加依赖。
- 当前 schema 6 无结构变更，不需要额外升级或转换已有内容；更新 API 和 web 后重启即可。
- 来源见 [第三方主题声明](THIRD_PARTY_NOTICES.md)，操作及实际结果见 [主题说明](docs/themes.md) 和 [社区主题验收记录](docs/community-themes-verification.md)。

## 2026-09-14 — 丰富内容编辑器

- 新增接近 Halo 操作方式的分组工具栏与插入菜单，支持 `/` 快捷插入、撤销重做、清除格式、字体字号、颜色高亮、下划线、上下标、对齐与行距；可收起发布设置扩大写作区。
- 新增图片说明/尺寸/对齐、粘贴与拖入上传、附件插入、图片集、视频、音频、受限 HTTPS 网页嵌入、二/三分栏、代码语言、表格行列及合并拆分操作。
- 后端共用 HTML 允许列表净化和媒体类型验证；附件新增 MP4、WebM、MP3、WAV，并提供 HTTP Range；草稿隔离、乐观版本、CSRF 和附件引用保护保持生效。
- 四套主题及预览共用正文样式，手机自动调整分栏；保存失败保留输入，支持 Ctrl/⌘+S 保存草稿和已有未保存离开保护。
- 继续使用 Tiptap 3.31.3 的 MIT 扩展，无付费编辑器或 Halo Vue 插件依赖；不变更数据库结构，schema 仍为 6。现有内容无需转换或重新发布。
- 功能、边界及实际结果见 [编辑器说明](docs/editor.md) 和 [编辑器验收记录](docs/editor-verification.md)。

## 2026-09-14 — Agent 通用发布 API 与访问令牌

- 后台新增“API 访问令牌”：管理员创建、选择关联账号和权限、设置到期时间、查看最近使用并撤销；完整令牌只显示一次。
- 新增 `/api/v1/integration` 内容查询、分类标签、附件上传、创建/更新草稿及发布接口；使用独立 Bearer 认证和分项权限，保留网页 Cookie、验证码及 CSRF 防护。
- 写入通过 `Idempotency-Key` 提供 24 小时去重，业务结果、成功日志和去重记录同事务提交；重试、并发调用及重启后不重复执行成功写入。
- 增加按令牌限流、关联账号启停检查、明确的鉴权/版本/去重错误及令牌归属日志；复用现有 HTML 净化、上传校验、草稿隔离和版本控制。
- schema 5 → 6 显式新增令牌、去重记录及日志归属字段，保留已有内容、账号和站点配置。升级需先备份、停写，更新 API/web 后执行 `--migrate`。
- 更新 OpenAPI、TypeScript 契约、调用文档及 `scripts/publish-article.py` 示例，继续使用 FreeSql，无新增 NuGet/npm 依赖。
- 测试与部署范围见 [本次验收记录](docs/integration-verification.md)。

## 2026-09-14 — 使用 Mapster 替换 AutoMapper

### 修改内容

- 将 AutoMapper 16.2.0 替换为 Mapster 10.0.12（MIT），更新后端及检查项目的 NuGet 锁定文件。
- 保留 `CmsUser → UserView` 账号映射与现有依赖注入方式，公开字段仍为 `id`、`username`、`displayName`、`role`、`enabled`，不返回密码哈希和安全标识。
- 映射配置使用独立实例，要求显式注册映射与目标字段来源；在启动时校验并编译，配置错误会阻止启动。
- 删除启动代码、Compose、环境变量示例和部署文档中的 AutoMapper 许可证配置。
- 显式固定 `Microsoft.IdentityModel.JsonWebTokens` 为原来已解析的 8.14.0，避免移除 AutoMapper 后，SQL Server 驱动共享的 IdentityModel 依赖退回较低版本。
- 增加账号输出回归检查，并在 README 中增加本修改记录入口。

### 部署影响

- 更新后端并重启即可，无需数据库升级；schema 仍为 5，API 契约和前端代码不变。
- 原部署中的 `AutoMapper:LicenseKey` / `AutoMapper__LicenseKey` / `AUTOMAPPER_LICENSE_KEY` 已不再读取，可从本地配置、Consul 或部署环境中删除。
- 本地预览更新前已备份数据库、附件和认证密钥；更新后核对原数据保留，并验证原管理员可经前端代理登录。

### 实际验证

- `dotnet restore --locked-mode`：通过。
- `dotnet build --no-restore`：通过，0 警告、0 错误。
- `dotnet publish src/Cms.Api/Cms.Api.csproj -c Release --no-restore -o artifacts/mapster-publish`：通过；发布目录与运行依赖中已无 AutoMapper，包含 Mapster。
- `dotnet tests/Cms.Checks/bin/Debug/net10.0/Cms.Checks.dll --login-protection`：通过，覆盖验证码生命周期、账号冷却时间及并发限制。
- `python tests/login_security.py`：独立 SQLite 数据库的 7 组 HTTP 检查通过，包含登录、当前用户、账号创建/编辑/列表的字段和值校验，以及 CSRF、验证码和暴力破解防护。结果编号：`login-b3988fb649`。
- `docker compose --env-file .env.example config --quiet`：通过。
- 本地预览数据库全部表记录、附件文件和认证密钥与更新前备份一致；API 就绪检查、登录页面与原账号登录通过。

本次没有重跑四数据库全量验收、浏览器视觉检查或 Docker HTTPS 验收，也没有进行性能基准测试；历史验收结果不代表本次重新执行。
