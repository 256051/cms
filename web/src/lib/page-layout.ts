import type { PageBlock, PageBlockItem, PageLayout } from "./types";

export const blockLabels: Record<string, string> = { shared: "公共区块", hero: "首屏横幅", text: "文字介绍", image: "图片展示", cards: "图文卡片", posts: "文章列表", faq: "常见问题", cta: "行动按钮", contact: "客户咨询" };
export const newItem = (): PageBlockItem => ({ title: "项目标题", text: "填写项目说明", imageId: "", imageAlt: "", linkText: "了解详情", linkUrl: "" });
export const newBlock = (type: string): PageBlock => ({ id: crypto.randomUUID().replaceAll("-", ""), type,
  title: blockLabels[type], text: "", imageId: "", imageAlt: "", linkText: "了解更多", linkUrl: "", items: type === "cards" || type === "faq" ? [newItem()] : [],
  categoryId: "", limit: 6, columns: 3, tone: type === "hero" || type === "cta" ? "soft" : "plain", align: "left", spacing: "normal", hidden: false,
  html: "", sharedId: "", contentKind: "post", mobile: { align: "", spacing: "", columns: 1, textSize: "", hidden: false } });
export const newLayout = (blocks: PageBlock[] = []): PageLayout => ({ version: 1, width: "wide", showTitle: false, showHeader: true, showFooter: true, blocks });
export const starterLabels = { company: "企业首页", product: "产品介绍", about: "关于我们", contact: "联系我们" };
export function starterLayout(name: keyof typeof starterLabels): PageLayout {
  const types = name === "company" ? ["hero", "cards", "posts", "contact"] : name === "product" ? ["hero", "cards", "faq", "contact"] : name === "about" ? ["hero", "text", "cards", "cta"] : ["text", "contact"];
  return newLayout(types.map(type => ({ ...newBlock(type), ...(type === "hero" ? { title: starterLabels[name], text: "在这里介绍你的品牌、产品或服务。" } : {}) })));
}
