"use client";
import { useEffect, useState } from "react";
import { api } from "@/lib/client";
import type { Content } from "@/lib/types";
import type { components } from "@/lib/api.generated";
import { Notice, useLoad } from "./shared";

type Settings = Required<components["schemas"]["WeChatSettings"]>;
type Delivery = Required<components["schemas"]["WeChatDraftView"]>;
const labels: Record<string, string> = { queued: "等待同步", preparing: "正在上传图片", submitting: "正在提交草稿", draft: "已同步草稿", failed: "同步失败", unknown: "结果待核实", cancelled: "已取消" };
const publicationLabels: Record<string, string> = { queued: "等待自动发布", submitting: "正在提交发布", publishing: "微信发布中", published: "微信已发布", failed: "微信发布失败", unknown: "发布结果待核实", cancelled: "自动发布已取消" };

export default function WeChatDraftPanel({ doc, disabled }: { doc: Content; disabled: boolean }) {
  const settings = useLoad<Settings>("admin/wechat/settings");
  const history = useLoad<Delivery[]>(`admin/wechat/contents/${doc.id}`);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const reload = history.reload;
  useEffect(() => { void reload(); }, [doc.lastPublishedAt, reload]);
  useEffect(() => {
    if (!history.data?.some(row => ["queued", "preparing", "submitting"].includes(row.status) ||
      row.status === "draft" && ["queued", "submitting", "publishing"].includes(row.publicationStatus))) return;
    const timer = window.setTimeout(() => void reload(), 5000);
    return () => window.clearTimeout(timer);
  }, [history.data, reload]);
  async function sync(retryId?: string) {
    if (busy) return;
    setBusy(true); setError(""); setSuccess("");
    try {
      if (retryId) {
        await api(`admin/wechat/${retryId}/retry`, "POST");
        setSuccess("已安排重试，请等待同步结果。");
      } else {
        const row = await api<Delivery>(`admin/wechat/contents/${doc.id}`, "POST", { version: doc.version });
        setSuccess(row.publicationStatus ? `当前发布状态：${publicationLabels[row.publicationStatus] || row.publicationStatus}。` : row.status === "draft" ? "这个发布版本已同步过，没有重复创建草稿。" : `当前同步状态：${labels[row.status] || row.status}。`);
      }
      await reload();
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }
  const ready = settings.data?.enabled && settings.data.errors.length === 0;
  return <section className="panel" aria-label="微信公众号同步">
    <h2>微信公众号</h2>
    <p className="muted">{settings.data?.autoPublish ? "新建同步任务会在草稿创建后自动提交公众号发布，不会群发给粉丝。" : "同步网站已发布版本到公众号草稿箱，再到公众号后台预览和发布。"}</p>
    <Notice error={error || settings.error || history.error || settings.data?.errors.join("；")} success={success} />
    {settings.loading ? <p role="status">正在读取配置…</p> : !settings.data?.enabled ? <p>尚未启用。请管理员在“系统管理 → 公众号设置”中配置接入，并设置服务器 IP 白名单。</p> : <p>{settings.data.appId} · {ready ? "已配置接入" : "配置待完善"}</p>}
    <div className="row-actions">
      <button type="button" disabled={disabled || busy || !ready || !doc.published} onClick={() => void sync()}>{busy ? "处理中…" : "同步已发布版本"}</button>
      <button type="button" className="secondary" disabled={busy || history.loading} onClick={() => { void reload(); void settings.reload(); }}>刷新状态</button>
    </div>
    {!doc.published && <small>请先在网站发布文章。</small>}
    {disabled && <small>请先保存当前修改；同步使用网站已发布版本。</small>}
    {history.loading && <p role="status">正在读取同步记录…</p>}
    {!history.loading && history.data?.length === 0 && <p className="muted">暂无同步记录。</p>}
    {history.data?.map(row => <div key={row.id}>
      <p role="status"><strong>{row.status === "draft" && row.publicationStatus ? publicationLabels[row.publicationStatus] || row.publicationStatus : labels[row.status] || row.status}</strong> · {new Date(row.updatedAt).toLocaleString("zh-CN")}</p>
      {row.error && <p className="alert" role="alert">{row.error}</p>}
      {row.status === "draft" && !row.publicationStatus && <p>草稿已创建，请到公众号后台检查排版。尚未群发。</p>}
      {row.publicationError && <p className="alert" role="alert">{row.publicationError}</p>}
      {row.publicationStatus === "published" && <p>微信已确认发布成功，未群发给粉丝。</p>}
      {row.canRetryPublication && <button type="button" className="secondary" disabled={busy || !ready || !settings.data?.autoPublish} onClick={() => void sync(row.id)}>重试发布</button>}
      {row.status === "failed" && <button type="button" className="secondary" disabled={busy || !ready} onClick={() => void sync(row.id)}>重试此版本</button>}
    </div>)}
    <p><a href="https://mp.weixin.qq.com/" target="_blank" rel="noopener noreferrer">打开微信公众平台</a></p>
  </section>;
}
