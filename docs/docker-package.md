# Docker 离线部署包

适用于全新站点，默认 SQLite。包内包含 CMS API、Next.js 前端、Nginx 三个镜像及完整主题许可，不包含本地文章、账号、附件或密钥。平台和镜像版本见 `release.json`。服务器需要 Docker Engine 和 Docker Compose 2.24.4 或更新版本，不需要 .NET SDK、Node.js 或 Python。

## 1. 解压并导入

把发布包和旁边的 `.sha256` 文件上传到服务器，在同一目录执行（文件名替换为实际版本）：

```sh
sha256sum -c cms-VERSION-linux-amd64-sqlite.tar.gz.sha256
tar -xzf cms-VERSION-linux-amd64-sqlite.tar.gz
cd cms-VERSION-linux-amd64-sqlite
sha256sum -c SHA256SUMS
docker load -i images.tar
cp .env.example .env
chmod 600 .env
```

## 2. 设置域名、数据库和初始管理员

编辑 `.env`：填写 `SETUP_USERNAME`、`SETUP_PASSWORD`。SQLite 无需数据库账号密码，默认文件为 `/data/cms.db`。管理员账号为 3–64 位小写字母、数字或连字符，密码至少 12 字符；不设置默认账号密码。

可使用 `openssl rand -hex 24` 生成密码。不要直接把含 `$` 的密码粘贴进双引号值；Compose 会进行变量替换。自行选择其他密码时，用单引号包围对应值。

`SITE_URL` 默认 `https://itmao.club`，使用 `www` 时改为 `https://www.itmao.club`，须与实际访问域名一致。DNS 应指向服务器，80/443 端口须可用。`COMPOSE_PROJECT_NAME` 决定数据卷名称，上线后保持不变；网段与已有 Docker 网络冲突时修改 `CMS_NETWORK_SUBNET`。

将该域名的证书链和私钥放到包内的 `tls/fullchain.pem`、`tls/privkey.pem`。包里不包含真实证书，也不会自动申请证书。`.env` 的 `TLS_DIRECTORY` 可改为已有证书目录。

## 3. 初始化并启动 HTTPS

以下命令在解压目录执行：

```sh
docker compose run --rm --no-deps api --initialize
```

初始化成功后，清空 `.env` 中的 `SETUP_USERNAME` 和 `SETUP_PASSWORD`，然后启动：

```sh
docker compose -f compose.yaml -f compose.https.yaml up -d api web gateway
docker compose -f compose.yaml -f compose.https.yaml ps
curl --fail https://itmao.club/health/ready
```

访问 `https://itmao.club/admin`，用刚设置的账号登录。需要使用其他域名时同时替换上面的检查地址。正常运行不会自动建表，初始化也不会覆盖已有账号。

## 暂时没有证书时做本机测试

先在 `.env` 设置 `CMS_ENVIRONMENT=Development`、`SITE_URL=http://localhost:8088`、`CMS_BIND_ADDRESS=127.0.0.1`、`CMS_PORT=8088`，完成数据库初始化，再执行 `docker compose up -d api web gateway`，从服务器本机访问 `http://localhost:8088/admin`。远程电脑可以使用 SSH 端口转发。

正式站点使用 HTTPS 和 Production；只使用 HTTP 时，Production 的安全 Cookie 无法完成登录。这个包的默认方案由内置 Nginx 终止 HTTPS。已有同机宿主 Nginx 或宝塔时，改用 [宿主机 Nginx 方案](host-nginx.md)，仅启动 API、web 两个容器，由现有 Nginx 转发并处理证书。

## 改用已有数据库

SQLite 数据库、附件及密钥均位于 `cms-data` 卷，不需要额外数据库服务。

已有 PostgreSQL、MySQL 或 SQL Server 可以按 `docs/deployment.md` 修改数据库类型和连接串。远程地址不能写 `localhost`，那代表 API 容器自身。本包不携带额外数据库镜像；需要配套容器时可按 Compose profile 联网拉取。四库都使用 FreeSql，换配置不会搬迁数据。

## 数据、备份和升级

SQLite 数据库、附件、认证密钥均位于 `cms-data` 卷。不要使用 `docker compose down -v` 删除运行数据。先停止写入再备份整个卷，并另外保存 `.env`，操作细节见 `docs/operations.md`。

升级前停止写入并备份，再导入新包的 `images.tar`。使用同一个 `COMPOSE_PROJECT_NAME`、相同配置和数据卷；执行 `docker compose run --rm --no-deps api --migrate` 后启动。当前 schema 为 6，三套新主题不另改表。已有库升级使用 `--migrate`，不要重新设置初始管理员凭据。

检查日志：

```sh
docker compose -f compose.yaml -f compose.https.yaml logs --tail 100 api web gateway
```

支持单 API 实例。镜像使用固定发布标签及本地加载，API/web/网关设置了 `pull_policy: never`，导入失败时会明确报错，不会误拉同名远程镜像。其他服务镜像不会导入或启动。

## 从源码重新打包

在项目源码目录安装 Docker、Python 3.11+，提交应用源码后执行 `python scripts/package-docker.py`。默认构建 Linux amd64；`--platform linux/arm64` 可生成对应架构包，但只应在完成 ARM64 实机验证后标记为已验收。输出在 `artifacts/releases/`，不上传数据或凭据，也不自动推送镜像仓库。
