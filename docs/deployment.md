# 部署与配置

## 运行配置

后端优先级为 **环境变量 > Consul JSON > 发布目录中的 appsettings.json**。环境变量用双下划线，例如 `Database__Type`。部署参数只在启动时读取，修改后重启；站点名称、Logo、介绍和 SEO 设置是当前数据库里的业务数据。

主要配置：

- `Database:Type`、`Database:ConnectionString`：唯一数据库及其连接串。
- `Storage:Path`：附件目录；`Storage:MaxBytes`：单文件上限，默认 10 MiB，最大 50 MiB。
- `Security:KeyPath`：ASP.NET Core Data Protection 密钥目录，必须持久化。
- `Setup:Username`、`Setup:Password`：仅显式初始化首个管理员时需要。
- `Consul:Enabled`、`Consul:Address`、`Consul:Key`、`Consul:Token`：Consul 连接；默认关闭。
- `ForwardedHeaders:KnownNetworks`：可信反向代理网段数组；不要配置任意互联网网段。
- `Logging:LogLevel`：ASP.NET Core 标准日志等级。

前端仅需 `API_INTERNAL_URL`（容器内 API 地址）和 `SITE_URL`（公开站点源地址，影响 canonical、sitemap、robots）。前端不接收数据库连接串。

## 四种数据库

以下示例中的密码必须自行替换。各库使用独立的新 CMS 数据库；切换配置不会搬迁旧数据。

**PostgreSQL**（默认；验证镜像 `postgres:17-alpine`）：

```dotenv
DB_TYPE=PostgreSQL
DB_PASSWORD=your-own-password
DB_CONNECTION_STRING=Host=postgres;Port=5432;Database=cms;Username=cms;Password=your-own-password
```

**MySQL**（验证镜像 `mysql:8.4`）：

```dotenv
DB_TYPE=MySql
DB_PASSWORD=your-own-password
DB_ROOT_PASSWORD=separate-root-password
DB_CONNECTION_STRING=Server=mysql;Port=3306;Database=cms;User ID=cms;Password=your-own-password;SslMode=None;CharSet=utf8mb4
```

Compose 的 MySQL 实例使用 `utf8mb4` 和 `utf8mb4_bin`。示例无 TLS 的连接仅用于隔离容器网络；连接远程数据库时按服务器证书配置 TLS。长正文与发布 JSON 映射为 `longtext`。

**SQL Server**（验证 SQL Server 2022 Linux Developer；Compose 默认 Express）：

```dotenv
DB_TYPE=SqlServer
DB_PASSWORD=your-own-strong-SA-password
MSSQL_PID=Express
DB_CONNECTION_STRING=Server=sqlserver,1433;Database=cms;User Id=cms_app;Password=separate-app-password;Encrypt=True;TrustServerCertificate=True
```

先由数据库管理员建立 `cms` 数据库及专用登录 `cms_app`。首次初始化/升级账户需要此数据库的建表权限；日常运行使用仅能访问 CMS 数据的账号。示例的 `TrustServerCertificate=True` 适用于本地自签名实例，远程正式实例应使用可信证书并设为 False。

可通过以下入口执行建库脚本，脚本中仅操作 `cms` 和对应新登录，不复用其他业务数据库：

```powershell
docker compose --profile sqlserver exec sqlserver bash -lc 'SQLCMDPASSWORD="$MSSQL_SA_PASSWORD" /opt/mssql-tools18/bin/sqlcmd -S localhost -U sa -C -b'
```

交互示例（请自行提供强密码）：

```sql
CREATE DATABASE cms;
GO
CREATE LOGIN cms_app WITH PASSWORD = 'replace-with-your-own-strong-password';
GO
USE cms;
CREATE USER cms_app FOR LOGIN cms_app;
ALTER ROLE db_owner ADD MEMBER cms_app;
GO
```

此示例授予初始化所需权限。初始化后可由 DBA 收紧为运行所需权限；升级时临时使用专门的升级身份。测试使用 Developer 版不代表生产许可，实际选择由部署方确定。

**SQLite**（验证随 SQLitePCLRaw.bundle_e_sqlite3 3.0.5 打包的引擎）：

```dotenv
DB_TYPE=Sqlite
DB_CONNECTION_STRING=Data Source=/data/cms.db
```

无需数据库服务。数据库文件、附件和密钥均在 `cms-data` 卷中。只允许一个 API 实例，不要把 SQLite 文件放在多主机共享写入的网络盘上。

## Docker 首次启动

Docker Compose 2.24.4 或更新版本，Linux 容器。所有命令均在仓库根目录执行。

1. 复制 `.env.example` 为 `.env`，填写所选库配置、首个管理员凭据和 `SITE_URL`。为纯本地 HTTP 验收设置 `CMS_ENVIRONMENT=Development`、`SITE_URL=http://localhost:8088`。
2. 执行 `docker compose build api web`。
3. 启动所选数据库：`docker compose --profile postgres up -d postgres`；MySQL 改用 `--profile mysql ... mysql`，SQL Server 改用 `--profile sqlserver ... sqlserver`。SQLite 跳过此步。
4. 等待数据库就绪。PostgreSQL 用 `docker compose exec postgres pg_isready -U cms -d cms`；MySQL/SQL Server 查看各自日志并测试登录。SQL Server 此时先建库和专用账号。
5. 执行 `docker compose run --rm --no-deps api --initialize`。
6. 清空 `.env` 中的 `SETUP_PASSWORD`、`SETUP_USERNAME`，运行 `docker compose up -d api web gateway`。
7. 检查 `http://localhost:8088/health/ready` 返回 200，进入 `/admin` 登录。

正常服务启动从不自动改表。`--initialize` 建立当前版本的表及第一个管理员；`--migrate` 显式执行版本检查和升级，不会创建账号。当前 schema 版本为 **5**：

- **1 → 2**：操作日志增加对象类型、对象 ID 和名称三列，保留历史记录及其他业务数据。旧日志显示“旧版记录未保存操作对象”，不会猜测补填。
- **2 → 3**：新增 `cms_theme` 单条主题状态记录，默认启用经典博客。各主题设置序列化为跨库长文本 JSON；不修改已有内容、账号和站点设置。
- **3 → 4**：扩展 `cms_menu` 的上级、类型、资源引用、打开方式和版本号，名称长度扩展至 200。旧菜单补为顶级自定义链接、当前窗口，原名称、地址和排序保留。

- **4 → 5**：扩展 `cms_settings` 的副标题、浏览器图标、内容语言、四类列表条数、搜索收录、评论规则、页脚和版本号；保留旧名称、介绍、Logo 与关键词。新增字段默认中文、每页 12 条、启用评论并审核、允许访客评论及搜索收录。

旧版本逐级升级，重复执行为空操作，高于程序版本则拒绝降级。初始化/升级时应停止 API，避免并行执行；版本 1、2、3 或 4 数据库直接启动新版 API 时就绪检查返回 503，必须先升级。菜单、主题和站点设置都属于数据库业务数据，不是部署配置，不需要新增 Consul 键。

数据库 Provider 在进程启动时确定，修改 `DB_TYPE` 或连接字符串后需要重新创建容器。首版没有跨库迁移工具。不要把初始化入口指向其他系统的数据库。

## HTTPS

正式配置使用 `CMS_ENVIRONMENT=Production`、真实 `SITE_URL=https://your-domain`。认证与 CSRF Cookie 在此模式下为 Secure，纯 HTTP 不适用。

将证书链 `fullchain.pem` 和私钥 `privkey.pem` 放入主机目录，在 `.env` 设置 `TLS_DIRECTORY`，再运行：

```powershell
docker compose -f compose.yaml -f compose.https.yaml up -d api web gateway
```

HTTPS 入口默认 443；原 HTTP 入口会重定向到 HTTPS。对外监听时设置 `CMS_BIND_ADDRESS=0.0.0.0`，并按主机防火墙配置端口。默认只绑定回环地址。若需标准 80 端口，可设置 `CMS_PORT=80`。

Nginx 负责同域 `/api/`、`/media/` 转发，Next.js 负责页面；内部服务无主机暴露端口。Compose 使用独立网段 `172.30.46.0/24`，与已有网络冲突时修改 `CMS_NETWORK_SUBNET`。该值同时决定后端信任的代理网段。

API 和 Next.js 镜像均以非 root 用户运行；`cms-data` 卷持久保存上传文件和密钥。HTTPS 私钥只挂载给 Nginx。证书轮换后重启 gateway。

登录验证码和失败计数在单个 API 进程内保存，重启会清除；多实例上线前需共享原子计数及验证码消费状态。不要放开内部 API 的公网入口或把所有地址设为可信代理，否则会破坏按真实客户端 IP 限流。规则和验证入口见 [登录保护说明](login-security.md)。

## Consul

在 KV 键 `cms/config` 存一份合法 JSON，例如：

```json
{
  "Database": {
    "Type": "PostgreSQL",
    "ConnectionString": "Host=db;Database=cms;Username=cms;Password=your-own-password"
  },
  "Storage": { "MaxBytes": 10485760 },
  "Logging": { "LogLevel": { "Default": "Information" } }
}
```

通过本地配置或环境设置 `Consul__Enabled=true`、`Consul__Address`、`Consul__Key`，启用 ACL 时传入 `Consul__Token`。Consul 启用开关和访问凭据必须在读取 Consul 前提供。使用原生 HTTP API 读取，不依赖其他配置 SDK；不会订阅动态变更。

读取失败、缺少 KV 或 JSON 无效会明确使启动失败，不会静默回退。成功后重新加载环境变量，保证环境值优先。Compose 默认显式提供数据库环境变量，所以这两个值会覆盖 Consul；如要让 Consul 独占数据库配置，应在自有 Compose 覆盖文件中用 `!reset null` 移除 API 的 `Database__Type` 与 `Database__ConnectionString` 环境项。

## 升级

停止 gateway/web/api，备份数据库、附件和密钥。构建新镜像后显式执行 `docker compose run --rm --no-deps api --migrate`，检查成功后启动服务并验证健康、登录、内容、主题、菜单和操作日志。当前版本为 schema 6，新增访问令牌、请求去重记录和日志的令牌归属；5 → 6 保留全部已有设置。各历史版本逐级升级、新库初始化和重复执行的实际结果见 [集成接口验收](integration-verification.md)。DDL 中途失败时保持当前步骤开始时的版本号，排查后可以重新执行。未来每个数据库版本变更必须新增有编号、可验证的步骤，不依赖生产启动时自动同步表结构。恢复旧镜像需要同时恢复与其匹配的数据库备份，不能直接降级新数据库。

四套主题及缩略图随 Next.js 镜像发布；升级主题功能时同时更新 API 和 web 镜像。没有第三方模板加载目录。主题管理入口与操作说明见 [主题使用说明](themes.md)。
