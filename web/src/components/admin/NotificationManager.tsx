"use client";
import { useEffect, useState } from "react";
import { api } from "@/lib/client";
import type { components } from "@/lib/api.generated";
import type { Page } from "@/lib/types";
import { Heading, Notice, Pager, LoadState, useLoad } from "./shared";

export default function NotificationManager() {
  const [page, setPage] = useState(1), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const rows = useLoad<Page<Required<components["schemas"]["NotificationDelivery"]>>>(`admin/notifications?page=${page}`);
  const settings = useLoad<Required<components["schemas"]["NotificationSettings"]>>("admin/notifications/settings");
  const pending = rows.data?.items.some(row => row.status === "queued");
  useEffect(() => {
    if (!pending) return;
    const timer = window.setInterval(() => { void rows.reload(); }, 5000);
    return () => window.clearInterval(timer);
  }, [pending, rows.reload]);
  async function test(channel: string) {
    setBusy(true); setError(""); setSuccess("");
    try {
      await api(`admin/notifications/test/${channel}`, "POST");
      setSuccess("测试通知已排队，下方会自动更新发送结果；发送成功表示接收服务已接受，请核对邮箱或群消息。");
      setPage(1); await rows.reload();
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }
  const status: Record<string, string> = { queued: "等待发送", sent: "已发送", failed: "发送失败", cancelled: "事件已解除" };
  const time = (value?: string | null) => value ? new Date(value).toLocaleString("zh-CN") : "—";
  return <><Heading title="通知记录" description="新咨询、跟进逾期、备份和定时发布异常的发送结果。" />
    <Notice error={error || rows.error || settings.error || settings.data?.errors.join(" ")} success={success} />
    <section className="panel"><h2>通知渠道</h2><p>{settings.data?.enabled ? "通知已启用" : "通知未启用"} · 邮件{settings.data?.emailEnabled ? "已启用" : "未启用"} · 企业微信{settings.data?.weComEnabled ? "已启用" : "未启用"}</p>
      <p className="muted">站点维护人员可通过部署配置启用渠道、设置收件人及凭据。通知仅包含事件类型和后台入口，客户联系方式留在后台查看。</p>
      <div className="row-actions"><button className="secondary" onClick={() => { void rows.reload(); void settings.reload(); }}>刷新通知</button>
      <button disabled={busy || !settings.data?.enabled || !settings.data?.emailEnabled || !!settings.data?.errors.length} onClick={() => void test("email")}>发送测试邮件</button>
      <button disabled={busy || !settings.data?.enabled || !settings.data?.weComEnabled || !!settings.data?.errors.length} onClick={() => void test("wecom")}>发送企业微信测试</button></div>
    </section><LoadState loading={rows.loading} error={rows.error} retry={rows.reload} />
    <section className="panel table-panel"><div className="table-scroll"><table><thead><tr><th>事件</th><th>渠道</th><th>结果</th><th>发送尝试</th><th>最近尝试 / 成功时间</th><th>下次重试</th><th>操作</th></tr></thead><tbody>
      {rows.data?.items.map(row => <tr key={row.id}><td><a href={row.path}>{row.title}</a><small className="traffic-path">{time(row.occurredAt)}</small></td><td>{row.channel === "email" ? "邮件" : "企业微信"}</td>
        <td>{status[row.status] || row.status}{row.error && <small className="traffic-path">{row.error}</small>}</td><td>{row.attempts}</td><td>{time(row.lastAttemptAt)}<small className="traffic-path">{time(row.sentAt)}</small></td><td>{time(row.nextAttemptAt)}</td>
        <td>{row.status === "failed" && <button className="secondary" disabled={busy} onClick={async () => {
          setBusy(true); setError(""); try { await api(`admin/notifications/${row.id}/retry`, "POST"); await rows.reload(); }
          catch (e) { setError((e as Error).message); } finally { setBusy(false); }
        }}>重新排队</button>}</td></tr>)}
    </tbody></table></div>{rows.data?.total === 0 && <p className="empty-state">暂无通知记录。</p>}<Pager data={rows.data} setPage={setPage} /></section>
    <p className="muted">失败后自动逐步延迟重试，每轮最多 5 次；成功的事件不会因重复检查再次发送。</p>
  </>;
}
