# 编辑器实际验收

本次使用独立数据库与随机测试账号，不将测试内容写入日常本地预览。schema 仍为 6，无数据库迁移；不修改已有文章、账号或主题。

## 构建与接口

- .NET Release 构建通过，0 警告、0 错误；前端 TypeScript 检查和生产构建通过。
- 新增 `tests/editor.py`，复用现有 HTTP 测试客户端，包含媒体格式、未公开附件、保存/重新保存/发布、格式净化、iframe 权限、非法结构、CSRF、版本冲突和媒体引用删除保护。
- 同一套回归实际通过 SQLite 44、PostgreSQL 43、MySQL 43、SQL Server 43 组，共 **173 组**；最终后端结果在 `artifacts/f1c168bfde/results.json`。包括新增编辑器 3 组及原有初始化、逐级升级、事务、并发、主题、菜单、设置、Agent API、恢复和重启检查。
- 独立编辑器 HTTP 检查另保存于 `artifacts/editor-http.json`。
- `Cms.Checks --rich-text` 通过：验证净化库将颜色规范化为不透明 `rgba` 后，文字颜色及高亮背景反复保存仍保留，危险 CSS 与带末尾句点的本机/内网域名仍被拒绝。最终四库 HTTP 检查也包含这两个回归点。

## 浏览器

新增 `web/tests/editor.spec.ts`，使用 Microsoft Edge，实际覆盖：

- 粗体、下划线、高亮、字体、字号、文字颜色、行距、对齐的编辑与回读；色盘能正确识别保存后的 `rgba`。
- 粘贴真实图片文件、拖入上传、图片说明/宽度/对齐；附件库多选图片集。
- 图片集解散、撤销、删除最后一张图后清理空结构；本地另验证删除整个分栏、点击嵌入说明修改/删除框架，全程未保存临时内容。
- 二栏正文、代码语言、表格插入、增行、鼠标选区合并和拆分。
- MP4/WAV 上传，原生播放器读取元数据；MP4 实际播放并确认进度前进。
- 网页地址校验、受限 iframe、`/` 菜单的键盘选择与 Escape 退出。
- 收起/显示发布设置、Ctrl+S 保存、刷新回读、发布后服务端 HTML 包含新增结构。
- 四套主题分别在 375、768、1440 像素宽度检查溢出与正文，保存手机截图。
- 保存失败输入保留，重试成功，未发布文字不出现在公开 HTML。

独立浏览器检查已通过。实际生成的示例图片、MP4/VP9、WebM/VP8 和 WAV 位于 `tests/fixtures`；视频/图片由浏览器生成，WAV 为程序生成短音，生成入口为 `tests/create-editor-media.cjs`。MP3 的 HTTP 检查使用帧头/长度样本，不将它作为可播放音频；本次没有穷举所有浏览器和媒体编码组合，也没有转码、实时协作或性能基准结果。

## Docker HTTPS

- 完整部署回归通过 **22 项检查和 8 个浏览器场景**，记录为 `artifacts/docker-f3d1ff1f79/results.json` 及同目录 `browser.log`，覆盖非 root 镜像、Nginx 同域 HTTPS、Secure Cookie、CSRF、媒体、发布、重启、数据库和认证持久化。
- 随后修复颜色规范化及空图片集问题，使用最终 API/web 镜像在新的独立 HTTPS 站点再次运行 **全部 8 个浏览器场景，全部通过**；最终记录为 `artifacts/docker-d1f4d21da2/results.json` 与 `browser.log`。包括颜色保存后的色盘回读、图片集解散/撤销/删除最后一张图片、发布阅读、四主题、多级菜单、设置、账号登录和 Agent 令牌。
- 上述测试容器和卷均由测试创建并在结束后清理。镜像构建日志为 `artifacts/editor-api-image.log`、`artifacts/editor-web-image.log`。未部署到外部服务器。

## 复现

```powershell
dotnet build -c Release --no-restore
dotnet tests/Cms.Checks/bin/Release/net10.0/Cms.Checks.dll --rich-text
npm --prefix web run typecheck
npm --prefix web run build
$env:CMS_TEST_CONFIGURATION='Release'
python tests/run_matrix.py all
docker build -t cms-api:local -f deploy/Dockerfile.api .
docker build -t cms-web:local -f deploy/Dockerfile.web .
python tests/docker_smoke.py
```

运行前按仓库要求安装 .NET SDK、Node、Python 测试依赖、Docker 和 Edge。测试站点只使用脚本新建的数据库和容器。

## 本地预览保护

更新前停止本地预览写入，备份数据库、附件、认证密钥和原凭据；最近一次备份为 `.local/backups/editor-20260914-230135`，对应核对结果为 `artifacts/editor-20260914-230135/results.json`。更新 API/web 后逐表比对原记录、附件/密钥文件哈希及原凭据文件，schema 保持 6，无初始化、迁移或密码重置。

原有 **23 篇内容、28 个附件、1 个账号、主题、站点设置、菜单及 Agent 令牌** 均保留。随后使用原账号逐篇打开 23 篇内容，确认文本完整且读取不会触发未保存状态；没有保存、重新发布或新建文章。浏览器核对见 `artifacts/editor-local-browser.json`，插入菜单截图为 `artifacts/editor-local-{375,768,1440}.png`。本地预览继续使用 `http://localhost:3000`。
