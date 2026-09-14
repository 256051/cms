# 首版验收记录

本页保留 schema 1 首次交付的验收基线。schema 2 结果见 [体验与审计补充验收](improvements-verification.md)，当前 schema 3 结果见 [主题验收记录](themes-verification.md)。

验收日期：2026-09-14。对象为本仓库从空目录独立实现的 CMS，验证在本地 Windows 主机及 Docker Linux 容器中完成，没有对外部服务器或已有业务数据库执行操作。

[机器可读结果](verification-results.json)保留最终数据库与容器检查原始结果，以及构建、浏览器结果摘要。最终数据库运行编号 `cd8598f0f5`，最终 Docker 运行编号 `docker-0c6daea10d`；详细运行日志位于本地 `artifacts/` 对应目录，该目录不进入源码版本管理。

## 构建与依赖

- .NET SDK 10.0.401：`dotnet restore --locked-mode`、`dotnet build --no-restore` 通过，0 警告、0 错误；公共 XML 注释缺失作为构建错误处理。
- Node.js 24.19.0，Next.js 16.3.5，React 19.3.0，TypeScript 5.9.3：类型检查及生产构建通过。
- FreeSql 3.5.311 是唯一 ORM。源码检查未发现 Service 内 FreeSql 查询、Controller 直连 Repository、`.Result` 或 `.Wait()`。
- NuGet 和 npm 依赖锁文件已包含在源码中；`dotnet list package --vulnerable --include-transitive` 和 `npm audit --audit-level=moderate` 在验收当日未报告已知漏洞。这是当时的依赖扫描结果，不代表永久安全保证。
- OpenAPI 从运行中的 API 导出，TypeScript 接口已重新生成并通过类型检查。

## 四数据库实际验证

四个 Provider 分别使用全新的独立数据库运行同一组 HTTP 与数据库集成检查。SQLite 为 16 组（多一组 Consul），PostgreSQL、MySQL、SQL Server 各 15 组，共 **61 组通过**。组是验收场景集合，不等同于 61 个独立单元测试。

验证环境：

- SQLite：随 SQLitePCLRaw.bundle_e_sqlite3 3.0.5 打包的本地引擎。
- PostgreSQL：`postgres:17-alpine`，镜像 ID `18cfe3ef5e6815560c98237d6216d1e5119702fb0f3894c8785dd58b8bbe5d73`。
- MySQL：`mysql:8.4`，镜像 ID `85b9bf2e29cf836ecb8c2a15a935d4ba0c606631dff1dd79531a11983c638f2a`。
- SQL Server：`mcr.microsoft.com/mssql/server:2022-latest` Developer，镜像 ID `97b448857967be55e005424a660056fe6d51814435804dc07e8f79f028bab5fb`。没有把未经实际运行的其他 SQL Server 版本/版本类型标记为已验证。

共同验证内容：

1. 初始化无默认密码、重复初始化不覆盖账号，显式迁移入口及实际唯一索引。
2. 登录、CSRF、编辑角色越权拒绝，最后管理员删除/停用/降级保护，停用后已有会话失效。
3. 非法文件格式/签名、超限文件拒绝，草稿附件不能匿名读取，引用中附件不能删除。
4. 中文、emoji 和长正文；HTML 脚本、事件属性、危险链接净化；未发布内容 404。
5. 草稿、搜索、分类标签归档与公开快照隔离；发布、下架、重新发布和 sitemap 一致。
6. 两个客户端同时编辑，只允许一个版本成功；旧版本写入返回 409。
7. 评论审核、隐藏和限流，已持久化时间正确输出 UTC。
8. 独立页面、菜单排序与安全链接、站点设置、稳定分页和发布顺序。
9. Repository 写入与操作日志的真实事务回滚。
10. API 重启后保留数据、附件和原会话。
11. 通过数据库自身备份机制恢复到独立新数据库/文件，并配套恢复上传文件与认证密钥；检查站点配置、同一会话和附件原始字节。

Consul 使用 `hashicorp/consul:1.21` 实例验证：Consul 覆盖本地文件，环境变量覆盖 Consul，启用后不可达会中止启动。

开发期间发现 MySQL 默认 text 不足以容纳序列化后的长发布 JSON，已统一为长文本映射，并在四库长内容回归中验证修复。

## 浏览器

Playwright 1.63.0 使用本机 Microsoft Edge/Chromium，生产模式 Next.js、本地 SQLite API。一个端到端测试通过，最终运行 4.9 秒（含测试框架总计 5.9 秒）。

覆盖登录、富文本编辑、上传图片、从附件库再次插图、保存草稿、未发布 404、发布、服务端响应 HTML 正文/canonical/description、sitemap，以及保存新草稿不改变公开正文。额外注入一次发布失败，验证草稿版本保留且重试成功；这同时覆盖了编辑器忙碌状态切换误触发编辑事件的修复。

遍历所有后台导航页面，没有页面脚本异常；检查 375、768、1024、1440 像素布局无横向溢出；手机端完成打开菜单、附件浏览、正文修改和草稿保存；键盘 Tab 可聚焦跳过导航链接。

本地截图：`artifacts/admin-desktop.png`、`editor-desktop.png`、`public-desktop.png`、`article-mobile.png`、`admin-mobile.png`、`editor-mobile.png`。已人工查看桌面编辑页和手机编辑/附件页。未执行 Safari、Firefox 或真实 iOS/Android 设备测试。

## Docker 与恢复

Docker Engine 29.7.2、Compose 5.5.1。API 和 Next.js Linux 镜像实际构建成功，使用 Nginx、SQLite、Production 配置和临时自签名证书运行隔离的 Compose 项目：

- HTTPS 证书验证及同域 API、附件和页面转发通过。
- 登录与 CSRF Cookie 均为 Secure。
- 上传、发布、SSR 正文、运行时 SITE_URL 的 sitemap/robots 通过。
- 重启 API、Next.js、Nginx 后，会话、数据库和附件仍有效。

容器整体链路使用 SQLite 验证；另外三库的 Provider、独立数据库容器和备份恢复使用上述四库集成矩阵验证。没有宣称四套完整 Compose 拓扑都分别经过全程验收。恢复演练目标均是新数据库/文件，没有覆盖源数据库。

## 复现

先安装项目依赖和 .NET 10/Node.js 24；四库矩阵需要 Docker 与 Python 3（HTTP 检查仅用标准库）：

```powershell
dotnet build
python tests/run_matrix.py all
npm --prefix web run api:types
npm --prefix web run typecheck
npm --prefix web run build
```

单库可把 `all` 换成 `Sqlite`、`PostgreSQL`、`MySql` 或 `SqlServer`。脚本创建随机命名测试数据库和容器，只清理带自己运行标记的容器；结果输出到 `artifacts/<运行编号>/results.json`。

浏览器验收现已整合到下方 Docker HTTPS 脚本：使用随机端口、独立数据库、随机凭据及测试专用卷，不再默认写入日常预览站点。脚本自动设置 `CMS_TEST_BASE_URL`、`CMS_TEST_CREDENTIALS_PATH` 和测试证书开关；直接运行 Playwright 必须明确提供前两项。不要把写入验收指向正式站点或正在编辑的预览站点。

Docker HTTPS 与浏览器验收额外需要 Python `cryptography`、已安装的 Microsoft Edge，以及 `web` 的 npm 依赖；证书库仅用于测试，不是应用运行依赖：

```powershell
docker build -f deploy/Dockerfile.api -t cms-api:local .
docker build -f deploy/Dockerfile.web -t cms-web:local .
python tests/docker_smoke.py
```

## 未覆盖的部署能力

仅支持单 API 实例；没有多实例写协调、分布式限流或共享 SQLite 写入能力。未验证高负载容量、外部云主机、生产证书自动续期、自动定时备份、跨库数据搬迁或历史版本回滚。后续依赖调整及对应验证范围见 [修改记录](../CHANGELOG.md)。
