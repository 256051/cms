"use client";
import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/client";
import type { components } from "@/lib/api.generated";
import type { Page, User } from "@/lib/types";
import { localDateTime } from "./ContentHistory";
import { Heading, Notice, LoadState, Pager, useLoad } from "./shared";
import { confirmNavigation, useUnsavedChanges } from "./unsaved";

type Report = components["schemas"]["TrafficReport"];
type Visitor = Required<components["schemas"]["VisitorProfile"]>;
type Visit = Required<components["schemas"]["PageVisit"]>;
type Lead = Required<components["schemas"]["CustomerLead"]>;
const statuses = { new: "待联系", following: "跟进中", completed: "已完成", invalid: "无效" };
const date = (offset = 0) => new Date(Date.now() + (8 + offset * 24) * 3600000).toISOString().slice(0, 10);
const time = (value: string) => new Date(value).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" });
const avg = (sum: number, count: number) => count ? Math.round(sum / count) : 0;

export function TrafficOverview({ compact = false }: { compact?: boolean }) {
  const [range, setRange] = useState({ from: date(-6), to: date() });
  const { data, error, loading, reload } = useLoad<Report>(`admin/traffic?from=${range.from}&to=${range.to}`);
  return <section className="traffic-overview">
    {compact ? <div className="section-heading"><h2>访问与咨询</h2><a href="/admin/traffic">查看完整统计 →</a></div> :
      <Heading title="访问统计" description="查看内容表现与咨询情况。日期按北京时间统计，独立访客按浏览器标识去重。" />}
    <Notice error={error} /><LoadState loading={loading} error={error} retry={reload} />
    {!compact && <form className="traffic-filters" key={`${range.from}:${range.to}`} onSubmit={event => {
      event.preventDefault(); const fields = new FormData(event.currentTarget);
      setRange({ from: String(fields.get("from")), to: String(fields.get("to")) });
    }}><label>开始日期<input name="from" type="date" required defaultValue={range.from} max={date()} /></label>
      <label>结束日期<input name="to" type="date" required defaultValue={range.to} max={date()} /></label>
      <button>查询</button><button type="button" className="secondary" onClick={() => setRange({ from: date(-6), to: date() })}>最近 7 天</button>
      <button type="button" className="secondary" onClick={() => setRange({ from: date(-29), to: date() })}>最近 30 天</button>
      <small className="muted">单次最多查询 90 天</small></form>}
    {data && <>
      <div className="traffic-cards">
        {[["今日浏览量", data.today.views, `累计 ${data.totalViews} 次`],
          ["今日独立访客", data.today.visitors, `累计 ${data.totalVisitors} 个浏览器标识`],
          ["今日新增咨询", data.todayLeads, "成功提交的咨询"]].map(([title, value, hint]) => <div className="stat-card" key={title}>
            <span>{title}</span><strong>{value}</strong><small>{hint}</small></div>)}
      </div>
      {!compact && <>
        <section className="panel traffic-chart-panel"><div className="section-heading"><h2>访问趋势</h2><span className="muted">{range.from} 至 {range.to}</span></div>
          <TrafficChart days={data.days} />
          <details><summary>查看每日数据</summary><div className="table-scroll"><table><caption className="sr-only">每日浏览、访客与新增咨询，北京时间</caption>
            <thead><tr><th>日期</th><th>浏览量</th><th>独立访客</th><th>新增咨询</th></tr></thead>
            <tbody>{data.days.map(day => <tr key={day.day}><td>{day.day}</td><td>{day.views}</td><td>{day.visitors}</td><td>{day.leads}</td></tr>)}</tbody>
          </table></div></details>
        </section>
        <section className="traffic-period" aria-label="所选期间汇总">
          <span>期间浏览 <strong>{data.period.views}</strong></span><span>期间独立访客 <strong>{data.period.visitors}</strong></span>
          <span>成功咨询 <strong>{data.periodLeads}</strong></span><span>咨询按钮点击 <strong>{data.consultationClicks}</strong></span>
          <span>下载链接点击 <strong>{data.downloadClicks}</strong></span>
        </section>
        <div className="traffic-splits">
          <Breakdown title="访问来源（最多 100 项）" rows={data.sources} />
          <Breakdown title="设备分布" rows={data.devices} />
        </div>
        <section className="panel table-panel"><h2 className="traffic-table-title">热门内容 · 前 20 篇</h2><div className="table-scroll"><table>
          <thead><tr><th>文章 / 页面</th><th>浏览量</th><th>独立访客</th><th>平均可见时长</th><th>平均阅读深度</th></tr></thead>
          <tbody>{data.popular.map(row => <tr key={row.contentId}><td><a href={row.path} target="_blank" rel="noopener noreferrer">{row.title}</a></td>
            <td>{row.views}</td><td>{row.visitors}</td><td>{avg(row.activeSeconds, row.views)} 秒</td><td>{avg(row.depthSum, row.views)}%</td></tr>)}</tbody>
        </table></div>{data.popular.length === 0 && <p className="empty-state">所选期间还没有文章访问记录。</p>}</section>
        <p className="muted traffic-help">浏览量在页面实际显示后记录。预览、已登录工作人员和已识别爬虫不计入；独立访客是浏览器标识数量，同一个人在不同设备上可能重复计数。阅读时长仅累计页面可见时间，下载和咨询点击分别统计，点击不代表下载完成或已提交咨询。统计从功能启用后开始。</p>
      </>}
    </>}
  </section>;
}

function TrafficChart({ days }: { days: Report["days"] }) {
  const host = useRef<SVGSVGElement>(null);
  const [width, setWidth] = useState(800);
  useEffect(() => {
    const observer = new ResizeObserver(entries => setWidth(Math.max(260, Math.round(entries[0].contentRect.width))));
    if (host.current) observer.observe(host.current);
    return () => observer.disconnect();
  }, []);
  const max = Math.max(2, Math.ceil(Math.max(...days.map(d => Math.max(d.views, d.visitors))) / 2) * 2);
  const x = (i: number) => 52 + i * (width - 70) / Math.max(1, days.length - 1);
  const y = (value: number) => 196 - value * 150 / max;
  return <><div className="traffic-legend"><span className="traffic-pv">实线：浏览量（次）</span><span className="traffic-uv">虚线：独立访客（个）</span></div>
    <svg ref={host} className="traffic-chart" viewBox={`0 0 ${width} 240`} role="img" aria-label="所选期间每日浏览量和独立访客趋势，下方提供每日数据表">
      <title>每日浏览量和独立访客 · 北京时间</title>
      {[0, .5, 1].map(f => <g key={f}><line className="traffic-grid" x1="52" x2={width - 18} y1={y(f * max)} y2={y(f * max)} />
        <text x="40" y={y(f * max) + 4} textAnchor="end">{Intl.NumberFormat("zh-CN", { notation: "compact" }).format(f * max)}</text></g>)}
      <text x="52" y="22">次数 / 个数</text>
      <polyline className="traffic-pv-line" points={days.map((d, i) => `${x(i)},${y(d.views)}`).join(" ")} />
      <polyline className="traffic-uv-line" points={days.map((d, i) => `${x(i)},${y(d.visitors)}`).join(" ")} />
      {days.map((d, i) => <circle className="traffic-point" key={d.day} cx={x(i)} cy={y(d.views)} r="3"><title>{d.day}：浏览 {d.views} 次，访客 {d.visitors} 个</title></circle>)}
      <text x="52" y="220">{width < 400 ? days[0]?.day.slice(5) : days[0]?.day}</text><text x={width / 2} y="238" textAnchor="middle">日期（北京时间）</text>
      <text x={width - 18} y="220" textAnchor="end">{width < 400 ? days.at(-1)?.day.slice(5) : days.at(-1)?.day}</text>
    </svg></>;
}

function Breakdown({ title, rows }: { title: string; rows: Report["sources"] }) {
  const max = Math.max(1, ...rows.map(r => r.views));
  return <section className="panel"><h2>{title}</h2>{rows.length ? rows.map(row => <div className="traffic-breakdown" key={row.name}>
    <span>{row.name}</span><meter min={0} max={max} value={row.views} aria-label={`${row.name}浏览量`} /><span>{row.views} 次 · {row.visitors} 位访客</span>
  </div>) : <p className="muted">所选期间暂无访问。</p>}</section>;
}

export function VisitorManager({ initialId }: { initialId?: string }) {
  const [page, setPage] = useState(1), [selected, setSelected] = useState(initialId || "");
  const { data, error, loading, reload } = useLoad<Page<Visitor>>("admin/visitors?page=" + page);
  return <><Heading title="访客记录" description="查看访问 IP、所属地区及浏览路径。地区为 IP 的大致归属地，不代表实时定位；历史未采集数据标为未记录。" />
    {selected ? <VisitorHistory id={selected} close={() => setSelected("")} /> : <>
      <Notice error={error} /><LoadState loading={loading} error={error} retry={reload} />
      <section className="panel table-panel"><div className="table-scroll"><table><thead><tr><th>访客标识</th><th>首次访问</th><th>最近访问</th><th>最近 IP / 所属地区</th><th>浏览量</th><th>首次来源 / 最近设备</th><th>操作</th></tr></thead>
        <tbody>{data?.items.map(row => <tr key={row.id}><td title={row.id}>{row.id.slice(0, 12)}</td><td>{time(row.createdAt)}</td><td>{time(row.lastSeenAt)}</td><td className="traffic-network"><span>{row.ipAddress || "未记录"}</span><small>{row.location || "未记录"}</small></td><td>{row.views}</td>
          <td>{row.source} / {row.device}</td><td><button className="secondary" onClick={() => setSelected(row.id)}>查看轨迹</button></td></tr>)}</tbody>
      </table></div>{data?.total === 0 && <p className="empty-state">还没有访客记录。</p>}<Pager data={data} setPage={setPage} /></section>
    </>}
  </>;
}

function VisitorHistory({ id, close }: { id: string; close: () => void }) {
  const [page, setPage] = useState(1);
  const { data, error, loading, reload } = useLoad<Page<Visit>>(`admin/visitors/${id}/visits?page=${page}`);
  return <section className="panel table-panel"><div className="table-toolbar"><button className="secondary" onClick={close}>← 返回访客</button><strong>访客 {id.slice(0, 12)} 的访问轨迹</strong></div>
    <Notice error={error} /><LoadState loading={loading} error={error} retry={reload} />
    <div className="table-scroll"><table><thead><tr><th>访问时间</th><th>页面</th><th>访问 IP / 所属地区</th><th>来源</th><th>设备</th><th>可见时长</th><th>阅读深度</th></tr></thead>
      <tbody>{data?.items.map(row => <tr key={row.id}><td>{time(row.createdAt)}</td><td><strong>{row.title}</strong><small className="traffic-path">{row.path}</small></td>
        <td className="traffic-network"><span>{row.ipAddress || "未记录"}</span><small>{row.location || "未记录"}</small></td>
        <td>{row.source}</td><td>{row.device}</td><td>{row.activeSeconds} 秒</td><td>{row.contentId ? `${row.depth}%` : "—"}</td></tr>)}</tbody>
    </table></div>{data?.total === 0 && <p className="empty-state">该浏览器没有访问记录。</p>}<Pager data={data} setPage={setPage} /></section>;
}

export function LeadManager() {
  const [page, setPage] = useState(1), [status, setStatus] = useState(""), [q, setQ] = useState("");
  const [owner, setOwner] = useState(""), [overdue, setOverdue] = useState(false);
  const users = useLoad<User[]>("admin/users");
  const query = new URLSearchParams({ page: String(page), status, q, owner, overdue: String(overdue) });
  const [selected, setSelected] = useState<Lead>();
  const { data, error, loading, reload } = useLoad<Page<Lead>>(`admin/leads?${query}`);
  return <><Heading title="客户咨询" description="联系客户、记录跟进情况。联系方式仅管理员可见。" />
    <Notice error={error} /><LoadState loading={loading} error={error} retry={reload} />
    {selected && <LeadDetail key={selected.id} lead={selected} close={() => setSelected(undefined)} saved={() => { setSelected(undefined); void reload(); }} />}
    <section className="panel table-panel"><div className="table-toolbar editorial-filters"><label>跟进状态<select value={status} onChange={event => { setStatus(event.target.value); setPage(1); }}>
      <option value="">全部状态</option>{Object.entries(statuses).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <label>负责人<select value={owner} onChange={e => { setOwner(e.target.value); setPage(1); }}><option value="">全部负责人</option>{users.data?.filter(u => u.role === "Admin").map(u => <option key={u.id} value={u.id}>{u.displayName}</option>)}</select></label>
      <label className="checkbox-label"><input type="checkbox" checked={overdue} onChange={e => { setOverdue(e.target.checked); setPage(1); }} />仅逾期待跟进</label>
      <a className="button secondary" href={`/api/v1/admin/leads/export?${query}`}>导出筛选结果</a>
      <form className="compact-search" onSubmit={event => { event.preventDefault(); setQ(String(new FormData(event.currentTarget).get("q") || "")); setPage(1); }}>
        <input name="q" aria-label="搜索客户" placeholder="称呼、联系方式、公司或学校" maxLength={200} /><button className="secondary">搜索</button></form></div>
      <div className="table-scroll"><table className="lead-table"><thead><tr><th>客户</th><th>联系方式</th><th>需求</th><th>来源</th><th>状态</th><th>提交时间</th><th>操作</th></tr></thead>
        <tbody>{data?.items.map(row => <tr key={row.id}><td><strong>{row.name}</strong><small className="traffic-path">{row.organization || "未填写单位"}</small></td><td>{row.contact}</td>
          <td className="lead-excerpt">{row.need}</td><td>{row.source}</td><td><span className="badge">{statuses[row.status as keyof typeof statuses] || row.status}</span><small className="traffic-path">{users.data?.find(u => u.id === row.ownerId)?.displayName || "未分配"}</small>{row.nextContactAt && <small className="traffic-path">{new Date(row.nextContactAt).getTime() < Date.now() && !["completed", "invalid"].includes(row.status) ? "逾期：" : "下次："}{time(row.nextContactAt)}</small>}</td><td>{time(row.createdAt)}</td>
          <td><button className="secondary" onClick={() => { if (confirmNavigation()) setSelected(row); }}>查看 / 跟进</button></td></tr>)}</tbody>
      </table></div>{data?.total === 0 && <p className="empty-state">没有符合条件的咨询。</p>}<Pager data={data} setPage={setPage} /></section>
  </>;
}

function LeadDetail({ lead, close, saved }: { lead: Lead; close: () => void; saved: () => void }) {
  const fields = JSON.parse(lead.fieldsJson || "[]") as { Key: string; Label: string; Value: string }[];
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [ownerId, setOwnerId] = useState(lead.ownerId);
  const [historyPage, setHistoryPage] = useState(1);
  const users = useLoad<User[]>("admin/users");
  const history = useLoad<Page<Required<components["schemas"]["LeadFollowUp"]>>>(`admin/leads/${lead.id}/followups?page=${historyPage}`);
  const { markChanged, markSaved, confirmDiscard } = useUnsavedChanges("跟进备注尚未保存，确定放弃修改吗？");
  return <section className="panel lead-detail" aria-labelledby="lead-detail-heading"><div className="section-heading"><h2 id="lead-detail-heading">{lead.name}的咨询</h2>
    <button type="button" className="secondary" onClick={() => { if (confirmDiscard()) close(); }} disabled={busy}>关闭详情</button></div>
    <dl><dt>联系方式</dt><dd>{lead.contact}</dd><dt>公司 / 学校</dt><dd>{lead.organization || "未填写"}</dd><dt>需求</dt><dd className="lead-need">{lead.need}</dd>
      <dt>提交页面</dt><dd>{lead.path}</dd><dt>来源渠道</dt><dd>{lead.source}</dd><dt>联系授权时间</dt><dd>{time(lead.consentedAt)}</dd>
      <dt>访客记录</dt><dd><a href={`/admin/visitors/${lead.visitorId}`}>查看此浏览器的访问轨迹 →</a></dd></dl>
    <Notice error={error} />
    {fields.length > 0 && <section><h3>附加信息</h3><dl>{fields.map(field => <div key={field.Key}><dt>{field.Label}</dt><dd className="lead-need">{field.Value}</dd></div>)}</dl></section>}
    <form onChange={markChanged} onSubmit={async event => {
      event.preventDefault(); if (busy) return; setBusy(true); setError(""); const fields = new FormData(event.currentTarget);
      try { await api(`admin/leads/${lead.id}`, "PUT", { status: fields.get("status"), notes: fields.get("notes"), version: lead.version,
        ownerId: fields.get("owner"), nextContactAt: fields.get("next") ? new Date(String(fields.get("next"))).toISOString() : null }); markSaved(); saved(); }
      catch (e) { setError((e as Error).message); } finally { setBusy(false); }
    }}><fieldset disabled={busy} className="form-fields"><label>跟进状态<select name="status" defaultValue={lead.status}>
      {Object.entries(statuses).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <label>负责人<select name="owner" value={ownerId} onChange={e => setOwnerId(e.target.value)} disabled={users.loading || !!users.error}><option value="">未分配</option>{users.data?.filter(u => u.role === "Admin" && (u.enabled || u.id === lead.ownerId)).map(u => <option key={u.id} value={u.id}>{u.displayName}</option>)}</select></label>
      <label>下次联系时间<input name="next" type="datetime-local" defaultValue={localDateTime(lead.nextContactAt)} /></label>
      <label>本次跟进记录<textarea name="notes" maxLength={4000} rows={4} placeholder="记录本次沟通结果，历史记录会保留" /></label>
      <div className="row-actions"><button disabled={users.loading || !!users.error}>{busy ? "正在保存…" : "保存跟进"}</button><button type="button" className="danger secondary" onClick={async () => {
        if (!window.confirm("删除这条咨询及联系方式？此操作无法撤销。")) return;
        setBusy(true); setError("");
        try { await api(`admin/leads/${lead.id}?version=${lead.version}`, "DELETE"); markSaved(); saved(); }
        catch (e) { setError((e as Error).message); } finally { setBusy(false); }
      }}>删除咨询</button></div></fieldset></form>
      <h3>逐次跟进记录</h3><Notice error={history.error || users.error} /><LoadState loading={history.loading} error={history.error} retry={history.reload} />
      <ul className="history-list">{history.data?.items.map(item => <li key={item.id}><div><strong>{time(item.createdAt)} · {item.actor}</strong><p>{item.notes || "更新负责人或跟进状态"}</p>
        <small>{statuses[item.status as keyof typeof statuses]} · {users.data?.find(u => u.id === item.ownerId)?.displayName || "未分配"}{item.nextContactAt && ` · 下次联系 ${time(item.nextContactAt)}`}</small></div></li>)}</ul>
      {history.data?.total === 0 && lead.notes && <p>原有备注：{lead.notes}</p>}<Pager data={history.data} setPage={setHistoryPage} />
  </section>;
}
