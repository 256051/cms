# 修改记录

## 2026-09-14 — 使用 Mapster 替换 AutoMapper

### 修改内容

- 将 AutoMapper 16.2.0 替换为 Mapster 10.0.12（MIT），更新后端及检查项目的 NuGet 锁定文件。
- 保留 `CmsUser → UserView` 账号映射与现有依赖注入方式，公开字段仍为 `id`、`username`、`displayName`、`role`、`enabled`，不返回密码哈希和安全标识。
- 映射配置使用独立实例，要求显式注册映射与目标字段来源；在启动时校验并编译，配置错误会阻止启动。
- 删除启动代码、Compose、环境变量示例和部署文档中的 AutoMapper 许可证配置。
- 显式固定 `Microsoft.IdentityModel.JsonWebTokens` 为原来已解析的 8.14.0，避免移除 AutoMapper 后，SQL Server 驱动共享的 IdentityModel 依赖退回较低版本。
- 增加账号输出回归检查，并在 README 中增加本修改记录入口。

### 部署影响

- 更新后端并重启即可，无需数据库升级；schema 仍为 5，API 契约和前端代码不变。
- 原部署中的 `AutoMapper:LicenseKey` / `AutoMapper__LicenseKey` / `AUTOMAPPER_LICENSE_KEY` 已不再读取，可从本地配置、Consul 或部署环境中删除。
- 本地预览更新前已备份数据库、附件和认证密钥；更新后核对原数据保留，并验证原管理员可经前端代理登录。

### 实际验证

- `dotnet restore --locked-mode`：通过。
- `dotnet build --no-restore`：通过，0 警告、0 错误。
- `dotnet publish src/Cms.Api/Cms.Api.csproj -c Release --no-restore -o artifacts/mapster-publish`：通过；发布目录与运行依赖中已无 AutoMapper，包含 Mapster。
- `dotnet tests/Cms.Checks/bin/Debug/net10.0/Cms.Checks.dll --login-protection`：通过，覆盖验证码生命周期、账号冷却时间及并发限制。
- `python tests/login_security.py`：独立 SQLite 数据库的 7 组 HTTP 检查通过，包含登录、当前用户、账号创建/编辑/列表的字段和值校验，以及 CSRF、验证码和暴力破解防护。结果编号：`login-b3988fb649`。
- `docker compose --env-file .env.example config --quiet`：通过。
- 本地预览数据库全部表记录、附件文件和认证密钥与更新前备份一致；API 就绪检查、登录页面与原账号登录通过。

本次没有重跑四数据库全量验收、浏览器视觉检查或 Docker HTTPS 验收，也没有进行性能基准测试；历史验收结果不代表本次重新执行。
