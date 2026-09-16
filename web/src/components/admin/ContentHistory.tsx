"use client";
import { useState } from "react";
import { api } from "@/lib/client";
import type { Content, Page } from "@/lib/types";
import type { components } from "@/lib/api.generated";
import { Notice, Pager, useLoad, LoadState } from "./shared";
import LayoutPreview from "./LayoutPreview";

const actions: Record<string, string> = { save: "保存草稿", publish: "发布", unpublish: "下架", original: "原草稿",
  "published-original": "原发布快照", restore: "回收站恢复", "batch-category": "批量改分类", "batch-unpublish": "批量下架", scheduled: "执行发布计划" };

export function localDateTime(value?: string | null) {
  if (!value) return "";
  const date = new Date(value);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

export default function ContentHistory({ doc, disabled, onChange, onError, onBusyChange }: {
  doc: Content; disabled: boolean; onChange: (value: Content) => void; onError: (value: string) => void; onBusyChange: (busy: boolean) => void;
}) {
  const [page, setPage] = useState(1), [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<Content>();
  function lock(value: boolean) { setBusy(value); onBusyChange(value); }
  const { data, error, loading, reload } = useLoad<Page<Required<components["schemas"]["RevisionView"]>>>(`admin/contents/${doc.id}/revisions?page=${page}&v=${doc.version}`);
  async function restore(revision: string) {
    if (!confirm("将此历史版本恢复到当前草稿？网站当前展示内容保持原样，重新发布后才会更新。")) return;
    lock(true);
    try { onChange(await api<Content>(`admin/contents/${doc.id}/revisions/${revision}/restore`, "POST", { version: doc.version })); setPreview(undefined); }
    catch (e) { onError((e as Error).message); } finally { lock(false); }
  }
  return <div className="editor-extras"><section className="panel"><h2>定时发布与下架</h2>
    <p className="muted">使用浏览器本地时间。设置发布时会固定当前已保存草稿；后续修改草稿需要重新设置发布计划。服务运行时每 30 秒检查一次。</p>
    <form key={`${doc.id}:${doc.version}`} onSubmit={async event => {
      event.preventDefault(); const fields = new FormData(event.currentTarget); lock(true);
      const utc = (name: string) => fields.get(name) ? new Date(String(fields.get(name))).toISOString() : null;
      try { onChange(await api<Content>(`admin/contents/${doc.id}/schedule`, "PUT", { version: doc.version, publishAt: utc("publish"), unpublishAt: utc("unpublish") })); }
      catch (e) { onError((e as Error).message); } finally { lock(false); }
    }}><fieldset disabled={disabled || busy} className="form-fields">
      <label>发布时间<input name="publish" type="datetime-local" defaultValue={localDateTime(doc.scheduledPublishAt)} /></label>
      <label>下架时间<input name="unpublish" type="datetime-local" defaultValue={localDateTime(doc.scheduledUnpublishAt)} /></label>
      <p>清空对应时间并保存即可取消。{disabled && "请先保存当前修改。"}</p><button>保存发布计划</button>
    </fieldset></form></section>
    <section className="panel"><h2>历史版本</h2><Notice error={error} /><LoadState loading={loading} error={error} retry={reload} />
      {preview && <div className="revision-preview"><h3>{preview.title}</h3><p>{preview.summary}</p>{preview.layout ? <LayoutPreview layout={preview.layout} title={preview.title} /> : <div className="prose" aria-label="历史正文（只读）" dangerouslySetInnerHTML={{ __html: preview.html }} />}<button className="secondary" onClick={() => setPreview(undefined)}>关闭预览</button></div>}
      <ul className="history-list">{data?.items.map(row => <li key={row.id}><div><strong>版本 {row.version} · {row.title}</strong>
        <small>{new Date(row.createdAt).toLocaleString("zh-CN")} · {row.actor} · {actions[row.action] || "内容更新"}</small></div><div className="row-actions">
        <button className="secondary" disabled={busy} onClick={async () => { try { setPreview(await api<Content>(`admin/contents/${doc.id}/revisions/${row.id}`)); } catch (e) { onError((e as Error).message); } }}>查看</button>
        <button className="secondary" disabled={disabled || busy} onClick={() => void restore(row.id)}>恢复为草稿</button></div></li>)}</ul>
      {data?.total === 0 && <p>保存或发布后会记录历史版本。</p>}<Pager data={data} setPage={setPage} />
    </section></div>;
}
