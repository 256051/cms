"use client";
import { useEffect, useRef, useState } from "react";
import { Check, Eye, RotateCcw, Save, Search } from "lucide-react";
import { api } from "@/lib/client";
import type { ThemeDefinition, ThemeOptions, ThemesView } from "@/lib/types";
import { Heading, Notice, LoadState, useLoad } from "./shared";
import { useUnsavedChanges } from "./unsaved";

export default function ThemeManager() {
  const { data, setData, error, setError, loading } = useLoad<ThemesView>("admin/themes");
  const [selected, setSelected] = useState<ThemeDefinition>();
  const [options, setOptions] = useState<ThemeOptions>();
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false), [success, setSuccess] = useState("");
  const changes = useUnsavedChanges();
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (!data || selected) return;
    const active = data.themes.find(theme => theme.id === data.activeThemeId) ?? data.themes[0];
    if (active) { setSelected(active); setOptions({ ...active.options }); }
  }, [data, selected]);
  function choose(theme: ThemeDefinition) {
    if (selected?.id === theme.id) { heading.current?.focus(); return; }
    if (!changes.confirmDiscard()) return;
    changes.markSaved(); setSelected(theme); setOptions({ ...theme.options }); setSuccess("");
    requestAnimationFrame(() => heading.current?.focus());
  }
  function change(patch: Partial<ThemeOptions>) {
    setOptions(o => o ? { ...o, ...patch } : o); changes.markChanged(); setSuccess("");
  }
  const preview = selected && options ? "/admin/themes/preview?" + new URLSearchParams({ themeId: selected.id, ...options }) : "";
  const themes = data?.themes.filter(theme => `${theme.id} ${theme.name} ${theme.description}`.toLowerCase().includes(query.trim().toLowerCase())) ?? [];
  return <>
    <Heading title="主题外观" description="选择网站的样子。每套主题独立保存设置，预览满意后再应用。" />
    <Notice error={error} success={success} />
    <LoadState loading={loading} error={error} retry={() => { if (changes.confirmDiscard()) { changes.markSaved(); window.location.reload(); } }} />
    {data && <div className="theme-workbench">
      <section className="panel theme-library" aria-label="主题列表">
        <div className="theme-library-heading"><h2>全部主题</h2><span className="muted" aria-live="polite">{query.trim() ? `${themes.length} / ` : ""}{data.themes.length} 套</span></div>
        <label className="theme-search"><span className="sr-only">搜索主题</span><Search size={17} aria-hidden="true" /><input type="search" placeholder="搜索名称或风格" value={query} onChange={e => setQuery(e.target.value)} /></label>
        <ul className="theme-list">
          {themes.map(theme => <li key={theme.id}>
            <button type="button" className="theme-list-item" aria-label={`配置 ${theme.name}`} aria-pressed={selected?.id === theme.id} aria-controls="theme-detail" disabled={busy} onClick={() => choose(theme)}>
              <img src={theme.thumbnail} alt="" width={72} height={48} />
              <span className="theme-list-copy"><span className="theme-list-name">{theme.name}</span><span className="theme-list-description">{theme.description}</span>{data.activeThemeId === theme.id && <span className="theme-active"><Check size={12} aria-hidden="true" />当前主题</span>}</span>
            </button>
          </li>)}
        </ul>
        {themes.length === 0 && <p className="theme-list-empty" role="status">没有匹配的主题，试试其他关键词。</p>}
      </section>
    {selected && options && <section id="theme-detail" className="panel theme-detail" aria-label="主题配置">
      <div className="theme-detail-heading"><h2 ref={heading} tabIndex={-1}>{selected.name} · 外观设置</h2>{data.activeThemeId === selected.id && <span className="badge green"><Check size={14} aria-hidden="true" />当前主题</span>}</div>
      <p className="theme-detail-description">{selected.description}</p>
      <figure className="theme-large-preview">
        <a href={selected.thumbnail} target="_blank" rel="noopener" aria-label={`查看 ${selected.name} 大图（新标签页）`}><img key={selected.id} src={selected.thumbnail} alt={`${selected.name}首页效果`} width={1440} height={960} /></a>
        <figcaption>首页布局示例 · 点击图片查看大图。自定义效果请使用下方“预览主题”。</figcaption>
      </figure>
      <div className="theme-options">
      <div className="theme-settings-heading"><h3 tabIndex={-1}>基础设置</h3><span className="muted" role="status">{changes.dirty ? "有尚未保存的修改" : "保存后对访客生效"}</span></div>
      <form onSubmit={async e => {
        e.preventDefault(); setBusy(true); setError(""); setSuccess("");
        try {
          const updated = await api<ThemesView>("admin/themes/active", "PUT", { themeId: selected.id, options, version: data.version });
          setData(updated); const saved = updated.themes.find(x => x.id === selected.id)!;
          setSelected(saved); setOptions({ ...saved.options }); changes.markSaved(); setSuccess(`已应用“${saved.name}”，网站外观已更新。`);
        } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
      }}>
        <fieldset className="form-fields" disabled={busy}>
          <div className="theme-color-fields"><label>主色色值<input value={options.accentColor} onChange={e => change({ accentColor: e.target.value })} required pattern="#[0-9a-fA-F]{6}" maxLength={7} /></label><label>选择主色<input type="color" value={/^#[0-9a-fA-F]{6}$/.test(options.accentColor) ? options.accentColor : selected.defaults.accentColor} onChange={e => change({ accentColor: e.target.value })} /></label></div>
          <label>首页标题<input value={options.heroTitle} maxLength={100} placeholder={selected.defaultHeroTitle.replaceAll("\n", "")} onChange={e => change({ heroTitle: e.target.value })} /></label>
          <label>首页介绍<textarea value={options.heroDescription} maxLength={500} rows={4} placeholder="留空沿用站点介绍" onChange={e => change({ heroDescription: e.target.value })} /></label>
          <p className="muted">标题和介绍仅支持纯文本。主色会自动搭配清晰可读的文字颜色。</p>
          <div className="row-actions">
            <a className={`button secondary ${busy ? "disabled-link" : ""}`} href={busy ? undefined : preview} target="_blank" rel="noopener" aria-disabled={busy}><Eye size={16} aria-hidden="true" />预览主题</a>
            <button type="button" className="secondary" onClick={() => { setOptions({ ...selected.defaults }); changes.markChanged(); setSuccess(""); }}><RotateCcw size={16} aria-hidden="true" />恢复默认</button>
            <button disabled={busy}><Save size={16} aria-hidden="true" />{busy ? "应用中…" : data.activeThemeId === selected.id ? "保存并应用" : "保存并启用"}</button>
          </div>
        </fieldset>
      </form>
      </div>
    </section>}
    </div>}
  </>;
}
