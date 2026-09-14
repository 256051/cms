"use client";
import { useState } from "react";
import { FileText, Film, Music } from "lucide-react";
import type { Asset, Page } from "@/lib/types";
import { useLoad, LoadState, Notice, Pager } from "./shared";

export type InsertKind = "image" | "gallery" | "video" | "audio" | "file";
export default function EditorAssetPicker({
  kind,
  insert,
  upload,
}: {
  kind: InsertKind;
  insert: (assets: Asset[]) => void;
  upload: () => void;
}) {
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Asset[]>([]);
  const [search, setSearch] = useState("");
  const { data, loading, error, reload } = useLoad<Page<Asset>>(
    `admin/assets?page=${page}`,
  );
  const prefix = kind === "gallery" ? "image" : kind;
  const assets =
    data?.items.filter(
      (a) =>
        (kind === "file" || a.contentType.startsWith(prefix + "/")) &&
        a.name.toLowerCase().includes(search.toLowerCase()),
    ) || [];
  return (
    <>
      <div className="editor-picker-top">
        <label>
          筛选本页附件
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
        <button type="button" className="secondary" onClick={upload}>
          上传并插入
        </button>
      </div>
      <p className="muted">
        {kind === "gallery"
          ? "按勾选顺序插入图片集，最多 30 张；可跨页选择。"
          : "选择一个附件插入正文。"}{" "}
        新附件保存并发布后才对访客可见。
      </p>
      <Notice error={error} />
      <LoadState loading={loading} error={error} retry={reload} />
      {!loading && !error && (
        <div className="editor-asset-grid">
          {assets.map((a) => (
            <label className="editor-asset-option" key={a.id}>
              <input
                type={kind === "gallery" ? "checkbox" : "radio"}
                name="editor-asset"
                checked={selected.some((s) => s.id === a.id)}
                onChange={(e) =>
                  setSelected(
                    kind === "gallery"
                      ? e.target.checked
                        ? [...selected, a].slice(0, 30)
                        : selected.filter((s) => s.id !== a.id)
                      : [a],
                  )
                }
              />
              {a.contentType.startsWith("image/") ? (
                <img src={a.url} alt="" />
              ) : a.contentType.startsWith("video/") ? (
                <Film />
              ) : a.contentType.startsWith("audio/") ? (
                <Music />
              ) : (
                <FileText />
              )}
              <span>{a.name}</span>
              <small>{(a.size / 1024).toFixed(1)} KB</small>
            </label>
          ))}
        </div>
      )}
      {!loading && !error && !assets.length && (
        <p className="empty-state">本页没有匹配的附件，可上传或查看下一页。</p>
      )}
      {data && <Pager data={data} setPage={setPage} />}
      <div className="editor-dialog-actions">
        <button
          type="button"
          disabled={!selected.length}
          onClick={() => insert(selected)}
        >
          插入所选{selected.length ? `（${selected.length}）` : ""}
        </button>
      </div>
    </>
  );
}
