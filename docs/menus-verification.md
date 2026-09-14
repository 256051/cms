# 多级导航菜单验收记录

本页为 schema 4 的历史验收记录，当前 schema 5 见 [站点设置验收](settings-verification.md)。

日期：2026-09-14；当前 schema 4。本次实现网站主导航的多级结构与五种菜单项类型，参考 [Halo 菜单文档](https://docs.halo.run/guide/use/menus) 和用户截图。使用方式见 [菜单说明](menus.md)。

[机器可读结果](menus-results.json)保存最终结果。四库运行编号 `3b582dc3b9`，Docker / 浏览器运行编号 `docker-6785c10b21`；原始日志在本地 `artifacts/` 对应目录。

## 实现范围

- 上级菜单、最多 5 级树形结构、同级排序、移动分支、当前窗口或新窗口打开。
- 自定义链接、文章、自定义页面、分类、标签；资源搜索和分页选择；关联项由服务器解析最新公开名称和地址。
- 编辑草稿不改变公开导航名称；资源下架时隐藏整条分支，重新发布后恢复。引用资源和有子项的菜单受删除保护。
- 管理员权限、CSRF、地址校验、循环和深度校验、整数版本冲突检测、同事务审计。保存失败保留输入，切换和离开复用未保存提醒。
- 四套主题共享导航组件，服务端 HTML 包含完整结构；桌面下拉、移动端逐层展开，独立链接与展开控件，支持键盘和主题预览上下文。
- 显式逐级升级至 schema 4，保留旧菜单和原主题；OpenAPI 与 TypeScript 类型同步。没有新增运行时依赖或配置项。

主要文件：`src/Cms.Data/Entities.cs`、`CmsRepository.cs`、`src/Cms.Services/SiteService.cs`、`ContentService.cs`、`Contracts.cs`、`src/Cms.Api/Controllers.cs`；`web/src/components/admin/MenuManager.tsx`、`SiteNavigation.tsx`、`SiteShell.tsx`、`web/src/lib/menu.ts`、`web/src/app/menus.css`。

## 实际验证

### 构建

.NET 构建通过，0 警告、0 错误；前端类型检查、Next.js 生产构建、API 和前端 Docker 镜像构建通过。沿用现有依赖版本。

### 四种数据库：109 组通过

SQLite 28 组；PostgreSQL、MySQL、SQL Server 各 27 组。组是验收场景集合，不代表 109 个独立单元测试。环境为项目 SQLite 引擎、PostgreSQL 17、MySQL 8.4、SQL Server 2022 Developer。

复用全部内容、身份认证、附件、评论、主题、审计及备份恢复检查，并新增或扩展：

1. 未登录、编辑角色、缺失 CSRF、非法 URL、未知类型、缺少上级、自己作为上级、循环引用、超过 5 级均拒绝。
2. 五种类型、已发布目标搜索、错误类型和未发布目标拒绝；关联名称和路径自动解析；分类改名同步；草稿标题不会泄露到导航。
3. 下架隐藏整条分支、重新发布恢复；移动分支、同级顺序、新窗口标记及引用删除保护。
4. 旧版本更新和删除返回冲突；并发更新同一个版本只有一个成功，另一个返回 409；成功菜单日志包含对象信息。
5. 真实数据库事务同时回滚菜单和审计。重启及恢复到独立新库后，完整菜单管理状态一致，配套附件与密钥可用。
6. schema 1 → 4、2 → 4、3 → 4 和重复升级；旧库普通启动就绪返回 503 且不修改表结构。冻结旧版菜单映射创建历史数据，验证旧 ID、名称、URL、排序、主题配置及其版本保持不变。
7. 新增父 ID、资源 ID 等字符串列在升级时显式归一化，兼容 FreeSql 添加旧表列时出现的 NULL；旧菜单默认顶级、自定义链接、当前窗口、版本 0。

首轮 v3 升级检查发现新增字符串列为 NULL，修正升级步骤后才执行以上最终四库验收和用户预览升级。SQLite 额外复验 Consul 配置优先级及启用后读取失败行为。

### 浏览器与 Docker HTTPS：4 个综合用例通过

Windows Microsoft Edge 无头浏览器，独立 Docker 项目、随机端口与凭据，Production HTTPS。最终 4 个 Playwright 综合用例通过，总计 **50.2 秒**，导航用例 **8.5 秒**。

- 后台创建根菜单及五种类型，选择父项、选择目标、自动名称/地址、排序、新窗口；父选择列表排除自己和后代。
- 注入 503 和制造真实 409 冲突，错误反馈可见且输入保留；取消放弃编辑仍保留输入。有子项的删除操作显示保护提示。
- 四套主题分别在 375、768、1440 像素检查嵌套展开、无横向溢出、Enter/Space、Escape 收起与恢复焦点、导航外点击收起。几何断言保证嵌套内容在父行下方。
- 原始 HTML 包含关联文章和分类链接；主题预览内的页面链接保持预览路径，新窗口标签链接仍处于同一主题预览。
- 原有内容发布、未保存保护、SEO、加载恢复、主题配置与预览用例继续通过。
- HTTPS 同域路由、Secure Cookie、附件和 SSR、重启后的完整菜单/主题状态及原登录会话通过。

视觉复核查看了经典桌面、极简桌面、杂志平板、暗色手机的展开菜单，以及后台手机和平板树形表单。中间截图发现嵌套内容挤压父项文字，已修复并重新构建验收；手机后台截图原先捕捉到侧栏收起动画中间态，最终截图禁用动画且断言侧栏已在屏幕外。

本地截图：`artifacts/navigation-{classic|paper|magazine|midnight}-{375|768|1440}.png`、`navigation-admin-{375|768|1440}.png`。截图为独立测试内容，不是用户日常预览的数据。

## 本地预览升级

停止服务后，以 SQLite 备份 API 备份数据库，并复制附件与认证密钥至 `.local/backups/pre-v4-20260914-162208/`，生成 SHA-256 清单。显式执行 `--migrate` 将 schema 3 升级到 4，再启动本地预览。

升级前后按表逐行比较旧字段，验证原账号、5 篇内容、5 条附件记录、站点设置、38 条历史审计和主题配置保留。用户原先启用的 **paper（极简阅读）** 及每套主题设置均保持原值；原库没有自定义菜单项，测试没有向日常预览写入示例菜单。

重启后原凭据登录、健康检查、菜单及目标读取、paper 服务端 HTML、全部原附件读取均通过。原始行保持一致（允许初始化新增审计），附件与密钥哈希不变，SQLite 完整性检查通过。证据为 `.local/preview-v4-verification.json` 和备份清单；凭据和备份不进入源码管理。

## 复现与边界

```powershell
dotnet build --no-restore
python tests/run_matrix.py all
npm --prefix web run api:types
npm --prefix web run typecheck
npm --prefix web run build
docker build -f deploy/Dockerfile.api -t cms-api:local .
docker build -f deploy/Dockerfile.web -t cms-web:local .
python tests/docker_smoke.py
```

测试需要 Docker、项目 npm 依赖、Microsoft Edge 和 Python `cryptography`；必须使用独立测试站点，不得改为日常预览地址。

本期为单一主导航，最多 5 级；没有增加多菜单组、菜单元数据、模板位置分配、拖拽排序或批量删除分支。保留单 API 实例写入边界；没有多副本并发、长期压力、Safari/Firefox 或真实手机验收，也没有部署到外部服务器。
