# 宿主机 Nginx 转发到 CMS 容器

适用条件：Nginx 安装在运行 Docker 的同一台 Linux 服务器上，由它处理域名和 HTTPS。只启动 `api`、`web` 两个容器；不再启动包内 `gateway`。API 和前端端口均绑定宿主机回环地址，不开放到公网。

如果 Nginx 本身也运行在容器内，或在另一台服务器，下面的 `127.0.0.1` 不是 CMS 所在地址，需要按实际网络改配，不能直接照用。

## 1. 配置文件位置

将 `compose.host-nginx.yaml` 放到发布包的 `compose.yaml` 同级。`deploy/nginx.host.conf` 是宿主机 Nginx 的站点配置示例，不要用它替换容器的 `deploy/nginx.conf`。

`.env` 保留 SQLite 和原数据卷配置，确保：

```dotenv
COMPOSE_PROJECT_NAME=itmao-cms
CMS_ENVIRONMENT=Production
DB_TYPE=Sqlite
DB_CONNECTION_STRING=Data Source=/data/cms.db
SITE_URL=https://itmao.club
CMS_NETWORK_SUBNET=172.30.46.0/24
```

已经运行过的站点必须保留原来的 `COMPOSE_PROJECT_NAME` 和数据库配置。使用 `www.itmao.club` 时同步修改 `SITE_URL` 和 Nginx 的 `server_name` / 跳转地址。此模式不读取容器网关的证书配置，`TLS_DIRECTORY` 无需设置。

默认映射为 API `127.0.0.1:5080`、前端 `127.0.0.1:3000`。若端口已占用，同时修改覆盖文件左边的宿主机端口和 Nginx `proxy_pass` 中对应端口。

## 2. 初始化与启动

镜像仍使用原离线包，已导入则不用重复下载。新站先在 `.env` 填写自己的 `SETUP_USERNAME`、`SETUP_PASSWORD`，执行：

```sh
docker compose -f compose.yaml -f compose.host-nginx.yaml run --rm --no-deps api --initialize
```

成功后清空这两个初始化字段。已有站点跳过初始化；更新版本前停止旧 API、前端并按原流程备份，更换镜像后启动，API 会在接收请求前自动升级旧数据库。`--migrate` 仍可用于单独执行升级。

如果之前已经启动过包内网关，先停止它，然后仅启动两个业务容器：

```sh
docker compose stop gateway
docker compose -f compose.yaml -f compose.host-nginx.yaml up -d api web
curl --fail http://127.0.0.1:5080/health/ready
```

不要带 `compose.https.yaml` 启动，也不要执行 `down -v`。后续重建 api/web 时继续带上 `compose.host-nginx.yaml`，保持端口映射。

## 3. 宿主机 Nginx

将 `deploy/nginx.host.conf` 安装到宿主机 Nginx 的站点配置目录，例如 `/etc/nginx/conf.d/itmao.conf`。修改两处证书路径为现有站点证书。已有同域名配置时编辑原站点，不要重复创建同域名的 `server`；使用宝塔时在该站点配置内更新转发规则，并保留已有证书配置。

流量规则：`/api/`、`/media/`、`/health/` 转发到 5080，其他路径转发到 3000。保留 `proxy_pass` 中没有末尾 `/` 的写法，让原始路径完整传递。

示例在 server 层设置代理头，各 location 继承。若自己在某个 location 新增 `proxy_set_header`，应把这组头完整保留，避免覆盖 Nginx 的整组继承规则。此处以 Nginx 为公网入口，用实际连接 IP 覆盖客户端传来的转发头；有 CDN 或前置负载均衡时需要另外按可信地址配置真实 IP。

```sh
nginx -t
# 上一条检查成功后再执行：
nginx -s reload
curl --fail https://itmao.club/health/ready
```

随后访问 `https://itmao.club/admin` 登录。Production 保持启用，不需要为了内部 HTTP 转发改成 Development。

## 为什么采用这个配置

原包的 HTTP 网关会将协议头写成它收到的 HTTP，并把外层代理 IP 当作客户端 IP。直接在它前面再加 HTTPS 代理，会影响 Agent API 的 HTTPS 判断和按真实 IP 的登录限流。本方案让宿主机 Nginx 直接传递 `X-Forwarded-Proto` 与客户端 IP 到 API；应用已有的可信 Docker 网段配置负责接收这些信息。

参考 [Nginx 代理头与 proxy_pass 文档](https://nginx.org/en/docs/http/ngx_http_proxy_module.html#proxy_set_header) 和 [ASP.NET Core 代理配置](https://learn.microsoft.com/en-us/aspnet/core/host-and-deploy/proxy-load-balancer?view=aspnetcore-10.0)。
