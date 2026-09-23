"use client";
import { useRef, useState } from "react";
import { ArrowUpRight, CornerDownRight, Pencil, Plus, Trash2 } from "lucide-react";
import { api } from "@/lib/client";
import type { Menu, MenuTarget, Page } from "@/lib/types";
import { menuRows, menuTypes } from "@/lib/menu";
import { Heading, Notice, Pager, useLoad, LoadState } from "./shared";
import { useUnsavedChanges } from "./unsaved";

const empty = { label: "", url: "", sort: 0, parentId: "", type: "custom", targetId: "", openInNewTab: false, version: 0 };

export default function MenuManager({ friendLinks = false }: { friendLinks?: boolean }) {
  const endpoint = friendLinks ? "admin/friend-links" : "admin/menu";
  const noun = friendLinks ? "友情链接" : "菜单项";
  const blank = { ...empty, openInNewTab: friendLinks };
  const changes = useUnsavedChanges();
  const { data, error, setError, reload, loading } = useLoad<Menu[]>(endpoint);
  const [editing, setEditing] = useState<Menu>();
  const [draft, setDraft] = useState(blank);
  const [busy, setBusy] = useState(false), [success, setSuccess] = useState("");
  const heading = useRef<HTMLHeadingElement>(null);
  const rows = menuRows(data || []);
  const excluded = new Set(editing ? [editing.id, ...menuRows(data || [], editing.id).map(x => x.item.id)] : []);
  function change(patch: Partial<typeof empty>) { setDraft(x => ({ ...x, ...patch })); changes.markChanged(); setSuccess(""); }
  function edit(item?: Menu, parentId = "") {
    if (!changes.confirmDiscard()) return;
    changes.markSaved(); setEditing(item); setDraft(item ? { ...item, type: friendLinks ? "custom" : item.type } : { ...blank, parentId }); setError(""); setSuccess("");
    requestAnimationFrame(() => heading.current?.focus());
  }
  return <>
    <Heading title={friendLinks ? "友情链接" : "导航菜单"} description={friendLinks ? "管理网站底部的友情链接，序号越小越靠前，保存后立即生效。" : "按层级组织主导航。选择站内内容可自动生成名称和链接，序号越小越靠前。"}>
      <button disabled={busy} onClick={() => edit()}><Plus size={16} />新增{noun}</button>
    </Heading>
    <Notice error={error} success={success} />
    <LoadState loading={loading} error={error} retry={() => { if (changes.confirmDiscard()) { changes.markSaved(); window.location.reload(); } }} />
    <div className="management-grid menu-management">
      <section className="panel menu-editor">
        <h2 ref={heading} tabIndex={-1}>{editing ? "编辑" : "添加"}{noun}</h2>
        <form onSubmit={async e => {
          e.preventDefault(); setBusy(true); setError(""); setSuccess("");
          try {
            await api(endpoint + (editing ? "/" + editing.id : ""), editing ? "PUT" : "POST", draft);
            changes.markSaved(); setEditing(undefined); setDraft({ ...blank }); await reload(); setSuccess(friendLinks ? "友情链接已保存，网站底部已更新。" : "菜单项已保存，网站导航已更新。");
          } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
        }}>
          <fieldset className="form-fields" disabled={busy || loading}>
            {!friendLinks && <><label>上级菜单项<select aria-label="上级菜单项" value={draft.parentId} onChange={e => change({ parentId: e.target.value })}>
              <option value="">无（顶级菜单）</option>
              {rows.filter(x => !excluded.has(x.item.id)).map(({ item, depth }) => <option key={item.id} value={item.id}>{"　".repeat(depth)}{depth ? "└ " : ""}{item.label}</option>)}
            </select></label>
            <label>类型<select aria-label="类型" value={draft.type} onChange={e => change({ type: e.target.value, targetId: "", label: "", url: "" })}>
              {Object.entries(menuTypes).map(([value, name]) => <option key={value} value={value}>{name}</option>)}
            </select></label></>}
            {draft.type !== "custom" && <TargetPicker key={draft.type} type={draft.type} selected={{ id: draft.targetId, label: draft.label, url: draft.url }} onChange={x => change({ targetId: x.id, label: x.label, url: x.url })} />}
            {editing && !editing.available && draft.targetId === editing.targetId && <p className="alert">关联内容已下架或不可用，此菜单及其子项暂不对访客显示。请选择其他内容或重新发布。</p>}
            <label>名称<input name="label" required maxLength={draft.type === "custom" ? 60 : 200} readOnly={draft.type !== "custom"} value={draft.label} onChange={e => change({ label: e.target.value })} /></label>
            <label>链接<input name="url" type={friendLinks ? "url" : "text"} required maxLength={500} readOnly={draft.type !== "custom"} value={draft.url} placeholder={friendLinks ? "https://example.com" : "/pages/about、# 或 https://example.com"} onChange={e => change({ url: e.target.value })} /></label>
            <label>打开方式<select aria-label="打开方式" value={draft.openInNewTab ? "new" : "current"} onChange={e => change({ openInNewTab: e.target.value === "new" })}><option value="current">当前窗口</option><option value="new">新窗口</option></select></label>
            <label>排序<input name="sort" aria-label="排序" aria-describedby="menu-sort-help" type="number" required min={-2147483648} max={2147483647} value={draft.sort} onChange={e => change({ sort: Number(e.target.value) })} /><small id="menu-sort-help">{friendLinks ? "序号越小，在网站底部越靠前。" : "仅比较同级菜单。支持最多 5 级菜单。"}</small></label>
            <div className="row-actions"><button disabled={busy || (draft.type !== "custom" && !draft.targetId)}>{busy ? "保存中…" : "保存"}</button>{(editing || changes.dirty || draft.parentId) && <button type="button" className="secondary" onClick={() => edit()}>取消</button>}</div>
          </fieldset>
        </form>
      </section>
      <section className="panel menu-tree-panel" aria-label={friendLinks ? "友情链接列表" : "菜单层级"}>
        <h2>{friendLinks ? "网站底部链接" : "主导航"}</h2><p className="muted">{friendLinks ? "所有链接按以下顺序展示在网站页脚。" : "首页和搜索入口由主题提供，下方为自定义导航。"}</p>
        <ul className="menu-tree">
          {rows.map(({ item, depth }) => <li key={item.id} style={{ marginLeft: depth * 16 }}>
            <div className="menu-tree-row">
              <div className="menu-item-info"><strong>{depth > 0 && <CornerDownRight size={15} />}{item.label}{item.openInNewTab && <ArrowUpRight size={15} aria-label="新窗口" />}</strong><span className="muted">{friendLinks ? `排序 ${item.sort}` : `${menuTypes[item.type]} · 排序 ${item.sort} · 第 ${depth + 1} 级`}</span><span className="menu-item-url">{item.url}</span>{!item.available && <span className="badge">内容不可用，前台隐藏</span>}</div>
              <div className="row-actions">
                <button className="icon-button" disabled={busy || editing?.id === item.id} aria-label={"编辑 " + item.label} onClick={() => edit(item)}><Pencil size={16} /></button>
                {!friendLinks && <button className="icon-button" disabled={busy || depth >= 4} aria-label={"新增子菜单 " + item.label} onClick={() => edit(undefined, item.id)}><Plus size={16} /></button>}
                <button className="icon-button danger-text" disabled={busy} aria-label={"删除 " + item.label} onClick={async () => {
                  if ((data || []).some(x => x.parentId === item.id)) { setError("请先移动或删除子菜单，再删除此菜单项。"); return; }
                  if (editing?.id === item.id && !changes.confirmDiscard()) return;
                  if (!confirm(`删除${noun}“${item.label}”？`)) return;
                  setBusy(true); setError(""); setSuccess("");
                  try { await api(`${endpoint}/${item.id}?version=${item.version}`, "DELETE"); if (editing?.id === item.id) { changes.markSaved(); setEditing(undefined); setDraft({ ...blank }); } await reload(); setSuccess(`${noun}已删除。`); }
                  catch (e) { setError((e as Error).message); } finally { setBusy(false); }
                }}><Trash2 size={16} /></button>
              </div>
            </div>
          </li>)}
        </ul>
        {!loading && !error && rows.length === 0 && <p className="empty-state">{friendLinks ? "还没有友情链接，添加后将在网站底部显示。" : "还没有导航菜单，先添加一个菜单项。"}</p>}
      </section>
    </div>
  </>;
}

function TargetPicker({ type, selected, onChange }: { type: string; selected: MenuTarget; onChange: (item: MenuTarget) => void }) {
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const { data, error, loading, reload } = useLoad<Page<MenuTarget>>(`admin/menu/targets?type=${type}&q=${encodeURIComponent(query)}&page=${page}`);
  return <div className="menu-target-picker">
    <label>搜索{menuTypes[type]}<input type="search" value={query} maxLength={200} placeholder="输入名称搜索" onChange={e => { setQuery(e.target.value); setPage(1); }} /></label>
    <Notice error={error} /><LoadState loading={loading} error={error} retry={reload} />
    <label>选择{menuTypes[type]}<select aria-label={"选择" + menuTypes[type]} value={selected.id} onChange={e => { const target = data?.items.find(x => x.id === e.target.value); if (target) onChange(target); }}>
      <option value="">请选择</option>
      {selected.id && !data?.items.some(x => x.id === selected.id) && <option value={selected.id}>{selected.label}（当前选择）</option>}
      {data?.items.map(x => <option key={x.id} value={x.id}>{x.label}</option>)}
    </select></label>
    <small>文章与页面仅展示已发布内容；名称和地址自动同步。</small>
    {!loading && !error && data?.total === 0 && <p className="muted">没有符合条件的内容。</p>}
    {data && data.total > data.pageSize && <Pager data={data} setPage={setPage} />}
  </div>;
}
