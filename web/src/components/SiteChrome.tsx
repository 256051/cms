import Link from "next/link";
import { BookOpen, ArrowUpRight } from "lucide-react";
import type { Settings, Menu } from "@/lib/types";
import { defaultCopyright, siteHref, type ColorMode } from "@/lib/theme";
import SiteNavigation from "./SiteNavigation";
import ColorModeSwitch from "./ColorModeSwitch";

export function SiteHeader({ site, menus, origin, preview, colorMode, staticPreview = false }: {
  site: Settings; menus: Menu[]; origin: string; preview?: string; colorMode: ColorMode; staticPreview?: boolean;
}) {
  return <header className="site-header">
    <Link href={siteHref("/", preview)} className="brand">
      {site.logoId ? <img src={`/media/${site.logoId}`} alt="" width="32" height="32" /> : <BookOpen size={25} />}
      <span className="brand-copy"><strong>{site.title}</strong>{site.subtitle && <small>{site.subtitle}</small>}</span>
    </Link>
    <div className="site-header-tools">
      <SiteNavigation items={menus} preview={preview} origin={origin} />
      <ColorModeSwitch initialMode={colorMode} readOnly={staticPreview} />
    </div>
  </header>;
}

export function SiteFooter({ site, friendLinks = [] }: { site: Settings; friendLinks?: Menu[] }) {
  return <footer className="site-footer">
    {friendLinks.length > 0 && <nav className="friend-links" aria-label="友情链接">
      <strong>友情链接</strong>
      <ul>{friendLinks.map(link => <li key={link.id}>
        <a href={link.url} target={link.openInNewTab ? "_blank" : undefined} rel={link.openInNewTab ? "noopener noreferrer" : undefined}>
          {link.label}{link.openInNewTab && <ArrowUpRight size={13} aria-label="新窗口打开" />}
        </a>
      </li>)}</ul>
    </nav>}
    <div><BookOpen size={20} /><strong>{site.title}</strong></div>
    <p>{site.description}</p>
    <span><span className="site-footer-text">{site.footerText.trim() || defaultCopyright()}</span>
      <a href="/rss.xml">RSS 订阅</a><a href="/admin">内容管理 <ArrowUpRight size={13} /></a>
    </span>
  </footer>;
}
