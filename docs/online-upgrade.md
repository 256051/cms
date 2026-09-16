# 线上验证版升级步骤

适用于现有 Linux amd64 Docker 站点。默认 SQLite，API 仍支持其他已配置的数据库。本版包含访问统计、客户咨询、跟进管理和启动时自动升级，数据库版本为 7。

## 1. 准备与备份

- 解压新发布包并校验旁边的 `.sha256` 文件、包内 `SHA256SUMS`。
- 在原部署目录停止旧 API 和前端，备份数据库、附件、认证密钥及 `.env`。SQLite 在 API 停止后备份整个 `/data` 卷；其他数据库另做数据库备份。
- 将原 `.env` 复制到新包目录。保留原 `COMPOSE_PROJECT_NAME`、数据库连接、数据卷、站点域名和网络设置；自定义端口继续保留在宿主机 Nginx 覆盖文件中。
- 不要使用新包的 `.env.example` 覆盖已有配置，不执行 `--initialize`，也不执行 `down -v`。升级无需重设管理员。

## 2. 导入并启动

以下在新包目录执行，适用于原来由同机宿主 Nginx 处理 HTTPS 的站点：

```sh
docker load -i images.tar
docker compose -f compose.yaml -f compose.host-nginx.yaml up -d api web
docker compose -f compose.yaml -f compose.host-nginx.yaml logs --tail 100 api
curl --fail http://127.0.0.1:5080/health/ready
```

新包的 `compose.yaml` 已引用本次版本的镜像。API 会在监听 HTTP 前自动升级旧数据库；无需手工执行 `--migrate`。数据库账号需要具备升级所需的建表或改表权限。看到 `Database schema is ready.` 且健康检查返回 200 后再进行业务验证。

如果原站使用包内 Nginx 网关，继续用 `-f compose.yaml -f compose.https.yaml` 启动 `api web gateway`，保留原证书配置。不要混用两种部署方式。

## 3. 验证本次功能

1. 使用原管理员账号登录，确认原文章、附件和主题正常。
2. 退出管理员账号，或用无痕窗口打开公开文章；后台文章列表应增加浏览次数。管理员本人访问不计数。
3. 查看“访问统计”和“访客记录”，检查浏览量、独立访客、来源及浏览轨迹。
4. 前台提交一条测试咨询，后台“客户咨询”应收到记录；保存跟进状态和备注，刷新后检查回显。
5. 重启 API，确认文章计数、客户咨询和跟进内容仍保留。验证完可删除测试咨询。

历史浏览量不会自动补齐。本功能从启用后开始统计；仅刷新旧镜像不会获得新功能，必须加载新包并使用其中的新镜像版本。

## 升级失败

API 会报错退出，不会在未完成的数据库结构上提供服务。保留日志，修复连接、权限或迁移错误后重启可继续；不要删除数据库版本记录。需要回退时同时恢复旧镜像和升级前对应的数据库、附件及密钥备份。
