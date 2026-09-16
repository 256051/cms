"use client";
import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/client";
import type { Asset } from "@/lib/types";
import EditorDialog from "./EditorDialog";
import { Notice } from "./shared";

export default function ImageCropDialog({ asset, close, saved }: { asset: Asset; close: () => void; saved: (asset: Asset) => void }) {
  const [source, setSource] = useState<HTMLImageElement>(), [ratio, setRatio] = useState("1");
  const [x, setX] = useState(50), [y, setY] = useState(50), [zoom, setZoom] = useState(1);
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [ready, setReady] = useState(false);
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    let cancelled = false;
    const image = new Image(); image.src = asset.url;
    image.decode().then(() => { if (!cancelled) setSource(image); }).catch(() => { if (!cancelled) setError("图片加载失败，请关闭后重试。"); });
    return () => { cancelled = true; };
  }, [asset.url]);
  useEffect(() => {
    if (!source || !canvas.current) return;
    const aspect = Number(ratio) || source.naturalWidth / source.naturalHeight;
    const width = Math.max(1, Math.floor(Math.min(source.naturalWidth, source.naturalHeight * aspect) / zoom));
    const height = Math.max(1, Math.floor(width / aspect));
    if (width * height > 16_000_000) { setReady(false); setError("当前裁剪区域超过 1600 万像素，请放大裁剪框内的主体，缩小输出区域。"); return; }
    setError("");
    const output = canvas.current; output.width = width; output.height = height;
    output.getContext("2d")!.drawImage(source, (source.naturalWidth - width) * x / 100, (source.naturalHeight - height) * y / 100,
      width, height, 0, 0, width, height);
    setReady(true);
  }, [source, ratio, x, y, zoom]);
  return <EditorDialog title="裁剪图片并另存" close={() => { if (!busy) close(); }}>
    <Notice error={error} />
    <p className="muted">选择比例并调整主体位置，预览即保存结果。原文件及历史引用保留；新图片保存为 PNG，动图会成为静态图片。</p>
    <canvas ref={canvas} aria-label="裁剪结果预览" style={{ display: "block", maxWidth: "100%", maxHeight: "38dvh", margin: "auto", objectFit: "contain" }} />
    <fieldset disabled={busy || !source} className="form-fields"><label>裁剪比例<select value={ratio} onChange={e => setRatio(e.target.value)}>
      <option value="0">原图比例</option><option value="1">1:1 正方形</option><option value={4 / 3}>4:3 横图</option><option value={16 / 9}>16:9 宽屏</option><option value={3 / 4}>3:4 竖图</option>
    </select></label><label>主体左右位置<input type="range" min={0} max={100} value={x} onChange={e => setX(Number(e.target.value))} /></label>
      <label>主体上下位置<input type="range" min={0} max={100} value={y} onChange={e => setY(Number(e.target.value))} /></label>
      <label>主体放大<input type="range" min={1} max={4} step={0.05} value={zoom} onChange={e => setZoom(Number(e.target.value))} /></label>
    </fieldset><div className="editor-dialog-actions"><button type="button" className="secondary" disabled={busy} onClick={close}>取消</button>
      <button type="button" disabled={busy || !ready} onClick={async () => {
        setBusy(true); setError("");
        try {
          const blob = await new Promise<Blob>((resolve, reject) => canvas.current!.toBlob(value => value ? resolve(value) : reject(new Error("裁剪失败，请重试。")), "image/png"));
          const form = new FormData(); form.append("file", blob, asset.name.replace(/\.[^.]+$/, "").slice(0, 170) + "-crop.png"); form.append("group", asset.group);
          saved(await api<Asset>("admin/assets", "POST", form));
        } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
      }}>{busy ? "正在保存…" : "另存为新附件"}</button></div>
  </EditorDialog>;
}
