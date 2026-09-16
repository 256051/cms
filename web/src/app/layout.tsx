import type { Metadata } from "next";
import { cookies } from "next/headers";
import "./globals.css";
import "./traffic.css";
import "./editorial.css";
import "./themes.css";
import "./menus.css";
import "./community-themes.css";
import "./collection-themes.css";
import "./color-modes.css";
import "./page-builder.css";
import { colorModeCookie, parseColorMode } from "@/lib/theme";
import { publicApi, siteUrl } from "@/lib/server";
import type { Settings } from "@/lib/types";

export async function generateMetadata(): Promise<Metadata> {
  // Keep login and the error page reachable when the content service is unavailable.
  const site = await publicApi<Settings>("settings").catch(() => null);
  const title = site?.title || "内容站";
  return {
    metadataBase: new URL(siteUrl()),
    title: { default: title, template: `%s · ${title}` },
    description: site ? site.description : "内容服务暂时不可用。",
    keywords: site?.keywords || undefined,
    icons: site?.faviconId ? { icon: `/media/${site.faviconId}` } : undefined,
    alternates: { types: { "application/rss+xml": "/rss.xml" } },
    robots: site?.blockSearchEngines ? { index: false } : undefined,
  };
}
export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const site = await publicApi<Settings>("settings").catch(() => null);
  return (
    <html lang={site?.language || "zh-CN"} data-color-mode={parseColorMode((await cookies()).get(colorModeCookie)?.value)}>
      <body>{children}</body>
    </html>
  );
}
