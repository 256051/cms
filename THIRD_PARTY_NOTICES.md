# 第三方主题来源与许可

CMS 的 Fuwari、Retypeset、Cactus 内置主题采用以下原作的布局和视觉规则，重新编写 React 组件与普通 CSS，并接入本项目的内容、导航、搜索、评论与主题管理。没有复制原作的 JavaScript 运行时。它们不是原作官方发行版本，也不提供 Halo 主题安装包或插件的兼容运行时。

转换模板语言或调整样式不改变原作的许可。以下完整 MIT 许可及版权声明随源码保留；再分发涉及的源码或构建产物时，也应随附这些声明。机器可读的固定提交、核对过的源文件与本地实现映射见 [docs/theme-upstreams.json](docs/theme-upstreams.json)。

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
