# 第三方主题来源与许可

访客地区解析另使用 [IP2Region.Net 3.0.2](https://www.nuget.org/packages/IP2Region.Net/3.0.2)（Apache-2.0）及 [ip2region 离线数据](https://github.com/lionsoul2014/ip2region)。固定来源、文件哈希和完整上游许可证随 [GeoData](src/Cms.Services/GeoData/README.md) 一起发布。

CMS 的 Fuwari、Retypeset、Cactus 内置主题采用以下原作的布局和视觉规则，重新编写 React 组件与普通 CSS，并接入本项目的内容、导航、搜索、评论与主题管理。没有复制原作的 JavaScript 运行时。它们不是原作官方发行版本，也不提供 Halo 主题安装包或插件的兼容运行时。

转换模板语言或调整样式不改变原作的许可。以下完整 MIT / BSD-3-Clause 许可及版权声明随源码保留；再分发涉及的源码或构建产物时，也应随附这些声明。机器可读的固定提交、核对过的源文件与本地实现映射见 [docs/theme-upstreams.json](docs/theme-upstreams.json)。

## Fuwari

- 原作：[saicaca/fuwari](https://github.com/saicaca/fuwari)。
- 固定提交：[6d39b0dec41282e7852e23e032998a5789abee28](https://github.com/saicaca/fuwari/commit/6d39b0dec41282e7852e23e032998a5789abee28)。
- 版权所有：Copyright (c) 2024 saicaca。
- 完整许可：[licenses/themes/fuwari.txt](licenses/themes/fuwari.txt)。
- 适配来源：Astro / Svelte 原作的页面布局、卡片、侧栏与样式；采用原作支持的无横幅布局配置，使用 CMS 的数据读取和页面导航。

## Retypeset

- 原作：[radishzzz/astro-theme-retypeset](https://github.com/radishzzz/astro-theme-retypeset)。
- 固定提交：[a636b6d393be714cab52d3fc4baddd3f3905f701](https://github.com/radishzzz/astro-theme-retypeset/commit/a636b6d393be714cab52d3fc4baddd3f3905f701)。
- 版权所有：Copyright (c) 2025 radishzz。
- 完整许可：[licenses/themes/retypeset.txt](licenses/themes/retypeset.txt)。
- 适配来源：Astro 原作的阅读布局、文章列表、导航与排版样式；使用系统字体及 CMS 的正文和交互组件，不复制原作附带字体。

## Cactus

- 原作：[probberechts/hexo-theme-cactus](https://github.com/probberechts/hexo-theme-cactus)。
- 固定提交：[7a6074d830ac5d524582f142ac524c041077aad7](https://github.com/probberechts/hexo-theme-cactus/commit/7a6074d830ac5d524582f142ac524c041077aad7)。
- 版权所有：Copyright (c) 2016 Pieter Robberechts；Copyright (c) 2017 Gabriela Thumé (light colorscheme)；Copyright (c) 2017 Natalya Kosenko (white colorscheme)。
- 完整许可：[licenses/themes/cactus.txt](licenses/themes/cactus.txt)。
- 适配来源：Hexo / EJS 原作的文章索引、正文布局和 Stylus 样式。没有使用 Halo Higan 或其他 Halo 移植版本的新增代码。

## 本地实现范围

三套主题的共享适配文件为 `web/src/app/community-themes.css`、`web/src/lib/theme.ts`、`web/src/components/ContentList.tsx` 和 `web/src/components/SiteShell.tsx`。Fuwari 的侧栏适配另在 `web/src/components/ThemeSidebar.tsx`；Retypeset 和 Cactus 的阅读结构适配共用 `web/src/components/PublicPages.tsx`。

`web/src/components/ArticleToc.tsx` 是本项目自行实现的 DOM 目录增强，不属于从原作逐行复制的代码。上述映射标明布局和视觉规则的适配位置，不表示文件中的所有既有 CMS 代码均来自上游。

## 素材与功能范围

这些主题使用系统字体、站点自身附件及本项目自有素材。上游的字体文件、演示图片、头像、文章、统计与评论服务 SDK 均不包含在本次移植中；不能仅凭主题根目录的 MIT 许可推断这些外部资源也适用相同许可。

本次适配提供 CMS 已有页面和内容能力，不承诺完整复制原作的数学公式、图库、瞬间、音乐、国际化、外部评论服务及所有动画。所使用的 npm / .NET 依赖仍各自遵守其许可；本文记录的是主题原作来源，不替代依赖项的许可声明。

## 第二批博客布局（2026-09-15）

以下八套采用各自原作的布局与视觉规则，功能限定为本 CMS 已有的博客页面；没有复制 Halo 移植版本的新增实现、上游演示数据或额外运行时。

### Chirpy

- 原作：[cotes2020/jekyll-theme-chirpy](https://github.com/cotes2020/jekyll-theme-chirpy)；固定提交 [ae1057257b39](https://github.com/cotes2020/jekyll-theme-chirpy/commit/ae1057257b3927d6474deb549bdfafa71244e080)。
- 版权：Copyright (c) 2019 Cotes Chung。
- 完整许可：[MIT](licenses/themes/chirpy.txt)。
- 采用 Jekyll 原作的侧栏、右侧封面和文章摘要卡片，目录、搜索及评论接入 CMS。

### Oranges

- 原作：[zchengsite/hexo-theme-oranges](https://github.com/zchengsite/hexo-theme-oranges)；固定提交 [ae47484c9ff9](https://github.com/zchengsite/hexo-theme-oranges/commit/ae47484c9ff9ed6cdea5b37ca981e067186c622d)。
- 版权：Copyright (c) 2020 Hexo-Theme-Oranges https://github.com/zchengsite/hexo-theme-oranges。
- 完整许可：[MIT](licenses/themes/oranges.txt)。
- 采用 Hexo 原作的日期与标题目录、居中页头和极简阅读，不采用 Halo 移植代码。

### Aircloud

- 原作：[aircloud/hexo-theme-aircloud](https://github.com/aircloud/hexo-theme-aircloud)；固定提交 [7bd5ae19a858](https://github.com/aircloud/hexo-theme-aircloud/commit/7bd5ae19a85895bbf07a55cefdecd93ad57a1c93)。
- 版权：Copyright (c) 2018 XiaotaoNie。
- 完整许可：[MIT](licenses/themes/aircloud.txt)。
- 采用 Hexo 原作的轻盈侧栏、时间标题行与标签，链接改用 CMS 分类标签归档。

### Stellar

- 原作：[xaoxuu/hexo-theme-stellar](https://github.com/xaoxuu/hexo-theme-stellar)；固定提交 [8cee1cf2e2ed](https://github.com/xaoxuu/hexo-theme-stellar/commit/8cee1cf2e2ed9c1f16051a591ec08e1fbcee0fbb)。
- 版权：Copyright (c) 2021 xaoxuu。
- 完整许可：[MIT](licenses/themes/stellar.txt)。
- 采用 Hexo 原作的侧栏、圆角文章卡片及阅读布局，仅提供博客功能，不包含完整知识库。

### Halorum

- 原作：[mulingyuer/Typecho_Theme_JJ](https://github.com/mulingyuer/Typecho_Theme_JJ)；固定提交 [c953b3c06c32](https://github.com/mulingyuer/Typecho_Theme_JJ/commit/c953b3c06c32f89d32bd618f9416f6506230caa5)。
- 版权：Copyright (c) 2021, 木灵鱼儿。
- 完整许可：[BSD-3-Clause](licenses/themes/halorum.txt)。
- 直接采用 BSD 原作 Typecho Theme JJ 的紧凑信息流与文章卡片；Halorum 为候选风格名称，不复制 Halo 移植代码。无论坛账号、通知、投稿或虚构的回复统计。

### Aurora

- 原作：[auroral-ui/hexo-theme-aurora](https://github.com/auroral-ui/hexo-theme-aurora)；固定提交 [4b82d1c567aa](https://github.com/auroral-ui/hexo-theme-aurora/commit/4b82d1c567aa74d060eddebf87de3ab3edf9ff59)。
- 版权：Copyright (c) 2021 Auroral-UI (Benny Guo)。
- 完整许可：[MIT](licenses/themes/aurora.txt)。
- 采用 Hexo 原作的头条、图文列表及侧栏，渐变采用 CMS 色值；不复制默认封面、字体和第三方服务。

### iEmo

- 原作：[kannafay/iEmo](https://github.com/kannafay/iEmo)；固定提交 [b2bba8f22413](https://github.com/kannafay/iEmo/commit/b2bba8f2241388548b5bdfb5c9a53eb521faf183)。
- 版权：Copyright (c) 2023 神秘布偶猫。
- 完整许可：[MIT](licenses/themes/iemo.txt)。
- 采用 WordPress 原作的左图右文与个人侧栏，不复制默认图片、插件或文章。通过 Git 取得完整 MIT 许可，网页读取失败不再作为阻塞。

### Clarity

- 原作：[L33Z22L11/blog-v3](https://github.com/L33Z22L11/blog-v3)；固定提交 [f6ea97d74551](https://github.com/L33Z22L11/blog-v3/commit/f6ea97d745517feb52f0c100e89acb36f0adc12f)。
- 版权：Copyright (c) 2024 Zhilu。
- 完整许可：[MIT](licenses/themes/clarity.txt)。
- 直接采用 blog-v3 的三栏博客布局及文章摘要结构，不复制 Halo Clarity GPL 版实现，也不复制 CC BY-NC-SA 博客文章、天气或自定义内容块。
