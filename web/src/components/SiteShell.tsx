import Link from "next/link";
import { Suspense } from "react";
import { cookies } from "next/headers";
import { BookOpen, ArrowUpRight } from "lucide-react";
import { publicApi, siteUrl } from "@/lib/server";
import type { Settings, Menu, ThemeView, Taxonomy } from "@/lib/types";
import { colorModeCookie, parseColorMode, defaultCopyright, siteHref, themeSource, themeModeStyle, secondBatchThemeIds, type ThemeContext } from "@/lib/theme";
import SiteNavigation from "./SiteNavigation";
import ThemeSidebar from "./ThemeSidebar";
import ColorModeSwitch from "./ColorModeSwitch";
import PublicTraffic from "./PublicTraffic";

export default async function SiteShell({
  children,
  context,
}: {
  children: React.ReactNode;
  context?: ThemeContext;
}) {
  const [site, menus, theme] = await Promise.all([
    publicApi<Settings>("settings"),
    publicApi<Menu[]>("menu"),
    context?.theme ?? publicApi<ThemeView>("theme"),
  ]);
  const href = (path: string) => siteHref(path, context?.preview);
  const source = themeSource(theme.themeId);
  const hasSidebar = ["fuwari", "chirpy", "stellar", "halorum", "aurora", "iemo", "clarity"].includes(theme.themeId);
  const secondBatch = secondBatchThemeIds.some(id => id === theme.themeId);
  const taxonomy = hasSidebar ? await publicApi<Taxonomy[]>("taxonomy") : [];
  const colorMode = parseColorMode((await cookies()).get(colorModeCookie)?.value);
  return (
    <div className={`public-site theme-${theme.themeId}${source ? " community-theme" : ""}${secondBatch ? " collection-theme" : ""}`} data-theme={theme.themeId} style={themeModeStyle(theme)} lang={site.language}>
      {context?.preview && <div className="theme-preview-bar" role="status">主题预览 · 尚未应用到网站 <a href="/admin/themes" target="_blank" rel="noopener">返回主题管理 ↗</a></div>}
      <a className="skip-link" href="#main">
        跳到正文
      </a>
      <header className="site-header">
        <Link href={href("/")} className="brand">
          {site.logoId ? (
            <img src={`/media/${site.logoId}`} alt="" width="32" height="32" />
          ) : (
            <BookOpen size={25} />
          )}
          <span className="brand-copy"><strong>{site.title}</strong>{site.subtitle && <small>{site.subtitle}</small>}</span>
        </Link>
        <div className="site-header-tools">
          <SiteNavigation items={menus} preview={context?.preview} origin={siteUrl()} />
          <ColorModeSwitch initialMode={colorMode} />
        </div>
      </header>
      {hasSidebar ? <div className="community-layout">
        <main id="main">{children}</main>
        <ThemeSidebar site={site} taxonomy={taxonomy} preview={context?.preview} />
      </div> : <main id="main">{children}</main>}
      <Suspense fallback={null}><PublicTraffic preview={!!context?.preview} /></Suspense>
      <footer className="site-footer">
        <div>
          <BookOpen size={20} />
          <strong>{site.title}</strong>
        </div>
        <p>{site.description}</p>
        <span>
          <span className="site-footer-text">{site.footerText.trim() || defaultCopyright()}</span>
          <a href="/admin">
            内容管理 <ArrowUpRight size={13} />
          </a>
        </span>
      </footer>
    </div>
  );
}
