# 部署与配置

## 运行配置

后端优先级为 **环境变量 > Consul JSON > 发布目录中的 appsettings.json**。环境变量用双下划线，例如 `Database__Type`。部署参数只在启动时读取，修改后重启；站点名称、Logo、介绍和 SEO 设置是当前数据库里的业务数据。

主要配置：

- `Database:Type`、`Database:ConnectionString`：唯一数据库及其连接串。
- `Storage:Path`：附件目录；`Storage:MaxBytes`：单文件上限，默认 10 MiB，最大 50 MiB。
- `Security:KeyPath`：ASP.NET Core Data Protection 密钥目录，必须持久化。
- `Maintenance:BackupPath`：私有备份目录，容器默认 `/data/backups`。`BackupIntervalHours` 默认 24 小时，`BackupKeepCount` 默认 14 份，`BackupRetentionDays` 默认 30 天，`LowDiskSpaceMb` 默认 1024 MB；缺项时使用相同默认值，显式 0 可关闭定时备份或对应保留限制。`TrafficRetentionDays` 为访问明细保留天数，仍默认 0 关闭（启用后至少 90 天）。支持 Consul 和环境变量，详见 [运营功能完善](operations-enhancements.md)。
- `Setup:Username`、`Setup:Password`：仅显式初始化首个管理员时需要。
- `Consul:Enabled`、`Consul:Address`、`Consul:Key`、`Consul:Token`：Consul 连接；默认关闭。
- `ForwardedHeaders:KnownNetworks`：可信反向代理网段数组；不要配置任意互联网网段。
- `GeoIp:Directory`：离线 IP 地区库目录，默认发布目录下的 `GeoData`，内置 IPv4 / IPv6 库。支持 Consul JSON 和环境变量 `GeoIp__Directory`；自定义目录需同时提供两个兼容的 v3 xdb 文件。修改后重启，详情见 [访客 IP 与地区](visitor-location.md)。
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

API 正常启动时会先检查数据库版本，按已有编号步骤自动升级旧数据库，成功后才监听 HTTP；已是当前版本时不执行结构变更。`--initialize` 仍用于首次建站及创建第一个管理员；`--migrate` 保留为只升级数据库后退出的运维命令，不会创建账号。当前 schema 版本为 **14**：

- **1 → 2**：操作日志增加对象类型、对象 ID 和名称三列，保留历史记录及其他业务数据。旧日志显示“旧版记录未保存操作对象”，不会猜测补填。
- **2 → 3**：新增 `cms_theme` 单条主题状态记录，默认启用经典博客。各主题设置序列化为跨库长文本 JSON；不修改已有内容、账号和站点设置。
- **3 → 4**：扩展 `cms_menu` 的上级、类型、资源引用、打开方式和版本号，名称长度扩展至 200。旧菜单补为顶级自定义链接、当前窗口，原名称、地址和排序保留。

- **4 → 5**：扩展 `cms_settings` 的副标题、浏览器图标、内容语言、四类列表条数、搜索收录、评论规则、页脚和版本号；保留旧名称、介绍、Logo 与关键词。新增字段默认中文、每页 12 条、启用评论并审核、允许访客评论及搜索收录。

- **5 → 6**：新增 API 访问令牌、24 小时请求去重记录和日志令牌归属；保留已有账号、内容、设置和历史日志。
- **6 → 7**：新增独立的浏览器访客、页面访问、内容计数、行为点击和客户咨询表；原有内容与设置表不变。访问与咨询规则见 [访问统计与客户咨询](traffic.md)。
- **7 → 8**：在访客与访问明细中增加 IP 和地区快照，历史字段留空，保留原访问计数和客户咨询。
- **8 → 9**：增加历史版本、回收站、定时发布、咨询跟进、备份状态和累计内容访客记录；保留旧内容、发布快照与访问计数，补齐已发布正文搜索数据。详见 [内容运营功能完善](editorial-enhancements.md)。

- **9 → 10**：新增页面布局与首页选择，旧富文本和主题设置保留，详见 [页面搭建与模板](page-builder.md)。
- **10 → 11**：通知发送记录与启用起点。
- **11 → 12**：独立 SEO、草稿地址和旧地址跳转。
- **12 → 13**：附件名称／分组的版本控制，原文件不变。
- **13 → 14**：产品／案例字段及咨询表单配置和提交快照。

版本 1 至 13 会在新版 API 启动时逐级升级至 14，重复启动不会重置数据；数据库版本高于程序版本、版本记录缺失或迁移失败时，进程报错退出，不提供 HTTP 服务。首次建站仍需 `--initialize`，正常启动不会向空数据库自动创建站点或管理员。升级前停止旧 API，避免并行写入。菜单、主题和站点设置都属于数据库业务数据，不是部署配置，不需要新增 Consul 键。

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

先停止旧 API、前端和容器网关（宿主机 Nginx 方案只停止 API、前端），备份数据库、附件和密钥。构建或导入新镜像并更新 Compose 的镜像版本，使用原项目名、连接配置和数据卷重新启动服务。API 会自动执行数据库升级；成功后验证健康、登录、内容、统计和操作日志，不再要求手动执行 `--migrate`。重建时继续使用原来的 HTTPS 或宿主机 Nginx Compose 参数。

升级时数据库账号需具备对应的建表或改表权限；若运行账号权限已收紧，可先用专门的升级身份执行 `docker compose run --rm --no-deps api --migrate`，再用原运行账号启动。两种入口复用同一套编号迁移，没有开启 FreeSql 的全局自动结构同步。当前版本为 schema 14，新增通知、SEO、附件分组和业务字段的配置见 [第二轮完善](next-enhancements.md)；页面搭建迁移及使用见 [页面搭建与模板](page-builder.md)，访客位置及内容运营迁移见上文，功能与验收详见 [内容运营功能完善](editorial-enhancements.md)。DDL 中途失败不会写入该步骤的完成版本，解决原因后重启可继续执行；不会自动恢复备份或降级数据库。恢复旧镜像需同时恢复对应的旧数据库备份。

七套主题及缩略图随 Next.js 镜像发布；升级主题功能时同时更新 API 和 web 镜像。没有第三方模板加载目录。主题管理入口与操作说明见 [主题使用说明](themes.md)。
