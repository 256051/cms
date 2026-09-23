# CMS

新增备份文件与保留策略、文章导入导出、评论回复和批量审核、管理员应急恢复、通知测试、操作记录筛选及咨询专员，见 [运营功能完善](docs/operations-enhancements.md)。

新增自动保存与恢复、历史版本和回收站、定时发布、批量管理、咨询跟进、正文搜索与 RSS、附件引用查询、备份与明细维护，见 [功能与使用说明](docs/editorial-enhancements.md)。

独立实现的单站点内容管理系统。.NET 10 + FreeSql 后端、Next.js + React + TypeScript 前端，简体中文界面。

示例网站：[https://itmao.club](https://itmao.club)。

项目仓库：[256051/cms](https://github.com/256051/cms)。项目原创代码采用 [MIT 许可证](LICENSE)，版权归 IT猫（itmao.club）所有；第三方依赖遵循各自许可证，详见下方依赖说明。

已实现文章与独立页面、草稿与发布版本隔离、富文本与图片、分类标签、附件引用保护、审核评论、菜单、站点设置、管理员/编辑权限、操作日志，以及服务端渲染的前台和 SEO 页面。后台“主题外观”提供经典博客、极简阅读、杂志资讯、暗色科技，以及 Fuwari、Retypeset、Cactus、Chirpy、Oranges、Aircloud、Stellar、Halorum、Aurora、iEmo、Clarity，共十五套，支持独立配置、私密预览和版本冲突保护。社区主题为博客布局适配，来源及完整许可见 [第三方主题声明](THIRD_PARTY_NOTICES.md)。

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

## Docker 打包

打包机器需要 **Git、Python 3.11+、Docker（Linux 容器模式）**，构建时需要联网下载基础镜像和依赖。.NET 和 Node.js 编译在容器内完成。先提交需要发布的应用源码，再在仓库根目录执行：

```sh
# 默认生成 Linux amd64 离线包
python scripts/package-docker.py

# ARM64 服务器可选择此项，发布前需另做 ARM64 实机验收
python scripts/package-docker.py --platform linux/arm64
```

上面两条按目标架构选择一条。脚本会拒绝 `src/`、`web/` 或两个 Dockerfile 中未提交的改动，版本号使用日期和 Git 提交号。产物位于 `artifacts/releases/`：

- `cms-<版本>-linux-amd64-sqlite.tar.gz`：离线部署包。
- 同名 `.tar.gz.sha256`：压缩包校验文件。
- 同名目录：已展开的发布文件，包括 `images.tar`、Compose 配置、`release.json` 和使用文档。

包内三个镜像分别为 `cms-api`（后端）、`cms-web`（前台与管理后台）和 `cms-gateway`（Nginx 网关）。默认 SQLite，不包含本地数据库、文章、账号、附件或认证密钥，也不会自动推送镜像仓库。服务器已有 Nginx / 宝塔时只需启动 `api`、`web`。

## Docker 部署

服务器需要 **Docker Engine 和 Docker Compose 2.24.4+**，不需要安装 .NET SDK、Node.js 或 Python。下面的服务器命令以 Linux 为例。

### 1. 准备镜像与配置

**使用离线包**：把压缩包及校验文件上传到服务器，将下面的 `<版本>` 替换为实际版本；每一步成功后再继续。

```sh
sha256sum -c cms-<版本>-linux-amd64-sqlite.tar.gz.sha256
tar -xzf cms-<版本>-linux-amd64-sqlite.tar.gz
cd cms-<版本>-linux-amd64-sqlite
sha256sum -c SHA256SUMS
docker load -i images.tar
cp .env.example .env
chmod 600 .env
```

**从源码直接部署**：在仓库根目录准备 SQLite 配置并构建镜像，后面的初始化与启动步骤相同：

```sh
cp deploy/package.env.example .env
chmod 600 .env
docker compose -f compose.yaml build api web
```

编辑 `.env`，首次部署至少确认以下项目：

- `COMPOSE_PROJECT_NAME`：站点的固定项目名，决定数据卷名称，上线后保持不变。
- `SITE_URL`：自己网站的 HTTPS 地址，替换模板中的示例域名。
- `SETUP_USERNAME`、`SETUP_PASSWORD`：自定义管理员账号和密码；账号为 3–64 位小写字母、数字或连字符，密码至少 12 字符。没有默认管理员密码。
- `DB_TYPE=Sqlite`、`DB_CONNECTION_STRING=Data Source=/data/cms.db`：使用内置 SQLite；其他数据库的连接方式见 [部署与配置](docs/deployment.md)。
- `CMS_ENVIRONMENT=Production`：正式站点使用 HTTPS；`CMS_NETWORK_SUBNET` 需与服务器已有 Docker 网络不冲突。

### 2. 首次初始化

仅新站执行，已有站点直接按下方“旧站升级”操作：

```sh
docker compose -f compose.yaml run --rm --no-deps api --initialize
```

成功后清空 `.env` 中的 `SETUP_USERNAME` 和 `SETUP_PASSWORD`，再选择以下一种方式启动。

### 3A. 服务器已有 Nginx / 宝塔

适用于 Nginx 和 Docker 位于同一台服务器。由原 Nginx 处理域名与 HTTPS，仅启动两个业务容器：

```sh
docker compose -f compose.yaml -f compose.host-nginx.yaml up -d api web
docker compose -f compose.yaml -f compose.host-nginx.yaml ps
curl --fail http://127.0.0.1:5080/health/ready
```

将 `/api/`、`/media/`、`/health/` 转发到 `127.0.0.1:5080`，其他请求转发到 `127.0.0.1:3000`。按 [Nginx 配置示例](deploy/nginx.host.conf) 修改域名和证书路径，并保留代理头设置；完整步骤见 [宿主机 Nginx 部署](docs/host-nginx.md)。本模式不启动 `gateway`，不使用 `compose.https.yaml`。如果之前已启动过包内网关，先执行 `docker compose -f compose.yaml stop gateway`。

### 3B. 使用包内 Nginx 网关

由 `cms-gateway` 处理 HTTPS。准备与 `SITE_URL` 域名匹配的 `fullchain.pem`、`privkey.pem`，放到 `tls/` 或自己的证书目录；在 `.env` 设置 `TLS_DIRECTORY` 指向该目录、`CMS_BIND_ADDRESS=0.0.0.0`、`CMS_PORT=80`，确认服务器 80 / 443 端口可用：

```sh
docker compose -f compose.yaml -f compose.https.yaml up -d api web gateway
docker compose -f compose.yaml -f compose.https.yaml ps
curl --fail https://你的域名/health/ready
```

包内不提供或自动申请证书。两种模式均在健康检查返回 200 后访问 `https://你的域名/admin`，使用首次初始化的账号登录。

### 4. 旧站升级与数据保留

1. 在原部署目录停止旧 API、前端（网关模式还需停止 `gateway`），备份数据库、附件、认证密钥和 `.env`。SQLite 在停止写入后备份整个 `cms-data` 卷，其他数据库还需单独备份数据库，详见 [备份恢复](docs/operations.md)。
2. 解压、校验新包并导入 `images.tar`，把原 `.env` 复制到新包目录，保留原项目名、数据库连接、数据卷及自定义端口。使用新包的 Compose 文件，其中已经引用新版本镜像。
3. 按原来的 3A 或 3B 方式启动。新版 API 会在接收请求前自动升级旧数据库；升级失败会退出，修复原因后可重启继续。数据库账号需具备迁移所需权限，无需再次初始化或手动执行 `--migrate`。
4. 检查健康状态、原文章和附件、后台访问统计及客户咨询；可用相同 Compose 参数执行 `logs --tail 100 api web` 查看启动日志。

**不要执行 `docker compose down -v`，它会删除数据卷。** 更换发布目录时必须保持原 `COMPOSE_PROJECT_NAME`，否则可能连接到新的空数据卷。需要回退时同时恢复旧镜像和对应的升级前数据备份。完整验证步骤见 [线上升级指南](docs/online-upgrade.md)。

## 数据库与部署

通过后端 `Database:Type` 和 `Database:ConnectionString` 在启动时选用 `PostgreSQL`、`MySql`、`SqlServer` 或 `Sqlite`。仓库的 `.env.example` 默认 PostgreSQL，离线包及上述 Docker 快速部署默认 SQLite。四库均经过实际初始化、业务、事务、并发和恢复验证；版本与验证边界见 [验收记录](docs/verification.md)。

- [部署与配置](docs/deployment.md)：四库连接示例、Docker Compose、HTTPS、Consul、初始化与升级。
- [Docker 离线包](docs/docker-package.md)：Linux SQLite 镜像导入、初始账号、域名与 HTTPS 部署。
- [宿主机 Nginx 部署](docs/host-nginx.md)：已有 Nginx / 宝塔时的端口和代理配置。
- [线上升级指南](docs/online-upgrade.md)：备份、换镜像、启动自动升级和线上功能验证。
- [使用说明](docs/usage.md)：编辑发布、附件、审核、账号和设置。
- [访问统计与客户咨询](docs/traffic.md)：文章阅读次数、访问趋势、访客轨迹、客户留资与跟进，以及 schema 7 升级。
- [访客 IP 与地区](docs/visitor-location.md)：最近访问 IP、逐次访问地区、离线 IPv4 / IPv6 解析，以及 schema 8 升级。
- [页面搭建与模板](docs/page-builder.md)：模块化页面、模板复用、手机预览、自定义首页、发布恢复，以及 schema 10 升级。
- [页面搭建与业务工具](docs/next-enhancements.md)：公共区块、撤销／重做、SEO 与旧地址、附件裁剪、产品／案例、咨询表单、通知配置，以及 schema 11–14 升级。
- [丰富编辑器](docs/editor.md)：排版、图片集、音视频、表格、网页嵌入和分栏；[实际验收](docs/editor-verification.md)。
- [备份恢复与排查](docs/operations.md)：数据库、附件、密钥的配套恢复流程。
- [验收记录](docs/verification.md)：实际执行的检查、结果与复现命令。
- [体验与审计补充验收](docs/improvements-verification.md)：未保存保护、全站 SEO、加载与键盘交互、操作对象日志及 schema 2 升级。
- [主题使用说明](docs/themes.md)：十五套主题、自定义、预览、启用、正文目录和恢复默认。
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

- 单站点、管理员／编辑／咨询专员三种固定角色；包含页面搭建、模板与公共区块、产品与案例，不包含访客注册、第三方旧站导入、主题／插件市场、多租户和商城。
- Redis、RabbitMQ/CAP 没有接入，不是启动依赖。Consul 可选；启用后读取失败会终止启动。
- 搜索覆盖已发布标题、摘要、正文与产品／案例业务字段；正文最多 500,000 字符。附件与公共区块引用检查扫描站点内容，适用于中小型站点。
- 支持历史恢复为草稿、回收站、定时发布、单页 SEO 与发布后旧链接跳转。逻辑备份支持四种来源数据库恢复到新库；不会在线覆盖已有数据。
- 通知、图片裁剪和可配置咨询表单见 [第二轮完善](docs/next-enhancements.md)。通知默认关闭，邮件与企业微信凭据由部署配置；图片自动压缩和发布审核仍未启用。
- 对象映射使用 Mapster 10.0.12，采用 [MIT 许可证](https://github.com/MapsterMapper/Mapster/blob/v10.0.12/LICENSE)，无需配置映射库许可证密钥。

本仓库没有复制 Halo 源码，不声明兼容其主题、插件或数据库。交付范围为源码与本地验收，没有部署到外部服务器。
