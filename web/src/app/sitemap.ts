import type { MetadataRoute } from "next";
import { publicApi, siteUrl } from "@/lib/server";
import { contentUrl, type Content, type Taxonomy, type Settings } from "@/lib/types";
export const dynamic = "force-dynamic";
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  if ((await publicApi<Settings>("settings")).blockSearchEngines) return [];
  const [posts, terms, home] = await Promise.all([
    publicApi<Content[]>("sitemap"),
    publicApi<Taxonomy[]>("taxonomy"),
    publicApi<Content | null>("home"),
  ]);
  return [
    ...(home?.seo?.noIndex ? [] : [{ url: siteUrl() }]),
    ...(["product", "case"] as const).filter(kind => posts.some(x => x.kind === kind)).map(kind => ({ url: siteUrl() + (kind === "product" ? "/products" : "/cases") })),
    ...terms.map((t) => ({ url: `${siteUrl()}/${t.kind}/${t.slug}` })),
    ...posts.map((p) => ({
      url: siteUrl() + contentUrl(p),
      lastModified: p.lastPublishedAt || p.publishedAt || undefined,
    })),
  ];
}
