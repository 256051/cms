# 访问统计与客户咨询验收记录

日期：2026-09-15。验证对象为当前源码和本次构建的 `cms-api:traffic-validation`、`cms-web:traffic-validation` 镜像。所有写入均针对本次创建的隔离数据库和 HTTPS 测试站点。

## 编译与接口

- `dotnet build Cms.slnx -c Release --no-restore` 通过，零警告、零错误。验证采用 Release 输出，未停止占用 Debug 输出的原有本地 API。
- API 与 Next.js 生产镜像构建成功；没有升级依赖包。
- 使用实际 API 导出的 OpenAPI 重新生成前端类型，`npm run typecheck` 通过。
- `git diff --check` 通过。

## 数据库与 HTTP 验收

- 现有完整回归：SQLite 45 组，PostgreSQL、MySQL、SQL Server 各 44 组，共 177 组通过。覆盖旧版迁移、编辑发布、权限、主题、菜单、媒体、备份恢复及 Consul 等既有功能。结果：[完整回归](../artifacts/c25beb49ef/results.json)。
- 本功能最终专项验收在上述四种数据库均通过。覆盖 6 → 7 升级与重复升级、原有文章版本保留、首次并发访问去重、PV/UV、单调阅读记录、日期边界、来源简化、客户授权、角色限制、跟进冲突、咨询删除及 API 重启持久化。结果：[四种数据库专项验收](../artifacts/604619447a/traffic-results.json)。
- 同一浏览器访问两次、另一浏览器访问一次，文章统计为 3 次浏览、2 个独立访客；重复请求不再加一。保存和重新发布不会覆盖计数。
- 页面服务端渲染、后台工作人员、预览和已识别爬虫排除；公开接口不返回客户联系方式，编辑角色不能读取客户和访客接口。

## 浏览器与容器

- 在本次构建的生产镜像、Nginx 同源 HTTPS 和隔离 SQLite 站点上验证。原有 10 项浏览器回归全部通过，覆盖令牌、编辑、登录、设置、菜单及十五主题。日志：[原有流程回归](../artifacts/traffic-browser-ea129299b9/browser-final.log)。
- 新增浏览器流程最初因搜索返回前存在多条同名操作按钮而中断；测试补上搜索结果等待后，单独重跑通过（1 项，10 秒），没有因此修改业务逻辑。日志：[新增流程最终结果](../artifacts/traffic-browser-ea129299b9/traffic-final.log)。两次运行合计覆盖全部 11 项流程。
- 新增流程验证实际可见页面计数、刷新与跨浏览器 PV/UV、离开页面上报阅读、公开附件下载点击、客户授权提交、来源关联、跟进保存与回显、访客轨迹、工作人员与预览排除、DNT，以及 Secure / HttpOnly Cookie。
- 已检查 375 / 768 / 1440 像素截图；手机端图表标签清晰、页面不横向溢出，宽表格在容器内滚动。后台菜单条目增多后的滚动问题已修复，原有 API 令牌入口测试通过。截图：[桌面统计](../artifacts/traffic-dashboard-1440.png)、[平板统计](../artifacts/traffic-dashboard-768.png)、[手机统计](../artifacts/traffic-dashboard-375.png)、[手机咨询表单](../artifacts/traffic-form-mobile.png)。
- API、Next.js 和网关容器同时重启后，原登录会话仍有效，统计汇总、客户跟进备注和访问轨迹与重启前完全一致。结果：[容器重启持久化](../artifacts/traffic-browser-ea129299b9/restart-results.json)。

## 交付边界

- 本次完成源码、文档、数据库迁移和隔离验收，没有升级用户正在运行的站点，也没有生成新的离线发布包。
- 新版启用前需要备份数据库并更新 API 与前端；当前启动流程会自动完成 schema 7 迁移。步骤见 [访问统计与客户咨询](traffic.md)，自动升级的后续验收见 [启动升级验收](startup-upgrade-verification.md)。
- 访问量从启用后开始记录；访客数量按随机浏览器标识估算，客户姓名和联系方式来自自愿提交。
- 继续使用当前单 API 实例的事务机制；访问明细暂不自动清理，客户咨询支持管理员删除。具体采集口径和保留边界见功能说明。
