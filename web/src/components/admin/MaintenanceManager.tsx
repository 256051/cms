"use client";
import { useState } from "react";
import { api } from "@/lib/client";
import type { components } from "@/lib/api.generated";
import { Heading, Notice, LoadState, useLoad } from "./shared";

export default function MaintenanceManager() {
  const { data, error, loading, reload } = useLoad<components["schemas"]["MaintenanceView"]>("admin/maintenance");
  const files = useLoad<Required<components["schemas"]["BackupFile"]>[]>("admin/maintenance/files");
  const [busy, setBusy] = useState(false), [failure, setFailure] = useState("");
  const [success, setSuccess] = useState("");
  const size = (bytes?: number | null) => bytes == null ? "未知" : bytes >= 1024 ** 3 ? `${(bytes / 1024 ** 3).toFixed(2)} GB` : `${(bytes / 1024 ** 2).toFixed(2)} MB`;
  const time = (value?: string | null) => value ? new Date(value).toLocaleString("zh-CN") : "暂无";
  return <><Heading title="备份与维护" description="备份内容、附件及认证密钥，查看执行结果与访问明细保留范围。" />
    <Notice error={failure || error || data?.state?.error || data?.storageWarning} success={success} /><LoadState loading={loading} error={error} retry={reload} />
    <section className="panel maintenance-status"><h2>站点备份</h2><dl><dt>最近成功</dt><dd>{time(data?.state?.lastSuccessAt)}</dd>
      <dt>最近尝试</dt><dd>{time(data?.state?.lastAttemptAt)}</dd><dt>定时备份</dt><dd>{data?.backupIntervalHours ? `每 ${data.backupIntervalHours} 小时` : "未启用"}</dd></dl>
      <p>磁盘可用 {size(data?.diskFreeBytes)} / 总容量 {size(data?.diskTotalBytes)}</p>
      <p>保留策略：{data?.backupKeepCount ? `最多 ${data.backupKeepCount} 份` : "不限制份数"}；{data?.backupRetentionDays ? `最近 ${data.backupRetentionDays} 天` : "不限制天数"}。仅在新备份成功后清理，始终保留最新成功备份。</p>
      <div className="row-actions"><button disabled={busy || loading} onClick={async () => { setBusy(true); setFailure(""); setSuccess(""); try { await api("admin/maintenance/backup", "POST"); setSuccess("备份已完成，可以下载保存。"); } catch (e) { setFailure((e as Error).message); } finally { await reload(); await files.reload(); setBusy(false); } }}>{busy ? "正在备份…" : "立即备份"}</button>
      {data?.state?.lastSuccessAt && <a className="button secondary" href="/api/v1/admin/maintenance/download">下载最近备份</a>}<button className="secondary" disabled={busy} onClick={() => { void reload(); void files.reload(); }}>刷新状态</button></div>
      <p className="muted">备份含客户资料与认证密钥，请保存在受限位置。恢复需由运维人员将备份还原到新数据库及新的附件、密钥目录。</p>
    </section><section className="panel table-panel"><h2>备份文件</h2><Notice error={files.error} /><LoadState loading={files.loading} error={files.error} retry={files.reload} />
      <div className="table-scroll"><table><thead><tr><th>备份时间</th><th>文件</th><th>大小</th><th>操作</th></tr></thead><tbody>{files.data?.map(file => <tr key={file.name}>
        <td>{time(file.createdAt)}{file.latest && <small> · 最新成功备份</small>}</td><td style={{ overflowWrap: "anywhere" }}>{file.name}</td><td>{size(file.size)}</td>
        <td><a className="button secondary" href={`/api/v1/admin/maintenance/download?name=${encodeURIComponent(file.name)}`}>下载</a></td></tr>)}</tbody></table></div>
      {files.data?.length === 0 && <p className="empty-state">暂无备份文件。</p>}
    </section><section className="panel"><h2>访问明细保留</h2><p>{data?.trafficRetentionDays ? `保留最近 ${data.trafficRetentionDays} 天的访问轨迹、IP、地理位置及点击明细。` : "自动清理未启用。"}</p>
      <p>累计浏览量、累计访客数、文章累计阅读与独立访客数保留。清理期限之前的趋势、来源、停留时长和访客访问轨迹不再可查。</p>
      {data?.state?.trafficSince && <p>明细可查询起点：{time(data.state.trafficSince)}</p>}
      <p className="muted">定时备份及保留期限由站点维护人员设置，保留期限最少 90 天。备份失败会在后台概览提醒。</p>
    </section></>;
}

export function OperationsReminder() {
  const leads = useLoad<number>("admin/leads/overdue-count");
  const backup = useLoad<components["schemas"]["MaintenanceView"]>("admin/maintenance");
  return <>{!!leads.data && <p role="status"><a href="/admin/leads">有 {leads.data} 条咨询逾期待跟进 →</a></p>}
    {backup.data?.state?.error && <Notice error="备份或清理出现异常，请进入备份与维护查看。" />}
    {backup.data?.storageWarning && <Notice error={backup.data.storageWarning} />}</>;
}
