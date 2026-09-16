import { publicApi } from "@/lib/server";
import { siteHref, type ThemeContext } from "@/lib/theme";
import type { Content, Page, PageLayout } from "@/lib/types";
import PageLayoutView from "./PageLayoutView";

export default async function PageLayoutContent({ layout, context }: { layout: PageLayout; context?: ThemeContext }) {
  const entries = await Promise.all(layout.blocks.filter(x => x.type === "posts" && !x.hidden).map(async block => {
    const data = await publicApi<Page<Content>>(`contents?kind=${block.contentKind || "post"}&categoryId=${block.categoryId}&size=${block.limit}`);
    return [block.id, data.items] as const;
  }));
  return <PageLayoutView layout={layout} posts={Object.fromEntries(entries)} preview={!!context?.preview}
    href={path => path.startsWith("/") && !path.startsWith("/media/") ? siteHref(path, context?.preview) : path} />;
}
