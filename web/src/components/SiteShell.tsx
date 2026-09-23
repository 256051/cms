import { Suspense } from "react";
import { cookies } from "next/headers";
import { publicApi, siteUrl } from "@/lib/server";
import type { Settings, Menu, ThemeView, Taxonomy, PageLayout } from "@/lib/types";
import { colorModeCookie, parseColorMode, themeSource, themeModeStyle, secondBatchThemeIds, type ThemeContext } from "@/lib/theme";
import { SiteHeader, SiteFooter } from "./SiteChrome";
import ThemeSidebar from "./ThemeSidebar";
import PublicTraffic from "./PublicTraffic";

export default async function SiteShell({
  children,
  context,
  layout,
}: {
  children: React.ReactNode;
  context?: ThemeContext;
  layout?: PageLayout | null;
}) {
  const [site, menus, theme, friendLinks] = await Promise.all([
    publicApi<Settings>("settings"),
    publicApi<Menu[]>("menu"),
    context?.theme ?? publicApi<ThemeView>("theme"),
    publicApi<Menu[]>("friend-links"),
  ]);
  const source = themeSource(theme.themeId);
  const hasSidebar = !layout && ["fuwari", "chirpy", "stellar", "halorum", "aurora", "iemo", "clarity"].includes(theme.themeId);
  const secondBatch = secondBatchThemeIds.some(id => id === theme.themeId);
  const taxonomy = hasSidebar ? await publicApi<Taxonomy[]>("taxonomy") : [];
  const colorMode = parseColorMode((await cookies()).get(colorModeCookie)?.value);
  return (
    <div className={`public-site theme-${theme.themeId}${source ? " community-theme" : ""}${secondBatch ? " collection-theme" : ""}${layout ? " has-page-layout" : ""}`} data-theme={theme.themeId} style={themeModeStyle(theme)} lang={site.language}>
      {context?.preview && <div className="theme-preview-bar" role="status">主题预览 · 尚未应用到网站 <a href="/admin/themes" target="_blank" rel="noopener">返回主题管理 ↗</a></div>}
      <a className="skip-link" href="#main">
        跳到正文
      </a>
      {layout?.showHeader !== false && <SiteHeader site={site} menus={menus} origin={siteUrl()} preview={context?.preview} colorMode={colorMode} />}
      {hasSidebar ? <div className="community-layout">
        <main id="main">{children}</main>
        <ThemeSidebar site={site} taxonomy={taxonomy} preview={context?.preview} />
      </div> : <main id="main">{children}</main>}
      <Suspense fallback={null}><PublicTraffic preview={!!context?.preview} /></Suspense>
      {layout?.showFooter !== false && <SiteFooter site={site} friendLinks={friendLinks} />}
    </div>
  );
}
