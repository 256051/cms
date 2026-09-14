"use client";
import Link from "next/link";
import { useEffect, useRef } from "react";
import { ArrowUpRight, ChevronDown } from "lucide-react";
import type { Menu } from "@/lib/types";
import { menuChildren } from "@/lib/menu";
import { siteHref } from "@/lib/theme";

/** Native disclosure controls keep the full navigation in server-rendered HTML. */
export default function SiteNavigation({ items, preview, origin }: { items: Menu[]; preview?: string; origin: string }) {
  const nav = useRef<HTMLElement>(null);
  function closeAll() { nav.current?.querySelectorAll<HTMLDetailsElement>("details[open]").forEach(x => { x.open = false; }); }
  useEffect(() => {
    const outside = (e: PointerEvent) => { if (!nav.current?.contains(e.target as Node)) closeAll(); };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, []);
  function render(parent = "", depth = 0): React.ReactNode {
    if (depth >= 5) return null;
    return menuChildren(items, parent).map(item => {
      const url = new URL(item.url, origin);
      const internal = url.origin === new URL(origin).origin;
      const href = item.url.startsWith("#") ? item.url : internal ? siteHref(url.pathname + url.search + url.hash, preview) : item.url;
      const newTab = item.openInNewTab || (!!preview && !internal);
      return <li key={item.id}><div className="site-nav-item">
        <a href={href} target={newTab ? "_blank" : undefined} rel={newTab ? "noopener noreferrer" : undefined}>{item.label}{newTab && <ArrowUpRight size={13} aria-label="新窗口" />}</a>
        {items.some(x => x.parentId === item.id) && <details name={"menu-" + (parent || "root")}>
          <summary aria-label={`${item.label}的子菜单`}><ChevronDown size={16} /></summary>
          <ul className="site-submenu">{render(item.id, depth + 1)}</ul>
        </details>}
      </div></li>;
    });
  }
  return <nav ref={nav} className="site-nav" aria-label="网站导航" onBlur={e => { if (!e.currentTarget.contains(e.relatedTarget as Node)) closeAll(); }} onKeyDown={e => {
    if (e.key !== "Escape") return;
    const details = (e.target as Element).closest<HTMLDetailsElement>("details[open]");
    if (details) { details.open = false; details.querySelector("summary")?.focus(); }
    else closeAll();
    e.stopPropagation();
  }}>
    <ul><li><Link href={siteHref("/", preview)}>首页</Link></li>{render()}<li><Link href={siteHref("/search", preview)}>搜索</Link></li></ul>
  </nav>;
}
