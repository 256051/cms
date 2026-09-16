"use client";
import { useState } from "react";
import { Download, Upload } from "lucide-react";
import { api } from "@/lib/client";
import { editorSection, type Content } from "@/lib/types";
import type { components } from "@/lib/api.generated";
import EditorDialog from "./EditorDialog";
import { Notice } from "./shared";
import { useUnsavedChanges } from "./unsaved";

type ImportResult = components["schemas"]["ContentImportResult"];
const limit = 50 * 1024 * 1024;

export default function ContentTransfer({ kind, ids, filters, canExport, disabled, imported, onError }: {
  kind: Content["kind"]; ids: string[];
  filters: { q: string; status: string; categoryId: string; tagId: string };
  canExport: boolean; disabled: boolean; imported: () => Promise<void>; onError: (message: string) => void;
}) {
  const [open, setOpen] = useState(false), [busy, setBusy] = useState(false);
  const [file, setFile] = useState<File | null>(null), [error, setError] = useState("");
  const [result, setResult] = useState<ImportResult | null>(null);
  const pending = useUnsavedChanges("正在导入内容，离开可能无法确认导入结果，确定离开吗？");
  const label = kind === "product" ? "产品" : kind === "case" ? "案例" : "独立页面";
  async function download() {
    setBusy(true); onError("");
    try {
      const blob = await api<Blob>("admin/contents/export", "POST", { kind, ids, ...filters }, false, true);
      const url = URL.createObjectURL(blob), link = document.createElement("a");
      link.href = url; link.download = `cms-${kind}-${new Date().toISOString().slice(0, 10)}.zip`;
      document.body.appendChild(link); link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) { onError((e as Error).message); }
    finally { setBusy(false); }
  }
  async function upload() {
    if (!file || busy) return;
    setBusy(true); setError(""); pending.markChanged();
    try {
      const data = new FormData(); data.set("file", file); data.set("kind", kind);
      setResult(await api<ImportResult>("admin/contents/import", "POST", data));
      await imported();
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); pending.markSaved(); }
  }
  return <>
    <button className="secondary" disabled={disabled || busy} onClick={() => { setOpen(true); setFile(null); setResult(null); setError(""); }}><Upload size={16} />导入</button>
    <button className="secondary" disabled={disabled || busy || !canExport} title="导出最新草稿，包含正文、附件和布局；未勾选时导出全部筛选结果。" onClick={() => void download()}>
      <Download size={16} />{busy && !open ? "正在导出…" : ids.length ? `导出所选（${ids.length}）` : "导出筛选结果"}</button>
    {open && <EditorDialog title={`导入${label}`} close={() => { if (!busy) setOpen(false); }}>
      <div className="content-transfer" aria-busy={busy}>
        <Notice error={error} />
        {result ? <>
          <Notice success={`已导入 ${result.items.length} 条草稿、${result.assets} 个附件。${result.renamed ? `其中 ${result.renamed} 条地址重复，已自动生成新地址。` : ""}`} />
          <p>内容尚未发布，可打开草稿检查正文、图片和布局。</p>
          <ul className="content-transfer-results">{result.items.map(item => <li key={item.id}>
            <a href={`/admin/${editorSection(kind)}/${item.id}`}>{item.title}</a>
            <small>/{item.slug}{item.sourceSlug !== item.slug && `（原地址：/${item.sourceSlug}）`}</small>
          </li>)}</ul>
          <div className="row-actions"><button onClick={() => setOpen(false)}>完成</button></div>
        </> : <form onSubmit={e => { e.preventDefault(); void upload(); }}>
          <p>选择从{label}列表导出的 ZIP 内容包，包含正文、图片、附件和页面布局。</p>
          <p>导入为新草稿，保留已有内容；重复地址自动调整。每次最多 100 条，压缩包不超过 50 MB。</p>
          <p>公共区块导出为独立模块，内容列表在目标站点读取对应分类下的内容。</p>
          <label>ZIP 内容包<input type="file" accept=".zip,application/zip" disabled={busy} required onChange={e => {
            const selected = e.target.files?.[0] ?? null;
            setResult(null); setFile(null); setError("");
            if (selected && (!selected.name.toLowerCase().endsWith(".zip") || !selected.size || selected.size > limit))
              setError("请选择非空的 ZIP 内容包，文件不能超过 50 MB。");
            else setFile(selected);
          }} /></label>
          {file && <p className="content-transfer-file">{file.name} · {(file.size / 1024 / 1024).toFixed(2)} MB</p>}
          <div className="row-actions"><button type="button" className="secondary" disabled={busy} onClick={() => setOpen(false)}>取消</button>
            <button type="submit" disabled={busy || !file}>{busy ? "正在校验并导入…" : "导入为新草稿"}</button></div>
        </form>}
      </div>
    </EditorDialog>}
  </>;
}
