"use client";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { api } from "@/lib/client";
import { themeModeStyle, themeSource, secondBatchThemeIds, parseColorMode } from "@/lib/theme";
import type { Content, Page, PageLayout, ThemeView, Settings, Menu } from "@/lib/types";
import PageLayoutView from "../PageLayoutView";
import BusinessDetails from "../BusinessDetails";
import { SiteHeader, SiteFooter } from "../SiteChrome";
import { Notice, useLoad } from "./shared";

export default function LayoutPreview({ layout, title = "", fields = [] }: { layout: PageLayout; title?: string; fields?: Content["fields"] }) {
  const [width, setWidth] = useState(1100), [hostWidth, setHostWidth] = useState(1100);
  const [target, setTarget] = useState<HTMLElement | null>(null), [posts, setPosts] = useState<Record<string, Content[]>>({});
  const [error, setError] = useState("");
  const [resolved, setResolved] = useState<PageLayout | null>(null), [blockError, setBlockError] = useState("");
  const hasShared = layout.blocks.some(x => x.type === "shared");
  const serialized = hasShared ? JSON.stringify(layout) : "";
  useEffect(() => {
    let cancelled = false;
    setResolved(null); setBlockError("");
    if (!serialized) return;
    const timer = setTimeout(() => {
      api<PageLayout>("admin/layout-preview", "POST", JSON.parse(serialized)).then(value => { if (!cancelled) setResolved(value); })
        .catch(e => { if (!cancelled) setBlockError((e as Error).message); });
    }, 250);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [serialized]);
  const displayed = hasShared ? resolved : layout;
  const host = useRef<HTMLDivElement>(null);
  const { data: theme } = useLoad<ThemeView>("public/theme");
  const site = useLoad<Settings>("public/settings"), menus = useLoad<Menu[]>("public/menu");
  const sources = JSON.stringify((displayed?.blocks || []).filter(x => x.type === "posts" && !x.hidden).map(x => ({ id: x.id, categoryId: x.categoryId, limit: x.limit, contentKind: x.contentKind || "post" })));
  useEffect(() => {
    let cancelled = false;
    const rows = JSON.parse(sources) as { id: string; categoryId: string; limit: number; contentKind: string }[];
    Promise.all(rows.map(async block => [block.id, (await api<Page<Content>>(`public/contents?kind=${block.contentKind}&categoryId=${block.categoryId}&size=${block.limit}`)).items] as const))
      .then(entries => { if (!cancelled) { setPosts(Object.fromEntries(entries)); setError(""); } })
      .catch(e => { if (!cancelled) setError("预览文章加载失败：" + (e as Error).message); });
    return () => { cancelled = true; };
  }, [sources]);
  useEffect(() => {
    const observer = new ResizeObserver(entries => setHostWidth(entries[0].contentRect.width));
    if (host.current) observer.observe(host.current);
    return () => observer.disconnect();
  }, []);
  const scale = Math.min(1, hostWidth / width);
  return <section className="layout-preview" aria-label="页面效果预览"><div className="builder-toolbar"><strong>实时预览</strong>
    <div className="row-actions" role="group" aria-label="预览设备">{[[1100, "桌面"], [768, "平板"], [375, "手机"]].map(([size, label]) => <button type="button" key={size} className="secondary" aria-pressed={width === size} onClick={() => setWidth(Number(size))}>{label}</button>)}</div></div>
    <Notice error={blockError || error || site.error || menus.error} /><div className="preview-frame-host" ref={host} style={{ height: 700 * scale }}>
      <iframe title="页面实时预览" srcDoc={'<!doctype html><html lang="zh-CN"><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="preview-root"></div></body></html>'}
        style={{ width, height: 700, transform: `scale(${scale})`, transformOrigin: "top left" }} onLoad={event => {
          const doc = event.currentTarget.contentDocument;
          if (!doc) return;
          doc.documentElement.dataset.colorMode = document.documentElement.dataset.colorMode || "system";
          document.querySelectorAll('link[rel="stylesheet"], style').forEach(node => doc.head.appendChild(node.cloneNode(true)));
          setTarget(doc.getElementById("preview-root"));
        }} />
    </div>{target && createPortal(<div className={`public-site has-page-layout theme-${theme?.themeId || "classic"}${themeSource(theme?.themeId || "") ? " community-theme" : ""}${secondBatchThemeIds.some(id => id === theme?.themeId) ? " collection-theme" : ""}`} style={theme ? themeModeStyle(theme) : undefined} lang={site.data?.language}
      onClickCapture={event => { if ((event.target as Element).closest("a")) event.preventDefault(); }}>
      {layout.showHeader && site.data && menus.data && <SiteHeader site={site.data} menus={menus.data} origin={window.location.origin} colorMode={parseColorMode(document.documentElement.dataset.colorMode)} staticPreview />}
      <main id="main">
      {layout.showTitle && <h1 className="page-layout-title">{title || "页面标题"}</h1>}
      <BusinessDetails fields={fields} />
      {displayed ? <PageLayoutView layout={displayed} posts={posts} preview /> : <p role="status">{blockError || "正在加载公共区块…"}</p>}
      </main>
      {layout.showFooter && site.data && <SiteFooter site={site.data} />}
    </div>, target)}
    <small className="muted">按设备宽度渲染并缩放显示，可在预览区域内滚动。导航和咨询提交在预览中禁用。</small>
  </section>;
}
