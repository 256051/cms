import { publicApi, siteUrl } from "@/lib/server";
import { contentUrl, type Content, type Page, type Settings } from "@/lib/types";
export const dynamic = "force-dynamic";

export async function GET() {
  const [site, posts] = await Promise.all([publicApi<Settings>("settings"), publicApi<Page<Content>>("contents?kind=post&pageSize=50")]);
  const xml = (text: string) => text.replace(/[^\u0009\u000A\u000D\u0020-\uD7FF\uE000-\uFFFD\u{10000}-\u{10FFFF}]/gu, "")
    .replace(/[<>&"']/g, c => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" })[c]!);
  const items = posts.items.map(post => `<item><title>${xml(post.title)}</title><link>${xml(siteUrl() + contentUrl(post))}</link><guid isPermaLink="true">${xml(siteUrl() + contentUrl(post))}</guid><description>${xml(post.summary)}</description><pubDate>${new Date(post.publishedAt!).toUTCString()}</pubDate></item>`).join("");
  return new Response(`<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>${xml(site.title)}</title><link>${xml(siteUrl())}</link><description>${xml(site.description)}</description><language>${xml(site.language)}</language>${items}</channel></rss>`, { headers: { "Content-Type": "application/rss+xml; charset=utf-8", "Cache-Control": "no-store" } });
}
