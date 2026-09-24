"use client";
import { useState } from "react";
import { api } from "@/lib/client";
import type { Content, Taxonomy } from "@/lib/types";
import type { components } from "@/lib/api.generated";
import EditorDialog from "./EditorDialog";
import { Notice, LoadState, useLoad } from "./shared";

type Result = Required<components["schemas"]["AiWritingResult"]>;
const actions = { write: "按主题写文章", summary: "生成摘要", title: "优化标题", tags: "推荐标签", translate: "翻译正文", polish: "润色正文" };
type Action = keyof typeof actions;

export default function AiWritingDialog({ doc, terms, apply, close }: {
  doc: Content; terms: Taxonomy[]; apply: (patch: Partial<Content>) => void; close: () => void;
}) {
  const status = useLoad<Required<components["schemas"]["AiStatus"]>>("admin/ai/status");
  const [action, setAction] = useState<Action>(doc.title ? "summary" : "write");
  const [instructions, setInstructions] = useState(""), [language, setLanguage] = useState("英文");
  const [result, setResult] = useState<Result>();
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  function reset() { setResult(undefined); setError(""); }
  async function generate(event: React.FormEvent) {
    event.preventDefault(); if (busy || !status.data?.ready) return;
    setBusy(true); reset();
    try {
      setResult(await api<Result>("admin/ai/generate", "POST", {
        action, title: doc.title, html: doc.html, instructions, targetLanguage: language,
      }));
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  function accept() {
    if (!result || busy) return;
    apply(action === "title" ? { title: result.text } : action === "summary" ? { summary: result.text } :
      action === "tags" ? { tagIds: [...new Set([...doc.tagIds, ...result.tagIds.filter(id => terms.some(t => t.kind === "tag" && t.id === id))])] } :
      { html: result.html, ...(action === "write" && !doc.title.trim() ? { title: instructions.trim().split("\n")[0].slice(0, 200) } : {}) });
    close();
  }
  const noTags = action === "tags" && !terms.some(t => t.kind === "tag");
  return <EditorDialog title="AI 写作助手" close={close}>
    <Notice error={status.error || error} />
    <LoadState loading={status.loading} error={status.error} retry={status.reload} />
    {!status.loading && status.data && !status.data.ready && <p role="status">AI 写作尚未就绪，请管理员在“系统管理 → AI 写作设置”中配置并启用服务。</p>}
    <form onSubmit={generate}>
      <fieldset className="form-fields" disabled={busy || !status.data?.ready}>
        <label>写作操作<select aria-label="写作操作" value={action} onChange={e => { setAction(e.target.value as Action); reset(); }}>
          {Object.entries(actions).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select></label>
        {action === "translate" && <label>目标语言<input required maxLength={80} value={language} onChange={e => { setLanguage(e.target.value); reset(); }} /></label>}
        <label>{action === "write" ? "写作主题与要求" : "补充要求（可选）"}<textarea rows={3} required={action === "write"} maxLength={4000}
          value={instructions} placeholder={action === "write" ? "例如：介绍网站备份的操作步骤，面向新手，约 800 字。" : "例如：保持原意，语言简洁，保留技术术语。"}
          onChange={e => { setInstructions(e.target.value); reset(); }} /></label>
        {action === "tags" && <p>从现有标签中推荐，应用时保留已选标签。{noTags && "请先在“分类与标签”中添加标签。"}</p>}
        <small>点击生成会将当前标题、正文及要求发送给配置的 AI 服务商。生成结果需要核实，关闭窗口会放弃未应用结果。</small>
        <button type="submit" disabled={noTags || busy}>{busy ? "正在生成…" : "生成预览"}</button>
      </fieldset>
    </form>
    {busy && <p role="status">模型正在生成，请稍候…</p>}
    {result && <section className="panel" aria-label="AI 生成结果">
      <h3>生成结果 · 尚未应用</h3>
      {result.html ? <iframe title="AI 正文预览" sandbox="" referrerPolicy="no-referrer" style={{ width: "100%", height: 300, border: "1px solid var(--border)" }}
        srcDoc={`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><style>body{font:16px/1.7 system-ui;padding:12px;overflow-wrap:anywhere}pre{white-space:pre-wrap}img,iframe,video,audio{display:none}</style></head><body>${result.html}</body></html>`} /> : <p style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{result.text}</p>}
      <p>{result.html ? "应用将替换当前正文；预览只展示文字排版，隐藏媒体。" : action === "tags" ? "应用会添加推荐标签。" : `应用将替换当前${action === "title" ? "标题" : "摘要"}。`}{action === "write" && !doc.title.trim() && "未填写标题时，将用主题首行作为标题。"}应用后按现有流程保存草稿，不会自动发布。</p>
      <div className="row-actions"><button type="button" disabled={busy} onClick={accept}>应用到{action === "title" ? "标题" : action === "summary" ? "摘要" : action === "tags" ? "标签" : "正文"}</button>
        <button type="button" className="secondary" onClick={close}>放弃结果</button></div>
    </section>}
  </EditorDialog>;
}
