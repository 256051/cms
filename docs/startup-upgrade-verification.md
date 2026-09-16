# 启动时自动升级验收

日期：2026-09-15。本次改变的是启动入口，继续复用现有 FreeSql 编号迁移，没有新增数据库版本、依赖或配置项。

## 最终行为

- 已有旧数据库：启动 API 时自动逐级升级，完成后才监听 HTTP。
- 当前数据库版本：直接启动，不重新同步表、不重置业务数据。
- 首次安装：仍执行 `--initialize` 创建站点；普通启动拒绝空库，升级不创建或重设管理员。
- 异常：版本超前、缺少版本记录或升级失败时退出，日志保留错误；未完成步骤不标记成功，排除原因后重启可继续。
- `--migrate` 保留为只升级后退出的入口。Consul 和环境变量在升级前照常加载，所有数据访问仍在 Repository。

## 已执行验证

- Release 构建通过，零警告、零错误。
- SQLite、PostgreSQL、MySQL、SQL Server 均从 schema 6 直接正常启动，自动升到 7 后就绪；随后完成访问统计、客户咨询、并发去重、权限、重复迁移及重启持久化验收。结果：[四库验收](../artifacts/2fffe4aee8/traffic-results.json)。
- SQLite schema 1～5 分别正常启动并升级到 7，原文章、菜单、主题、设置、账号和历史日志按各版本断言保留；未初始化库、超前版本、缺失版本记录及模拟迁移中断均未开放 HTTP。修复后重启成功，管理员数量不增加。结果：[旧版升级及失败恢复](../artifacts/65cb3444e7/startup-results.json)。
- Linux Docker 容器以 Production、非 root 用户启动，未传 `--migrate` 即完成 schema 6 → 7；停止后检查原文章正文与版本号保留，再次启动同一容器仍正常。结果：[容器启动升级](../artifacts/3e88d1f44f/docker-startup-results.json)。测试容器已移除，仅使用隔离数据。
- 此次完整 Dockerfile 构建在依赖恢复阶段长时间无进展后取消；容器验收使用此前已验证的 `cms-api:traffic-validation` 运行镜像，加上本次 Release 构建的三个应用程序集，没有改变依赖。该镜像用于运行行为验收，本次没有生成新的正式离线发布包。
- 上述验证使用隔离数据，未连接或更改线上数据库。之前验收记录中的“正常启动不升级”描述对应旧实现；当前行为以本记录和 [部署说明](deployment.md) 为准。

## 复验入口

```powershell
dotnet build Cms.slnx -c Release --no-restore
python tests/startup_upgrade.py
python tests/traffic_acceptance.py all
```

## 上线边界

需使用包含本次改动的新 API 镜像；旧发布包不会自动获得此行为。升级前停止旧实例并备份，保留原项目名、连接配置与数据卷，再启动新镜像。数据库账号需具备升级所需权限；自动升级不会自动备份或自动回滚。继续只支持一个 API 实例。
