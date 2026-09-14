# 登录保护验收记录

执行日期：2026-09-14。此次不修改数据库结构，schema 仍为 5。所有失败尝试、并发和业务回归均针对临时测试站点；本地预览继续使用原有 SQLite 数据库、附件、账号和认证密钥。

## 实际通过

- .NET 解决方案构建：0 警告、0 错误；前端类型检查、生产构建、API 与 Next.js Docker 镜像构建通过。
- `Cms.Checks --login-protection`：浏览器绑定、刷新失效、错误后消费、过期、成功清零、15 分钟等待恢复、并发验证码一次性消费、并发账号最多 5 次密码尝试均通过；等待恢复使用可控时钟验证，不依赖实际等待 15 分钟。
- HTTP 专项 **6 组通过**：无答案字段/禁止缓存/Cookie/CSRF、跨浏览器和刷新行为、账号错误统一、大小写归一与跨 IP 限制、登录与验证码独立限流、并发重放。原始记录：`artifacts/login-8b1e9651cb/results.json`。
- Docker HTTPS 下 **6 组浏览器回归全部通过**：内容发布、表单与审计、验证码登录、多级导航、站点设置、四套主题。登录页验证正确/错误验证码、错误密码、服务失败保留输入、限流倒计时、刷新后焦点、375/1440 像素布局和 Enter 提交；原始记录：`artifacts/docker-351d2cae4d/results.json` 与同目录 `browser.log`。
- HTTPS 下认证、CSRF 和验证码绑定 Cookie 均为 Secure；容器重启后已建立的会话、数据库、附件、菜单、设置和主题保持有效。
- 本地预览 `/admin/login` 和 `/api/v1/auth/captcha` 实际返回成功，验证码有效期为 180 秒。

首次手机检查发现原登录表单撑宽到 420 像素，已修正容器最小宽度并重新通过 375 像素无横向溢出的检查。已人工查看 `artifacts/login-desktop.png` 和 `artifacts/login-mobile.png`。

可追踪的结果副本见 [结果 JSON](login-security-results.json)。本次专项使用 SQLite；没有重新执行 PostgreSQL、MySQL、SQL Server 的全量矩阵，也没有把历史四库结果当成本次验证。进程内保护与验证码能力边界见 [登录保护说明](login-security.md)。
