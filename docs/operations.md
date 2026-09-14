# 备份、恢复与排查

## 备份范围

一次可用备份必须包含同一时间点的数据库、附件目录、认证密钥目录，以及用于恢复的应用版本和部署配置。密钥备份应与数据库一样限制访问；不要上传到公开仓库。

schema 6 的访问令牌哈希、撤销状态和请求去重记录保存在当前数据库中，也需要随库备份。恢复旧备份可能恢复当时尚未撤销的令牌，恢复后应核对并重新撤销不应继续有效的令牌；24 小时去重窗口仍按记录原到期时间计算。

主题选择、四套主题各自保存的设置和版本号都在数据库 `cms_theme` 表中，随数据库一并备份；主题代码和静态缩略图随 web 镜像发布。恢复后检查当前主题及各主题配置是否与备份时一致。

Compose 默认持久化路径为 `cms-data:/data`，其中 `uploads` 是附件、`keys` 是认证密钥；SQLite 的 `cms.db` 也在该卷。其他数据库使用各自的独立数据卷。备份文件建议保留在另一个存储位置，并按站点实际更新频率制定周期。

首版采用维护窗口备份，先停止写入，避免数据库与附件跨时间点：

```powershell
docker compose stop gateway web api
New-Item -ItemType Directory -Force backups | Out-Null
docker compose run --rm --no-deps --user 0 --entrypoint tar -v "${PWD}/backups:/backup" api -czf /backup/cms-data.tgz -C /data .
```

对 SQL Server/MySQL/PostgreSQL 继续做下面的数据库备份，完成后用原部署的 Compose 文件启动 gateway/web/api。使用 HTTPS 覆盖文件的站点，启动和重建也必须带 `-f compose.yaml -f compose.https.yaml`。

## PostgreSQL

在数据库容器生成逻辑备份，再复制到主机；不要通过 PowerShell 文本重定向保存二进制 dump：

```powershell
docker compose exec -T postgres pg_dump -U cms -d cms -Fc -f /tmp/cms.dump
docker compose cp postgres:/tmp/cms.dump ./backups/cms.dump
```

恢复演练必须使用一个不存在的新数据库名，比如 `cms_restore`：

```powershell
docker compose cp ./backups/cms.dump postgres:/tmp/cms-restore.dump
docker compose exec -T postgres createdb -U cms cms_restore
docker compose exec -T postgres pg_restore -U cms -d cms_restore /tmp/cms-restore.dump
```

将恢复实例的连接串改为 `Database=cms_restore`。不要通过删库或 `--clean` 覆盖原库进行首次演练。

## MySQL

使用已有容器环境中的密码，命令不输出密码：

```powershell
docker compose exec -T mysql sh -c 'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" mysqldump -uroot --single-transaction --no-tablespaces cms > /tmp/cms.sql'
docker compose cp mysql:/tmp/cms.sql ./backups/cms.sql
```

恢复到新库：

```powershell
docker compose cp ./backups/cms.sql mysql:/tmp/cms-restore.sql
docker compose exec -T mysql sh -c 'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" mysql -uroot -e "CREATE DATABASE cms_restore CHARACTER SET utf8mb4 COLLATE utf8mb4_bin"'
docker compose exec -T mysql sh -c 'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" mysql -uroot cms_restore < /tmp/cms-restore.sql'
```

为恢复实例的应用账号授予新库的对应权限，改为 `Database=cms_restore`。备份不包含 MySQL 服务器全局账号，账号配置须单独记录。

## SQL Server

生成数据库完整备份：

```powershell
@'
BACKUP DATABASE cms TO DISK = '/var/opt/mssql/data/cms.bak' WITH INIT;
'@ | Set-Content -Encoding utf8 ./backups/backup.sql
docker compose cp ./backups/backup.sql sqlserver:/tmp/cms-backup.sql
docker compose exec -T sqlserver bash -lc 'SQLCMDPASSWORD="$MSSQL_SA_PASSWORD" /opt/mssql-tools18/bin/sqlcmd -S localhost -U sa -C -b -i /tmp/cms-backup.sql'
docker compose cp sqlserver:/var/opt/mssql/data/cms.bak ./backups/cms.bak
```

也可以使用 SSMS 执行同样的 `BACKUP DATABASE` 操作。恢复前执行 `RESTORE FILELISTONLY` 查看备份中的逻辑文件名；以下 SQL 假设逻辑名为 `cms` 和 `cms_log`，实际不同时替换：

```sql
RESTORE DATABASE cms_restore
FROM DISK = '/var/opt/mssql/data/cms.bak'
WITH MOVE 'cms' TO '/var/opt/mssql/data/cms_restore.mdf',
     MOVE 'cms_log' TO '/var/opt/mssql/data/cms_restore_log.ldf';
```

在受控数据库管理工具中执行，目标必须是独立的新库/新文件。恢复到另一台服务器时，重新建立服务器登录并修复该数据库用户到登录的映射，然后改用 `Database=cms_restore`。

## SQLite

API 完全停止后备份整个 `/data` 卷即可；如单独备份数据库，应复制完整数据库及当时存在的 SQLite 伴随文件。不要在写入过程中仅复制主 `.db` 文件。

本地开发可在停止 API 后复制 `.local/dev.db`、`.local/uploads`、`.local/keys` 到新的备份目录。恢复时放入另一组目录，连接串指向新的文件，上传路径和密钥路径同时指向恢复副本。

## 恢复附件和密钥

创建一个全新的命名卷，把 `cms-data.tgz` 解压进去，保留原有文件所属用户和权限：

```powershell
docker volume create cms-restored-data
docker run --rm --user 0 --entrypoint tar -v "${PWD}/backups:/backup:ro" -v cms-restored-data:/data cms-api:local -xzf /backup/cms-data.tgz -C /data
```

上面的镜像名示例使用验收镜像；部署时改为自己的已构建 API 镜像。将独立恢复项目的 `cms-data` 卷指向该卷，并指向上面恢复出的新数据库。不要把备份解压到仍运行的生产卷，也不要执行 `docker compose down -v` 清理生产环境。

恢复实例应在不同端口、独立网络中启动。保持相同的 Data Protection ApplicationName（本项目为 `Cms`），使用配套密钥，已有会话才能解密；缺少密钥时用户需要重新登录。

恢复验收至少检查：健康接口、登录、文章正文、图片/PDF 字节、菜单与设置、一次新草稿保存。确认完整后才能安排正式切换。测试脚本已在四库中分别恢复到新数据库/文件，并核对站点数据、同一会话与附件原始字节，详情见 [验收记录](verification.md)。

## 日志与常见问题

```powershell
docker compose logs --tail 200 api web gateway
docker compose ps
```

- **健康状态**：`/health/live` 只表示进程存活；`/health/ready` 检查数据库及 schema 版本，未初始化或连接失败返回 503。
- **启动数据库报错**：检查 Provider 名称、地址、账号权限、库是否已建立。生产启动不建表，先在维护窗口执行 `--initialize` 或 `--migrate`。不要靠更换 ORM 或自动同步开关绕过。
- **Consul 启动失败**：检查地址、KV 键、ACL Token、JSON 格式。启用后不会回退本地配置；环境变量（包括空字符串）仍拥有更高优先级。
- **HTTP 下无法登录**：Production Cookie 必须走 HTTPS。本地 HTTP 调试显式用 Development，正式站点配置 TLS 和可信代理网段。
- **400 CSRF_INVALID**：刷新页面取得新令牌；登录、退出和身份变化后令牌应重新获取。客户端已实现该流程；不要取消全局 CSRF 校验。
- **401/403**：分别表示未认证/会话失效、权限不足。账号被停用、改角色、改密码后旧会话即失效。
- **409 VERSION_CONFLICT**：内容或主题被其他管理员保存；当前失败不会覆盖对方结果。先复制需要保留的本地输入，再重新加载最新版本并手动合并。
- **409 ASSET_IN_USE / IN_USE**：先处理草稿、旧发布快照或 Logo 的引用，再删除。
- **413**：文件超过后端或代理请求大小限制。后端最多允许 50 MiB；Nginx 预留了 multipart 包装空间。
- **429**：登录或评论触发每 IP 限流，等待返回的 `Retry-After` 时间。多用户经同一出口时共享该额度。
- **500**：保存响应里的 `traceId`，按同一编号查 API 日志。不要把完整日志、连接串或密钥展示给访客。
- **前台 502/错误页**：检查 API 健康、Next.js 的 `API_INTERNAL_URL` 以及 Nginx 网络；API 不可用时不返回陈旧缓存。
- **重启后附件丢失/登录失效**：检查 `/data` 是否持久挂载、目录权限、恢复时密钥是否匹配。检查配置变更是否错误指向另一数据库或存储目录。

## 性能边界

首版请求内容实时读取，没有页面缓存。写事务在单 API 进程中串行协调；附件引用检查线性扫描内容，站点地图一次读取公开内容。当前没有高并发容量、长时间压力、跨区域或多副本验收结果。需要扩大站点时，应先测量瓶颈，再增加数据库级写协调、附件引用表、分批 sitemap 或外部存储。
