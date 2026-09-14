"use client";
import { useEffect, useRef, useState } from "react";
import { Check, Eye, RotateCcw, Save } from "lucide-react";
import { api } from "@/lib/client";
import type { ThemeDefinition, ThemeOptions, ThemesView } from "@/lib/types";
import { Heading, Notice, LoadState, useLoad } from "./shared";
import { useUnsavedChanges } from "./unsaved";

export default function ThemeManager() {
  const { data, setData, error, setError, loading } = useLoad<ThemesView>("admin/themes");
  const [selected, setSelected] = useState<ThemeDefinition>();
  const [options, setOptions] = useState<ThemeOptions>();
  const [busy, setBusy] = useState(false), [success, setSuccess] = useState("");
  const changes = useUnsavedChanges();
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { heading.current?.focus(); }, [selected?.id]);
  function choose(theme: ThemeDefinition) {
    if (!changes.confirmDiscard()) return;
    changes.markSaved(); setSelected(theme); setOptions({ ...theme.options }); setSuccess("");
  }
  function change(patch: Partial<ThemeOptions>) {
    setOptions(o => o ? { ...o, ...patch } : o); changes.markChanged(); setSuccess("");
  }
  const preview = selected && options ? "/admin/themes/preview?" + new URLSearchParams({ themeId: selected.id, ...options }) : "";
  return <>
    <Heading title="主题外观" description="选择网站的样子。每套主题独立保存设置，预览满意后再应用。" />
    <Notice error={error} success={success} />
    <LoadState loading={loading} error={error} retry={() => { if (changes.confirmDiscard()) { changes.markSaved(); window.location.reload(); } }} />
    <div className="theme-gallery">
      {data?.themes.map(theme => <article key={theme.id} className={`panel theme-card ${selected?.id === theme.id ? "chosen" : ""}`}>
        <img src={theme.thumbnail} alt={`${theme.name}首页效果`} width={960} height={640} />
        <div className="theme-card-body">
          <div className="theme-card-title"><h2>{theme.name}</h2>{data.activeThemeId === theme.id && <span className="badge green"><Check size={14} />当前主题</span>}</div>
          <p>{theme.description}</p>
          <button className="secondary" disabled={busy || selected?.id === theme.id} onClick={() => choose(theme)}>{selected?.id === theme.id ? "正在编辑" : `配置 ${theme.name}`}</button>
        </div>
      </article>)}
    </div>
    {selected && options && data && <section className="panel theme-options" aria-label="主题配置">
      <h2 ref={heading} tabIndex={-1}>{selected.name} · 外观设置</h2>
      <p className="muted">{changes.dirty ? "有尚未保存的修改" : "修改仅在保存并应用后对访客生效。"}</p>
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
            <a className={`button secondary ${busy ? "disabled-link" : ""}`} href={busy ? undefined : preview} target="_blank" rel="noopener" aria-disabled={busy}><Eye size={16} />预览主题</a>
            <button type="button" className="secondary" onClick={() => { setOptions({ ...selected.defaults }); changes.markChanged(); setSuccess(""); }}><RotateCcw size={16} />恢复默认</button>
            <button disabled={busy}><Save size={16} />{busy ? "应用中…" : data.activeThemeId === selected.id ? "保存并应用" : "保存并启用"}</button>
          </div>
        </fieldset>
      </form>
    </section>}
  </>;
}
