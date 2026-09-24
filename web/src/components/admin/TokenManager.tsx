"use client";
import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/client";
import type { components } from "@/lib/api.generated";
import type { Page, User } from "@/lib/types";
import { Heading, LoadState, Notice, Pager, useLoad } from "./shared";
import { useUnsavedChanges } from "./unsaved";

type Token = Required<components["schemas"]["AccessTokenView"]>;
type Issued = components["schemas"]["IssuedAccessToken"];
const scopes = [["content:read", "读取内容和分类标签"], ["content:write", "创建和编辑草稿"], ["asset:upload", "上传附件"], ["ai:generate", "AI 生成内容（消耗模型额度）"], ["content:publish", "直接发布文章和页面"]] as const;
const statuses: Record<string, string> = { active: "有效", expired: "已过期", revoked: "已撤销", disabled: "关联账号已停用" };
const localDate = (date: Date) => new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
const dateText = (date?: string | null) => date ? new Date(date).toLocaleString("zh-CN") : "尚未使用";

export default function TokenManager({ user }: { user: User }) {
  const [page, setPage] = useState(1);
  const [issued, setIssued] = useState<Issued>();
  const changes = useUnsavedChanges(issued ? "访问令牌仅显示这一次，请确认已保存。确定离开吗？" : undefined);
  const { data, loading, error, setError, reload } = useLoad<Page<Token>>(`admin/access-tokens?page=${page}`);
  const members = useLoad<User[]>("admin/users");
  const [busy, setBusy] = useState(false);
  const [success, setSuccess] = useState("");
  const secret = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { if (issued) secret.current?.focus(); }, [issued]);
  const refresh = () => { void reload(); void members.reload(); };
  return <>
    <Heading title="API 访问令牌" description="让 Agent 或脚本通过通用 API 发布内容。每个令牌可单独授权、设置有效期和撤销。" />
    <Notice error={error || members.error} success={success} />
    <LoadState loading={loading || members.loading} error={error || members.error} retry={refresh} />
    {issued && <section className="panel token-secret" aria-labelledby="token-secret-title">
      <h2 id="token-secret-title">请保存访问令牌</h2>
      <p>完整令牌仅显示这一次。请保存到 Agent 的密钥配置中，关闭后无法再次查看。</p>
      <label>完整访问令牌<textarea ref={secret} readOnly rows={3} value={issued.secret || ""} spellCheck={false} onFocus={event => event.target.select()} /></label>
      <div className="token-actions">
        <button type="button" onClick={async () => {
          try { await navigator.clipboard.writeText(issued.secret || ""); setSuccess("令牌已复制，请妥善保存。"); setError(""); }
          catch { secret.current?.focus(); secret.current?.select(); setError("自动复制不可用，请选中文字手动复制。"); }
        }}>复制令牌</button>
        <button type="button" className="secondary" onClick={() => { setIssued(undefined); changes.markSaved(); setSuccess("完整令牌已隐藏，可在下方管理或撤销。"); }}>已保存，关闭</button>
      </div>
    </section>}
    <section className="panel settings-panel token-form">
      <h2>创建访问令牌</h2>
      <form onChange={changes.markChanged} onSubmit={async event => {
        event.preventDefault(); const form = event.currentTarget; const values = new FormData(form);
        if (!values.getAll("scope").length) { setError("请至少选择一项权限。"); return; }
        setBusy(true); setError(""); setSuccess("");
        try {
          const result = await api<Issued>("admin/access-tokens", "POST", { name: values.get("name"), userId: values.get("userId"), scopes: values.getAll("scope"), expiresAt: new Date(String(values.get("expiresAt"))).toISOString() });
          setIssued(result); changes.markChanged(); form.reset(); await reload();
        } catch (error) { setError((error as Error).message); }
        finally { setBusy(false); }
      }}>
        <fieldset className="form-fields" disabled={busy || !!issued || members.loading || !members.data}>
          <div className="form-grid">
            <label>令牌名称<input name="name" required maxLength={100} placeholder="例如：文章发布助手" autoComplete="off" /></label>
            <label>关联账号<select name="userId" defaultValue={user.id} required>{members.data?.filter(member => member.enabled && member.role !== "Support").map(member => <option key={member.id} value={member.id}>{member.displayName}（{member.username}）</option>)}</select></label>
            <label>到期时间<input name="expiresAt" type="datetime-local" required defaultValue={localDate(new Date(Date.now() + 30 * 86_400_000))} min={localDate(new Date(Date.now() + 60_000))} max={localDate(new Date(Date.now() + 365 * 86_400_000))} /></label>
          </div>
          <p className="muted">时间按当前设备时区显示，最长一年。关联账号停用或删除后，令牌不能访问接口。</p>
          <fieldset className="token-scopes"><legend>允许的操作</legend>{scopes.map(([value, label]) => <label className="checkbox-label" key={value}><input type="checkbox" name="scope" value={value} defaultChecked={value !== "content:publish" && value !== "ai:generate"} />{label}</label>)}</fieldset>
          <p className="muted">勾选直接发布后，Agent 可以使内容立即公开。权限适用于站内所有文章和独立页面。</p>
          <button disabled={busy || !!issued}>{busy ? "正在创建…" : "创建令牌"}</button>
        </fieldset>
      </form>
    </section>
    <section aria-label="已创建的访问令牌">
      <div className="token-list">{data?.items.map(token => <article className="panel token-card" key={token.id}>
        <div className="token-card-heading"><h2>{token.name}</h2><span className="muted">{statuses[token.status] || token.status}</span></div>
        <p>关联账号：{token.userDisplayName}</p>
        <p className="muted token-id">标识：{token.id}</p>
        <ul>{scopes.filter(([scope]) => token.scopes.includes(scope)).map(([scope, label]) => <li key={scope}>{label}</li>)}</ul>
        <p className="muted">到期：{dateText(token.expiresAt)}<br />最近使用：{dateText(token.lastUsedAt)}</p>
        <button type="button" className="secondary danger" disabled={busy || !!token.revokedAt} aria-label={`撤销 ${token.name}`} onClick={async () => {
          if (!window.confirm(`撤销“${token.name}”后，使用它的 Agent 将无法继续访问。确定撤销吗？`)) return;
          setBusy(true); setError("");
          try { await api(`admin/access-tokens/${token.id}/revoke`, "POST"); if (issued?.token?.id === token.id) { setIssued(undefined); changes.markSaved(); } setSuccess("令牌已撤销。"); await reload(); }
          catch (error) { setError((error as Error).message); }
          finally { setBusy(false); }
        }}>{token.revokedAt ? "已撤销" : "撤销令牌"}</button>
      </article>)}</div>
      {!loading && !error && data?.total === 0 && <p className="panel empty-state">还没有访问令牌。创建后即可连接 Agent 或自动化脚本。</p>}
      <Pager data={data} setPage={next => { if (!changes.confirmDiscard()) return; setIssued(undefined); changes.markSaved(); setPage(next); }} />
    </section>
  </>;
}
