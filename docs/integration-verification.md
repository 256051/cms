# Agent 通用发布 API 验收记录

日期：2026-09-14。验证对象为本次通用 API、访问令牌、schema 6 升级及其影响的原有功能。使用独立测试数据库和 Docker 项目，不向外部服务器发布内容。

## 构建与契约

- .NET Debug、Release 构建通过，0 警告、0 错误；未增加或升级 NuGet/npm 依赖。
- Next.js TypeScript 检查、生产构建通过。
- 从运行中的 API 更新 `docs/openapi.json`，重新生成 `web/src/lib/api.generated.ts`；集成接口包含 Bearer 认证、权限说明和必填 `Idempotency-Key`。
- API 与 Next.js Docker 镜像构建通过。

## 四库业务、升级与恢复

`tests/run_matrix.py` 实际完成 **161 组检查**：

- SQLite：41 组，通过，结果编号 `79b1bba813`。
- PostgreSQL 17：40 组，通过，结果编号 `79b1bba813`。
- MySQL 8.4：40 组，通过，结果编号 `1557c9d96d`。
- SQL Server 2022 Developer：40 组，通过，结果编号 `fd8e46e512`。

每库均使用独立数据库验证新库初始化、重复初始化、历史版本逐级升级、重复迁移、普通启动不修改结构，以及原有文章、菜单、主题、设置和权限闭环。schema 5 → 6 特别核对自定义设置、账号密码哈希、安全标识、文章版本和历史日志保留。

新增验证包括令牌/网页身份隔离、管理员与 CSRF、权限与输入校验、安全上传和富文本净化、草稿隔离、显式发布、版本冲突、并发重试只产生一篇文章及一条成功日志、撤销和账号停用、限流及最近使用记录。

数据库检查还验证令牌哈希与过期、24 小时去重窗口、内容/附件/操作日志/去重记录事务回滚及文件补偿。重启后和数据库、附件、密钥恢复到独立环境后，同一成功写入仍返回原结果。SQLite 另验 Consul 优先级及读取失败明确停止启动。

测试使用可控时钟模拟过期；MySQL 用例允许数据库时间字段的秒级精度差异。以上组数是验收分组数，不是逐条断言数；四库结果来自列出的分次执行，并非同一轮运行。

## 独立 API 与登录回归

- `tests/remote_api.py`：8 组通过，结果编号 `integration-04a95054c8`。额外实际执行发文示例两次，确认相同任务不重复创建/发布；Production 环境拒绝通过明文 HTTP 使用令牌。
- 混合有效 Cookie 与 Bearer 请求头也不能绕过后台写操作的 CSRF；只有成功认证的集成接口使用令牌写入。
- `tests/login_security.py`：7 组通过，结果编号 `login-202c5050d6`，包括账号输出字段、验证码生命周期、跨浏览器复制、重放、失败锁定和 IP 限流。
- `Cms.Checks --login-protection`：通过，覆盖验证码过期、账号冷却到期、成功重置和并发限制。

## Docker HTTPS 与浏览器

独立 Docker Compose 的 **Production HTTPS 验收通过**，结果编号 `docker-f4c75cd56d`。使用 Nginx 同域代理、测试自签名证书和持久化卷；验证 Secure Cookie、API 令牌、前台 SSR、附件及两次重启后的账号会话、主题、菜单、设置和去重记录。

Playwright 使用 Microsoft Edge，**7 项浏览器测试全部通过**。新增令牌用例覆盖管理员登录、选择权限、未保存提醒、模拟保存失败后输入保留、完整令牌一次展示与离开保护、独立 API 客户端上传/保存/发布、前台 HTML 正文、刷新后明文消失、375/768/1440 像素布局、键盘撤销以及撤销后返回 401。其余六项覆盖原有发布、编辑保护、验证码、菜单、设置和四主题操作。

## 本地预览升级

本地 SQLite 预览先停止服务并备份，再显式执行 schema **5 → 6**。备份位于 `.local/backups/integration-20260914-214630`，实际核对结果位于本地 `artifacts/integration-20260914-214630/results.json`。

原有表的原有字段及全部记录与备份一致，附件、认证密钥和原账号凭据文件哈希一致。未调用初始化或重置密码；重启后原管理员通过 Next.js 同域代理登录成功，新的令牌列表可读取。另以真实浏览器复查本地令牌页的 375/768/1440 像素布局；静止后的手机侧栏正确隐藏，表单无横向溢出。未给本地站点自动创建任何令牌。

## 复验与边界

```powershell
dotnet build
npm --prefix web run typecheck
npm --prefix web run build
python tests/run_matrix.py Sqlite PostgreSQL MySql SqlServer
python tests/remote_api.py
python tests/login_security.py
dotnet tests/Cms.Checks/bin/Debug/net10.0/Cms.Checks.dll --login-protection
docker build -t cms-api:local -f deploy/Dockerfile.api .
docker build -t cms-web:local -f deploy/Dockerfile.web .
python tests/docker_smoke.py
```

四库与 Docker 验收需要可用的 Docker；HTTPS 测试需要 Python `cryptography`，浏览器测试按现有 Playwright 配置使用本机 Microsoft Edge。测试私密配置、凭据、数据库、证书与截图保留在 Git 忽略目录中，不随源码提交。

继续限定单 API 实例；限流窗口在进程内，令牌和 24 小时去重记录在数据库中。没有执行多实例压测、外部生产部署或独立渗透测试。本期没有 MCP、自动定时发布、跨站推送或按文章限定的令牌权限；权限作用于站内全部文章与独立页面。使用方式见 [通用 API 文档](integration-api.md)。
