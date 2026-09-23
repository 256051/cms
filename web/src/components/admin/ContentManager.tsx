"use client";
import { useEffect, useState } from "react";
import { api } from "@/lib/client";
import { contentUrl, editorSection, type Content, type Page, type Taxonomy } from "@/lib/types";
import { Heading, Notice, Pager, useLoad, LoadState } from "./shared";
import ContentTransfer from "./ContentTransfer";

export default function ContentManager({ kind }: { kind: Content["kind"] }) {
  const [page, setPage] = useState(1), [q, setQ] = useState(""), [sort, setSort] = useState("recent");
  const [status, setStatus] = useState(""), [category, setCategory] = useState(""), [tag, setTag] = useState("");
  const [selection, setSelection] = useState<Record<string, number>>({}), [batchCategory, setBatchCategory] = useState("");
  const [busy, setBusy] = useState(false), [message, setMessage] = useState("");
  const query = new URLSearchParams({ kind, page: String(page), q, sort, status, categoryId: category, tagId: tag });
  const { data, error, loading, reload } = useLoad<Page<Content>>(`admin/contents?${query}`);
  const terms = useLoad<Taxonomy[]>("admin/taxonomy");
  useEffect(() => { if (new URLSearchParams(window.location.search).get("status") === "trash") setStatus("trash"); }, []);
  const base = editorSection(kind), trash = status === "trash";
  useEffect(() => { setSelection({}); }, [page, q, sort, status, category, tag, kind]);
  async function action(work: () => Promise<unknown>) {
    setBusy(true); setMessage("");
    try { await work(); setSelection({}); await reload(); }
    catch (e) { setMessage((e as Error).message); } finally { setBusy(false); }
  }
  const count = Object.keys(selection).length;
  const batch = (operation: string) => action(() => api("admin/contents/batch", "POST", {
    action: operation, categoryId: batchCategory, items: Object.entries(selection).map(([id, version]) => ({ id, version })),
  }));
  return <><Heading title={kind === "post" ? "文章" : kind === "template" ? "页面模板" : kind === "block" ? "公共区块" : kind === "product" ? "产品" : kind === "case" ? "案例" : "独立页面"} description={kind === "block" ? "维护可同步更新的公共内容；发布后影响引用它的页面，独立副本保留各自内容。" : kind === "template" ? "设计可复用的页面布局。发布后可在页面搭建器中选择，模板修改不会影响已有页面。" : "筛选、批量管理内容，或从回收站恢复误删内容。"}>
    <div className="row-actions content-manager-actions">
      {["post", "product", "case", "page"].includes(kind) && <ContentTransfer key={kind} kind={kind} ids={Object.keys(selection)}
        filters={{ q, status, categoryId: category, tagId: tag }} disabled={busy}
        canExport={!trash && !loading && !error && !!data?.total} onError={setMessage}
        imported={async () => { setSelection({}); setMessage(""); await reload(); }} />}
      <a className="button" href={`/admin/${base}/new`}>新建{kind === "post" ? "文章" : kind === "template" ? "模板" : kind === "block" ? "区块" : kind === "product" ? "产品" : kind === "case" ? "案例" : "页面"}</a>
    </div></Heading>
    <Notice error={message || error || terms.error} /><LoadState loading={loading} error={error} retry={reload} />
    <section className="panel table-panel"><div className="table-toolbar editorial-filters">
      <label>状态<select value={status} onChange={e => { setStatus(e.target.value); setPage(1); }}><option value="">全部内容</option><option value="draft">草稿</option><option value="published">已发布</option><option value="trash">回收站</option></select></label>
      <label>分类<select value={category} onChange={e => { setCategory(e.target.value); setPage(1); }}><option value="">全部分类</option>{terms.data?.filter(t => t.kind === "category").map(t => <option value={t.id} key={t.id}>{t.name}</option>)}</select></label>
      <label>标签<select value={tag} onChange={e => { setTag(e.target.value); setPage(1); }}><option value="">全部标签</option>{terms.data?.filter(t => t.kind === "tag").map(t => <option value={t.id} key={t.id}>{t.name}</option>)}</select></label>
      <label>排序<select value={sort} onChange={e => { setSort(e.target.value); setPage(1); }}><option value="recent">最近创建</option><option value="views">浏览量从高到低</option></select></label>
      <form className="compact-search" onSubmit={e => { e.preventDefault(); setQ(String(new FormData(e.currentTarget).get("q") || "")); setPage(1); }}><input name="q" aria-label="搜索内容" placeholder="搜索标题或摘要" maxLength={200} /><button className="secondary">搜索</button></form>
    </div>
    {!trash && <div className="table-toolbar content-batch"><span>已选 {count} 条</span><label>批量设置分类<select value={batchCategory} onChange={e => setBatchCategory(e.target.value)}><option value="">不分类</option>{terms.data?.filter(t => t.kind === "category").map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</select></label>
      <button className="secondary" disabled={busy || !count || loading} onClick={() => void batch("category")}>修改草稿分类</button>
      <button className="secondary" disabled={busy || !count || loading} onClick={() => { if (confirm(`下架所选 ${count} 条内容并取消发布计划？`)) void batch("unpublish"); }}>批量下架</button></div>}
    <div className="table-scroll"><table className="content-table"><thead><tr><th>{!trash && <input type="checkbox" aria-label="选择本页全部内容" checked={!!data?.items.length && data.items.every(c => c.id in selection)} onChange={e => setSelection(e.target.checked ? Object.fromEntries(data!.items.map(c => [c.id, c.version])) : {})} />}</th><th>标题</th><th>状态</th><th>首次发布 / 最近更新</th><th>累计 / 今日浏览</th><th>独立访客</th><th>操作</th></tr></thead>
    <tbody>{data?.items.map(c => <tr key={c.id}><td>{!trash && <input type="checkbox" aria-label={`选择 ${c.title}`} checked={c.id in selection} onChange={e => setSelection(current => { const next = { ...current }; if (e.target.checked) next[c.id] = c.version; else delete next[c.id]; return next; })} />}</td>
      <td>{trash ? <strong>{c.title}</strong> : <a className="content-title" href={`/admin/${base}/${c.id}`}>{c.title}</a>}<small className="traffic-path">/{c.slug}</small></td>
      <td><span className={`badge ${c.published ? "green" : ""}`}>{trash ? "回收站" : c.published ? "已发布" : "草稿"}</span>{c.scheduledPublishAt && <small>待定时发布</small>}</td>
      <td>{c.publishedAt ? new Date(c.publishedAt).toLocaleDateString("zh-CN") : "—"}<small className="traffic-path">{c.updatedAt ? new Date(c.updatedAt).toLocaleString("zh-CN") : "—"}</small></td>
      <td>{c.views} / {c.todayViews}</td><td>{c.visitors}</td><td><div className="row-actions">
      {trash ? <><button className="secondary" disabled={busy} onClick={() => void action(() => api(`admin/contents/${c.id}/restore`, "POST", { version: c.version }))}>恢复为草稿</button><button className="danger secondary" disabled={busy} onClick={() => { if (confirm("永久删除此内容、评论和所有历史版本？此操作无法撤销。")) void action(() => api(`admin/contents/${c.id}/purge`, "DELETE", { version: c.version })); }}>永久删除</button></> : <>
        <a href={`/admin/${base}/${c.id}`}>编辑</a><button className="secondary" disabled={busy} onClick={() => void action(async () => { const copy = await api<Content>(`admin/contents/${c.id}/duplicate`, "POST"); window.location.assign(`/admin/${base}/${copy.id}`); })}>复制</button>{c.published && kind !== "template" && kind !== "block" && <a href={contentUrl({ ...c, slug: c.publicSlug || c.slug })} target="_blank">查看</a>}</>}
      </div></td></tr>)}</tbody></table></div>{!loading && data?.total === 0 && <p className="empty-state">没有符合条件的内容。</p>}<Pager data={data} setPage={setPage} /></section></>;
}
