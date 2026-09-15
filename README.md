# CMS

独立实现的单站点内容管理系统。.NET 10 + FreeSql 后端、Next.js + React + TypeScript 前端，简体中文界面。

项目仓库：[256051/cms](https://github.com/256051/cms)。项目原创代码采用 [MIT 许可证](LICENSE)，版权归 IT猫（itmao.club）所有；第三方依赖遵循各自许可证，详见下方依赖说明。

已实现文章与独立页面、草稿与发布版本隔离、富文本与图片、分类标签、附件引用保护、审核评论、菜单、站点设置、管理员/编辑权限、操作日志，以及服务端渲染的前台和 SEO 页面。后台“主题外观”提供经典博客、极简阅读、杂志资讯、暗色科技以及 Fuwari、Retypeset、Cactus 三套社区适配主题，共七套，支持独立配置、私密预览和版本冲突保护。社区主题来源及完整许可见 [第三方主题声明](THIRD_PARTY_NOTICES.md)。

## 本地启动

需要 .NET 10 SDK、Node.js 24 和 npm；默认本地开发用 SQLite，不需要安装数据库服务器。

在项目根目录执行：

```powershell
dotnet restore --locked-mode
dotnet build --no-restore
npm --prefix web ci
./scripts/dev.ps1 Initialize
```

初始化时输入自己的管理员账号和密码（至少 12 字符），没有内置默认密码。重复初始化不会重置已有账号或删除数据。

分别在两个终端运行：

```powershell
./scripts/dev.ps1 Api
```

```powershell
./scripts/dev.ps1 Web
```

访问前台 <http://localhost:3000>，管理后台 <http://localhost:3000/admin>。开发 API 监听 `127.0.0.1:5080`，浏览器经 Next.js 同域转发。开发数据在 `.local/dev.db`，附件在 `.local/uploads`，认证密钥在 `.local/keys`。

## 数据库与部署

通过后端 `Database:Type` 和 `Database:ConnectionString` 在启动时选用 `PostgreSQL`、`MySql`、`SqlServer` 或 `Sqlite`。默认部署为 PostgreSQL。四库均经过实际初始化、业务、事务、并发和恢复验证；版本与验证边界见 [验收记录](docs/verification.md)。

- [部署与配置](docs/deployment.md)：四库连接示例、Docker Compose、HTTPS、Consul、初始化与升级。
- [Docker 离线包](docs/docker-package.md)：Linux SQLite 镜像导入、初始账号、域名与 HTTPS 部署。
- [使用说明](docs/usage.md)：编辑发布、附件、审核、账号和设置。
- [丰富编辑器](docs/editor.md)：排版、图片集、音视频、表格、网页嵌入和分栏；[实际验收](docs/editor-verification.md)。
- [备份恢复与排查](docs/operations.md)：数据库、附件、密钥的配套恢复流程。
- [验收记录](docs/verification.md)：实际执行的检查、结果与复现命令。
- [体验与审计补充验收](docs/improvements-verification.md)：未保存保护、全站 SEO、加载与键盘交互、操作对象日志及 schema 2 升级。
- [主题使用说明](docs/themes.md)：七套主题、自定义、预览、启用、正文目录和恢复默认。
- [社区主题验收](docs/community-themes-verification.md)：Fuwari、Retypeset、Cactus 的四库与浏览器实际检查。
- [主题验收记录](docs/themes-verification.md)：schema 3、四库主题检查、浏览器与 Docker 验收。
- [多级菜单说明](docs/menus.md)：五种类型、父子菜单、打开方式、排序和资源引用规则。
- [菜单验收记录](docs/menus-verification.md)：schema 4 升级、四库及浏览器实际结果。
- [站点设置说明](docs/settings.md)：基本信息、图标、分页、搜索收录、评论和页脚。
- [站点设置验收](docs/settings-verification.md)：当前 schema 5 升级和实际测试结果。
- [登录保护](docs/login-security.md)：图形验证码、账号连续失败限制、IP 限流及单实例边界。
- [Agent 与通用发布 API](docs/integration-api.md)：访问令牌、分项权限、24 小时请求去重、远程发文和脚本示例。
- [集成接口验收](docs/integration-verification.md)：schema 6 升级、四库、令牌权限和 HTTPS 浏览器验收记录。
- [修改记录](CHANGELOG.md)：功能与依赖调整、部署影响及对应验证结果。

首版只支持 **一个 API 实例**。多管理员可同时操作；内容、主题、菜单和站点设置使用版本号防止覆盖。尚未实现多 API 实例之间的写锁协调。SQLite 还要求本地单文件存储。

## 代码结构与接口

```text
src/Cms.Api       HTTP、认证、CSRF、统一响应、配置与依赖注册
src/Cms.Services  内容、用户、站点和附件业务
src/Cms.Data      实体、Repository、FreeSql、事务与显式建库
web              Next.js 前台和 /admin 管理后台
tests            四数据库真实集成检查、Docker 验收
web/tests        Playwright 浏览器验收
deploy           镜像与同域反向代理配置
```

调用链为 `Controller → Service → Repository → FreeSql`，没有其他 ORM。Autofac 注册服务，Mapster 映射安全账号输出并在启动时校验映射配置，FluentValidation 校验内容输入，HtmlSanitizer 在后端净化富文本。

接口分为 `/api/v1/auth`、`/api/v1/admin`、`/api/v1/public`。统一响应字段是 `code`、`message`、`data`、`traceId`；分页提供 `items`、`total`、`page`、`pageSize`，错误同时保留 HTTP 状态。

管理接口文档为 API 的 `/openapi/v1.json`，需要管理员 Cookie。已交付 [OpenAPI 快照](docs/openapi.json)，前端类型由该契约生成：

```powershell
npm --prefix web run api:types
npm --prefix web run typecheck
```

更新接口后先运行集成检查刷新 OpenAPI 快照，再重新生成类型。JSON 文档可导入支持 OpenAPI 的工具。反向代理默认不公开 `/openapi`；直接在受控 API 连接中获取即可。

## 当前边界

- 单站点、两种固定角色；不包含访客注册、旧站迁移、主题/插件市场、多租户、商城和页面搭建器。
- Redis、RabbitMQ/CAP 没有接入，不是启动依赖。Consul 可选；启用后读取失败会终止启动。
- 搜索为标题、摘要关键词查询；正文最多 500,000 字符。附件引用检查扫描站点内容，适用于首版中小型站点。
- 已发布 URL 固定；重新发布会替换公开快照，不提供历史版本回滚或跨数据库数据迁移。
- 对象映射使用 Mapster 10.0.12，采用 [MIT 许可证](https://github.com/MapsterMapper/Mapster/blob/v10.0.12/LICENSE)，无需配置映射库许可证密钥。

本仓库没有复制 Halo 源码，不声明兼容其主题、插件或数据库。交付范围为源码与本地验收，没有部署到外部服务器。
