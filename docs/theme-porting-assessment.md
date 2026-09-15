# Halo 主题分批改造筛选

核查日期：2026-09-14。目标项目维持现有 .NET / FreeSql 后端、Next.js / React 前端与 MIT 开源路线。

后续进展（2026-09-15）：第一批 Fuwari、Retypeset、Cactus 已完成适配，采用三套原作来源；最终交付范围及实际验证见 [社区主题验收记录](community-themes-verification.md)。以下保留当时的筛选结论。

第二批进展（2026-09-15）：Chirpy、Oranges、Aircloud、Stellar、Halorum、Aurora、iEmo、Clarity 已按博客布局适配。iEmo 已通过 Git 获取原作完整 MIT 许可；实际范围和验收见 [第二批主题记录](theme-batch2-verification.md)。以下第二批条目保留初筛时的分析，不代表完整原作功能承诺。

## 结论与范围

建议第一批做 **Fuwari、Retypeset，以及从 Cactus 原作适配的 Higan 类极简技术风格**。三种布局分别覆盖图文卡片、书籍排版、紧凑文字列表，适合现有内容模型。这里的“可改”是源码筛选结论，不是已完成移植或已经通过运行验收。

本次读取 [Awesome Halo](https://github.com/halo-sigs/awesome-halo) 的 Halo 2.0 主题目录，共 **63 套主题和 4 个开发脚手架**。全目录只做根许可证、README 与主题元数据初筛；对首批候选、可替代的原作来源及复杂主题进一步检查模板、包配置和依赖。没有逐个运行 63 套主题，也没有完成所有附带图片、字体、图标和依赖的授权审计。

完整初筛记录见 [theme-catalogue-review.json](theme-catalogue-review.json)，其中保留来源地址、分支、文本校验值、读取失败以及后续核查结论。“未取得根许可证”不等于断言项目没有许可；“根许可证写 MIT”也不等于全部资源和上游都已核验。

## 第一批：三个独立改造单元

### 1. Fuwari：图文卡片与侧栏

- **采用来源：** [saicaca/fuwari 原作](https://github.com/saicaca/fuwari)，需要 Halo 适配细节时逐文件核对 [Halo Fuwari](https://github.com/jiewenhuang/halo-theme-fuwari)。两者 LICENSE 均为 MIT；Halo 版 theme.yaml 也写 MIT，package.json 未声明另一许可证，README 图片 alt 残留 GPL 字样，归属记录应以实际使用文件与正式许可为依据。[原作许可](https://github.com/saicaca/fuwari/blob/main/LICENSE)、[Halo 版许可](https://github.com/jiewenhuang/halo-theme-fuwari/blob/main/LICENSE)
- **改造内容：** 卡片列表、侧栏、封面与无封面状态、移动导航、正文目录，接入现有分类标签、搜索、分页和评论。Astro / Svelte 组件需要转成 React。
- **已检查的数据路径：** 首页文章循环读取 posts.items；搜索组件调用 Halo 搜索接口，可以替换为 CMS 搜索。核心首页未发现必须安装额外内容插件才能显示的调用。[文章列表](https://github.com/jiewenhuang/halo-theme-fuwari/blob/main/src/components/PostList.astro)、[搜索组件](https://github.com/jiewenhuang/halo-theme-fuwari/blob/main/src/components/Search.svelte)
- **首版边界：** 保留 CMS 多级菜单，头像优先使用站点 Logo，横幅使用自有资源。图库、瞬间、音乐、任意 HTML 小部件、完整原作动画不是这套博客布局的完成条件。
- **预计工作量：** 中。主要工作在页面结构与交互，不需要为核心博客新增数据库表。

### 2. Retypeset：书籍式阅读与文本目录

- **采用来源：** [Halo Retypeset](https://github.com/picsky/halo-theme-retypeset) 或 [Astro 原作](https://github.com/radishzzz/astro-theme-retypeset)。两边 LICENSE 均为 MIT，Halo 的 package.json 和 theme.yaml 也声明 MIT。保留 radishzz 与实际使用的 Halo 适配作者署名。[Halo 许可](https://github.com/picsky/halo-theme-retypeset/blob/main/LICENSE)、[原作许可](https://github.com/radishzzz/astro-theme-retypeset/blob/master/LICENSE)
- **改造内容：** 窄栏留白、文本文章列表、日期、侧边导航、标题层次、目录与移动阅读；文章、独立页面、搜索、评论复用现有功能。
- **依赖情况：** 原实现对 KaTeX、MathJax、Mermaid 等先检查存在再调用；普通 HTML 正文不强制依赖数学引擎。搜索按钮需要改接 CMS，不能保留无响应的 Halo SearchWidget 调用。[主脚本](https://github.com/picsky/halo-theme-retypeset/blob/main/src/main.ts)
- **资源边界：** 模板预载了 Snell 等字体，本次未核实每个字体的再分发授权，首版使用系统字体，不承诺原字体字形完全一致。[字体引用](https://github.com/picsky/halo-theme-retypeset/blob/main/templates/modules/base-head.html)
- **预计工作量：** 低至中。比现有 paper 更重视正文结构与侧边导航，不应仅换一组颜色。

### 3. Cactus：Higan 来源的极简技术博客

- **采用来源：** 直接从 [probberechts/hexo-theme-cactus](https://github.com/probberechts/hexo-theme-cactus) 的 MIT 原作适配。保留 Pieter Robberechts、Gabriela Thumé、Natalya Kosenko 的版权信息。[原作完整许可](https://github.com/probberechts/hexo-theme-cactus/blob/master/LICENSE)
- **为何不直接复制 Halo Higan：** 其 LICENSE 和 theme.yaml 写 MIT，但 package.json 写 GPL-3.0，存在声明不一致。这里不擅自判断哪份覆盖所有新增代码，也不通过改成 React 消除许可要求。[Higan LICENSE](https://github.com/guqing/halo-theme-higan/blob/main/LICENSE)、[Higan package.json](https://github.com/guqing/halo-theme-higan/blob/main/package.json)
- **改造内容：** 紧凑页头、日期与标题列表、分类标签、简洁正文、代码区域、手机导航。CMS 评论、搜索、富文本媒体照常可用。
- **首版边界：** 不复制 Halo 版新增代码、默认头像、未经核实的 Meslo 字体及打包图标。后台名称注明 Cactus 适配来源，不冒充官方 Higan 版本。
- **预计工作量：** 低至中。核心数据与当前 CMS 接近。

## 第二批：可做，但明确采用来源和功能范围

- **Chirpy：技术博客侧栏与文章目录。** Jekyll 原作明确 MIT；Halo 版 LICENSE / README 与 package.json 的许可声明不一致，且完整效果依赖 halo-plugin-chirpy。建议从原作适配，搜索评论改接 CMS，不带默认头像、PWA、统计和全部数学扩展。[原作许可](https://github.com/cotes2020/jekyll-theme-chirpy/blob/master/LICENSE)、[Halo 包声明](https://github.com/AirboZH/halo-theme-chirpy/blob/master/package.json)
- **Oranges：日期与标题为主的极简列表。** 原作 MIT；Halo 版 package.json 声明 GPL-3.0且保留脚手架元数据，初筛未取得根许可证。优先改原作，不混入 Halo 适配代码。[原作许可](https://github.com/zchengsite/hexo-theme-oranges/blob/master/LICENSE)
- **Aircloud：侧栏与清爽文字列表。** 原作 MIT；Halo 版 package.json 写 ISC、README 许可徽章写 CC BY-NC-SA 4.0，优先采用原作。[原作许可](https://github.com/aircloud/hexo-theme-aircloud/blob/master/LICENSE)、[Halo README](https://github.com/bit15k/halo-theme-aircloud/blob/main/README.md)
- **Stellar 博客版：侧栏、卡片和阅读列。** Halo 与 Hexo 原作 LICENSE 均为 MIT；先实现博客页面，完整文档组织、自定义组件以及图库、瞬间另行处理。[Halo 许可](https://github.com/chengzhongxue/halo-theme-stellar/blob/main/LICENSE)、[原作许可](https://github.com/xaoxuu/hexo-theme-stellar/blob/main/LICENSE)
- **Halorum 文章列表版：论坛式内容列表。** Halo 与 Typecho 原作均 BSD-3-Clause，保留许可与署名。可适配文章外观；用户中心、通知、访客投稿属于尚不存在的业务，不能保留成虚假的功能入口。[Halo 仓库](https://github.com/xzyone/halo-theme-halorum)、[原作许可](https://github.com/mulingyuer/Typecho_Theme_JJ/blob/main/LICENSE)
- **Aurora：图文博客布局。** Halo 与 Hexo 原作 LICENSE 均为 MIT；README 将插件列为可选。主题配置较多，宜后于首批；搜索评论替换为 CMS，追番、友链、瞬间不计入基础博客版。[Halo 仓库](https://github.com/Roozenlz/halo-theme-aurora)、[原作许可](https://github.com/auroral-ui/hexo-theme-aurora/blob/master/LICENSE)
- **iEmo：简约博客。** Halo 与 WordPress 原作 LICENSE 均为 MIT。可进入下一轮模板细查；豆瓣、装备、瞬间、友链属于独立功能，不能只搬页面入口。[Halo 许可](https://github.com/chengzhongxue/halo-theme-iemo/blob/main/LICENSE)、[原作许可](https://github.com/kannafay/iEmo/blob/main/LICENSE)
- **Clarity 原作路线：三栏布局。** Halo 版 GPL-3.0；其原作 blog-v3 的代码为 MIT，博客文章另有 CC BY-NC-SA 许可。可以后续从原作代码适配，不复制原作者文章或混入 Halo GPL 版特有实现。完整天气、小部件、复杂内容块工作量较大。[原作代码许可](https://github.com/L33Z22L11/blog-v3/blob/main/LICENSE)、[原作说明](https://github.com/L33Z22L11/blog-v3)

## 第三批：技术可做，先处理授权或补足业务

- **Earth、Stack、Hao、S1mp1e、Next（AeroWang 版）、Mainroad：** 核心博客可以适配。前五者为 GPL-3.0，Mainroad 为 GPLv2；GPL 并非禁止改造，但组合发布、源码提供和声明义务不能用根 MIT 文件替代，也不能仅靠放进另一个目录就假定隔离。Hao 配置和交互很多，成本更高。AeroWang Next 虽同属 Next.js，仍需替换旧 Halo API、ISR、认证和路由。[Earth 许可](https://github.com/halo-dev/theme-earth/blob/main/LICENSE)、[Stack](https://github.com/jiewenhuang/halo-theme-stack)、[Hao](https://github.com/chengzhongxue/halo-theme-hao)、[S1mp1e](https://github.com/lyujp/theme-s1mp1e)、[Next](https://github.com/AeroWang/theme-next)、[Mainroad](https://github.com/Arch4AI/theme-mainroad)
- **HeoLink、Mcnav：** 是链接目录站，首页读取分组、图标、描述等内容，现有导航菜单不能完整代替。需要先定义链接管理功能。HeoLink 为 Apache-2.0；Mcnav 为 GPL-3.0。[HeoLink 首页](https://github.com/zhheo/halo-theme-heolink/blob/main/templates/index.html)、[Mcnav 首页](https://github.com/chengzhongxue/halo-theme-mcnav/blob/main/templates/index.html)
- **Ocean：** GPL-3.0，可归入知识库批次。基础仍是文章、分类、标签、菜单，不必先造全新知识库实体；完整效果还需分类封面与颜色、首页模块配置以及统计能力。[分类模板](https://github.com/lxware-dev/theme-ocean/blob/master/templates/modules/index/category-filter.html)
- **Anatole：** Halo next 分支 package.json 写 GPL-3.0。Farbox 原作 README 声明 MIT，但本次未取得独立许可全文；可作为后续原作来源候选，进一步核对授权范围。[Halo 包声明](https://github.com/halo-dev/halo-theme-anatole/blob/next/package.json)、[原作说明](https://github.com/hi-caicai/farbox-theme-Anatole#license)

## 暂不纳入当前开源预置包

- **Jyf：** 当前自定义许可证只允许个人非商业使用，禁止分发原版或修改版。未取得额外授权前，不复制进本项目。[许可证](https://github.com/PpKoK/theme-jyf/blob/main/LICENSE)
- **Moderna：** Halo 仓库虽然标 MIT，但源码注明来自 BootstrapMade Moderna。上游现行条款不允许将模板整体或部分制成 CMS 主题批量公开分发，未发现覆盖本项目用途的独立授权。暂缓，不能只根据移植仓库的 MIT 标记放行。[源 CSS](https://github.com/Arch4AI/theme-moderna/blob/master/templates/assets/css/style.css)、[上游分发条款](https://bootstrapmade.com/license/)
- **Joe3.0：** 根许可证为 CC BY-NC-SA 4.0，含非商业和相同方式共享条件，不能作为无限制 MIT 内容直接合并。[许可证](https://github.com/jiewenhuang/halo-theme-joe3.0/blob/main/LICENSE)
- **Geek：** 本次源码文件列表、README、配置未找到清楚的项目级授权；个别 JS 文件的 MIT 注释不能替代全主题许可。补清授权与准确上游来源后再定。[仓库](https://github.com/mytianya/halo-theme-geek)
- **其他仅完成根许可初筛的主题：** 见完整清单，统一保持“待进一步核查”，不因名称、热度或一个许可徽章自动纳入。

## 改造任务分配建议

1. **公共接入：** 复用 ThemeService、ThemeManager、SiteShell、PublicPages 及现有预览协议；新主题采用稳定 ID。现有 JSON 配置可以承载新增主题的基础选项，首批无须为此改表。若增加横幅/侧栏设置，再明确受控选项及版本兼容，避免复制任意 HTML/CSS 配置。
2. **三个独立页面任务：** Fuwari、Retypeset、Cactus 各自负责首页与正文结构、主题限定样式、移动导航和真实缩略图。共享文件由公共接入任务统一修改，避免互相覆盖。
3. **统一验收：** 每套覆盖首页、文章、独立页、分类标签、搜索、分页、评论；核对富文本表格、代码、图库、音视频、嵌入和分栏，不因移植皮肤降低现有编辑器能力。
4. **发布前核查：** 保留实际复用部分的作者和许可、列出所用文件及固定上游提交；使用自有示例图和已核验资源。完成预览不影响访客、保存冲突、切换恢复、SEO、手机布局、构建与运行验收之后，才标记为“已支持”。

本次交付为筛选与改造分组，没有修改运行中的主题、数据库或站点内容；没有把源码审查当成移植测试通过。
