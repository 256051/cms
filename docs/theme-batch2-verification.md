# 第二批八套博客主题验收

日期：2026-09-15。新增 Chirpy、Oranges、Aircloud、Stellar、Halorum、Aurora、iEmo、Clarity，目录由七套增加到十五套。

## 实现与来源

- 八套均为现有 CMS 的博客布局适配，提供首页、文章、独立页、分类标签、搜索、分页、评论和富文本展示；十一套社区主题都有渐进增强的文章目录。
- 共用管理员主题管理、三项独立设置、只读预览、版本冲突检测及原子启用日志。没有改表、升级依赖或复制 Halo 插件运行时，schema 仍为 6。
- 原作采用固定提交；七套 MIT、一套 BSD-3-Clause，完整版权和许可随源码、web 镜像保留。iEmo 通过 Git 获取完整原作许可；Clarity 采用 blog-v3 代码，不带作者文章。来源、文件映射和许可哈希见 [来源记录](theme-upstreams.json)。
- 不提供原作全部业务：Stellar 为博客版，Halorum 为文章列表版；论坛账号、访客投稿、通知、天气、知识库组织、友链、瞬间及第三方服务不在本批范围。没有虚构入口、评论统计或远程演示素材。
- 后台卡片和前台页脚不展示原作链接；站点自定义版权及默认 IT猫版权继续生效。

## 构建与四库

- `dotnet build -c Release --no-restore` 和本地 Debug 构建通过，0 警告、0 错误；前端类型检查、Next.js 生产构建及 API/web 镜像构建通过。
- 使用 Release 程序运行 `python tests/run_matrix.py all`：SQLite 45、PostgreSQL 44、MySQL 44、SQL Server 44，共 **177 组通过**。原始记录：`artifacts/e4b6021781/results.json`。
- 同一组检查遍历十五套主题的默认值、权限、CSRF、非法输入、私密预览、各自配置保存与恢复、公开接口隔离及过期版本冲突，并发启用使用 Chirpy / Clarity 验证一个版本只能成功一次。
- 同时验证现有内容、附件、评论、菜单、设置、Agent API、事务回滚、旧库逐级升级、重复初始化、正常启动不改表、重启及备份恢复；均为独立数据库。

## 主题页面与缩略图

- 修正后在独立 HTTPS 站点执行两项主题 Playwright 流程，均通过：`artifacts/docker-a836d3144c/browser.log` 与 `results.json`。
- 十五套主题覆盖 375、768、1440 像素下的首页、文章、独立页、分类、标签、搜索及第二页；检查横向溢出、导航首屏位置、正文 HTML、标题、描述、canonical、noindex、空内容、配色对比度及配置冲突。
- 十一套社区主题验证未保存预览隔离、重复标题的独立目录锚点、无标题时隐藏目录、键盘折叠与定位、禁用 JavaScript 后正文可读，以及手机端正文在资料栏之前。
- 十五张缩略图均来自独立测试站点的真实渲染页面，已重新构建到 web 镜像。镜像内十五张图片及十一份原作许可的 SHA-256 核对通过：`artifacts/batch2-image-files.json`。
- 首轮 `docker-8350ca2950` 的两项自动流程通过后，视觉检查发现 Aircloud、Stellar、Clarity 继承全局 `margin: auto` 导致导航在长列表中垂直居中。已在共享主题规则清除垂直自动外边距，并增加导航首屏位置和可见范围断言；最终截图采用修正后的结果。

## 本地更新

- 更新前备份数据库、附件、认证密钥、原凭据及进程记录：`.local/backups/batch2-20260915-105605`。
- 构建后逐表比对已有字段与每行内容，并核对附件、密钥和凭据文件；schema 保持 6，原有 1 个管理员、23 篇内容、28 个附件、1 个 API 令牌及其他业务记录保留。记录：`artifacts/batch2-20260915-105605/results.json`。
- 使用原账号完成登录，后台十五张缩略图加载成功，八套新增主题可用原站内容预览；读取前后主题状态和文章列表一致，当前仍为 `classic`。记录：`artifacts/batch2-local-browser.json`。
- 本地主题管理：`http://localhost:3000/admin/themes`。旧离线 Docker 包不会自动更新；部署需使用新 API/web 镜像。未部署到外部服务器。

## 最终 Docker HTTPS 回归

- 使用最终 API/web 镜像运行 `python tests/docker_smoke.py`，退出码为 0；完整结果：`artifacts/docker-21d12ae530/results.json`。
- 九个 Playwright 流程全部通过（3.3 分钟），包括令牌管理、文章发布、十一套社区主题、富文本、表单保护与 SEO、验证码登录、十五套主题多级菜单、站点设置和十五套主题完整页面验收。浏览器记录：`artifacts/docker-21d12ae530/browser.log`。
- 验证 Compose 初始化、Nginx HTTPS 同域代理、生产安全 Cookie / CSRF、上传发布及服务端正文；同时通过 Agent API 权限、重试幂等、限流、附件安全和富文本净化检查。
- 重启 API、web 和网关后，数据库、附件、认证会话、主题配置、菜单、站点设置、令牌及幂等记录保持有效。测试使用独立站点，运行后已清理本轮测试容器及数据卷。
- 本批交付源码、十五张真实缩略图、十一份上游许可、更新文档和已验证的本地镜像；既有离线发布包保持不变，未上传 GitHub 或部署外部服务器。
