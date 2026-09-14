import Link from "next/link";
import { BookOpen, ArrowUpRight } from "lucide-react";
import { publicApi, siteUrl } from "@/lib/server";
import type { Settings, Menu, ThemeView, Taxonomy } from "@/lib/types";
import { defaultCopyright, siteHref, themeSource, themeStyle, type ThemeContext } from "@/lib/theme";
import SiteNavigation from "./SiteNavigation";
import ThemeSidebar from "./ThemeSidebar";

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
  const taxonomy = theme.themeId === "fuwari" ? await publicApi<Taxonomy[]>("taxonomy") : [];
  return (
    <div className={`public-site theme-${theme.themeId}${source ? " community-theme" : ""}`} data-theme={theme.themeId} style={themeStyle(theme)} lang={site.language}>
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
        <SiteNavigation items={menus} preview={context?.preview} origin={siteUrl()} />
      </header>
      {theme.themeId === "fuwari" ? <div className="community-layout">
        <main id="main">{children}</main>
        <ThemeSidebar site={site} taxonomy={taxonomy} preview={context?.preview} />
      </div> : <main id="main">{children}</main>}
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
        {source && <p className="theme-credit">主题 <a href={source.url} target="_blank" rel="noopener noreferrer">{source.name}</a> · IT猫 CMS 适配 · MIT</p>}
      </footer>
    </div>
  );
}
