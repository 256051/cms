import type { MetadataRoute } from "next";
import { publicApi, siteUrl } from "@/lib/server";
import type { Settings } from "@/lib/types";
export const dynamic = "force-dynamic";
export default async function robots(): Promise<MetadataRoute.Robots> {
  const site = await publicApi<Settings>("settings");
  if (site.blockSearchEngines) return { rules: { userAgent: "*", disallow: "/" } };
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/admin", "/api", "/search"],
    },
    sitemap: siteUrl() + "/sitemap.xml",
  };
}
