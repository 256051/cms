"use client";
import { useId, useState } from "react";
import { FileText, Film, Music } from "lucide-react";
import type { Asset, Page } from "@/lib/types";
import { useLoad, LoadState, Notice, Pager } from "./shared";
import EditorDialog from "./EditorDialog";

export type InsertKind = "image" | "gallery" | "video" | "audio" | "file";
export default function EditorAssetPicker({
  kind,
  insert,
  upload,
  value = "",
  confirmLabel = "插入所选",
}: {
  kind: InsertKind;
  insert: (assets: Asset[]) => void;
  upload?: () => void;
  value?: string;
  confirmLabel?: string;
}) {
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Asset[]>([]);
  const [search, setSearch] = useState("");
  const [fileType, setFileType] = useState("");
  const [group, setGroup] = useState("");
  const groups = useLoad<string[]>("admin/assets/groups");
  const [preview, setPreview] = useState<Asset>();
  const [previewError, setPreviewError] = useState(false);
  const inputName = useId();
  const type = kind === "gallery" ? "image" : kind === "file" ? fileType : kind;
  const { data, loading, error, reload } = useLoad<Page<Asset>>(
    `admin/assets?page=${page}&q=${encodeURIComponent(search)}&type=${type}&group=${encodeURIComponent(group)}`,
  );
  const assets = data?.items || [];
  const chosen = selected.length
    ? selected
    : assets.filter((a) => a.id === value);
  function select(asset: Asset, checked = true) {
    setSelected(
      kind === "gallery"
        ? checked
          ? [...selected.filter((a) => a.id !== asset.id), asset].slice(0, 30)
          : selected.filter((a) => a.id !== asset.id)
        : [asset],
    );
  }
  return (
    <>
      <div className="editor-picker-top">
        <label>
          搜索附件库
          <input
            type="search"
            value={search}
            maxLength={200}
            placeholder="输入文件名搜索全部附件"
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") e.preventDefault();
            }}
          />
        </label>
        {upload && (
          <button type="button" className="secondary" onClick={upload}>
            上传并插入
          </button>
        )}
      </div>
      <label>附件分组<select value={group} onChange={e => { setGroup(e.target.value); setPage(1); }}><option value="">全部分组</option>{groups.data?.map(name => <option key={name}>{name}</option>)}</select></label>
      {kind === "file" && (
        <label>
          文件类型
          <select
            aria-label="文件类型"
            value={fileType}
            onChange={(e) => {
              setFileType(e.target.value);
              setPage(1);
            }}
          >
            <option value="">全部类型</option>
            <option value="image">图片</option>
            <option value="video">视频</option>
            <option value="audio">音频</option>
            <option value="application">PDF 文档</option>
          </select>
        </label>
      )}
      <p className="muted">
        {kind === "gallery"
          ? "按勾选顺序插入图片集，最多 30 张；可跨页选择。"
          : "先预览附件，选中后确认使用。"}{" "}
        新附件保存并发布后才对访客可见。
      </p>
      <Notice error={error} />
      <LoadState loading={loading} error={error} retry={reload} />
      {!loading && !error && (
        <div className="editor-asset-grid">
          {assets.map((a) => (
            <article className="editor-asset-card" key={a.id}>
              <label className="editor-asset-option">
                <input
                  type={kind === "gallery" ? "checkbox" : "radio"}
                  name={inputName}
                  aria-label={a.name}
                  checked={chosen.some((s) => s.id === a.id)}
                  disabled={
                    kind === "gallery" &&
                    chosen.length >= 30 &&
                    !chosen.some((s) => s.id === a.id)
                  }
                  onChange={(e) => select(a, e.target.checked)}
                />
                {a.contentType.startsWith("image/") ? (
                  <img src={a.url} alt="" loading="lazy" />
                ) : a.contentType.startsWith("video/") ? (
                  <Film aria-hidden="true" />
                ) : a.contentType.startsWith("audio/") ? (
                  <Music aria-hidden="true" />
                ) : (
                  <FileText aria-hidden="true" />
                )}
                <span title={a.name}>{a.name}</span>
                <small>{(a.size / 1024).toFixed(1)} KB</small>
              </label>
              <button
                type="button"
                className="secondary"
                aria-label={`预览 ${a.name}`}
                onClick={() => {
                  setPreview(a);
                  setPreviewError(false);
                }}
              >
                预览
              </button>
            </article>
          ))}
        </div>
      )}
      {!loading && !error && !assets.length && (
        <p className="empty-state">
          {search
            ? "没有找到匹配的附件，请调整关键词。"
            : "没有可选附件，请先上传。"}
        </p>
      )}
      {data && <Pager data={data} setPage={setPage} />}
      <div className="editor-dialog-actions">
        <button
          type="button"
          disabled={!chosen.length}
          onClick={() => insert(chosen)}
        >
          {confirmLabel}
          {chosen.length ? `（${chosen.length}）` : ""}
        </button>
      </div>
      {preview && (
        <EditorDialog
          title={`预览 ${preview.name}`}
          close={() => setPreview(undefined)}
        >
          <div className="asset-detail-preview">
            {preview.contentType.startsWith("image/") ? (
              <img
                src={preview.url}
                alt={preview.name}
                onError={() => setPreviewError(true)}
              />
            ) : preview.contentType.startsWith("video/") ? (
              <video
                src={preview.url}
                controls
                preload="metadata"
                onError={() => setPreviewError(true)}
              />
            ) : preview.contentType.startsWith("audio/") ? (
              <audio
                src={preview.url}
                controls
                preload="metadata"
                onError={() => setPreviewError(true)}
              />
            ) : (
              <p>此文件可下载后查看。</p>
            )}
          </div>
          {previewError && (
            <p role="alert">暂时无法预览此附件，请尝试打开原文件。</p>
          )}
          <p className="muted">
            {preview.name} · {(preview.size / 1024).toFixed(1)} KB
          </p>
          <a href={preview.url} target="_blank" rel="noopener noreferrer">
            打开原文件
            {preview.contentType === "application/pdf" ? " / 下载 PDF" : ""}
          </a>
          <div className="editor-dialog-actions">
            <button
              type="button"
              className="secondary"
              onClick={() => setPreview(undefined)}
            >
              返回附件列表
            </button>
            <button
              type="button"
              disabled={
                kind === "gallery" &&
                chosen.length >= 30 &&
                !chosen.some((a) => a.id === preview.id)
              }
              onClick={() => {
                if (!chosen.some((a) => a.id === preview.id)) select(preview);
                setPreview(undefined);
              }}
            >
              选择此附件
            </button>
          </div>
        </EditorDialog>
      )}
    </>
  );
}
