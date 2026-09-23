"use client";
import { useState } from "react";
import { FileText, Upload, Check, X, Pencil, Trash2, Plus } from "lucide-react";
import { api, resetCsrf } from "@/lib/client";
import type {
  Asset,
  Page,
  Taxonomy,
  Comment,
  User,
  AuditEntry,
} from "@/lib/types";
import { Heading, Notice, Pager, useLoad, LoadState } from "./shared";
import { useUnsavedChanges } from "./unsaved";
import type { components } from "@/lib/api.generated";
import EditorDialog from "./EditorDialog";
import ImageCropDialog from "./ImageCropDialog";

export function AssetManager() {
  const [page, setPage] = useState(1);
  const [q, setQ] = useState(""), [type, setType] = useState("");
  const [group, setGroup] = useState(""), [editing, setEditing] = useState<Asset>(), [cropping, setCropping] = useState<Asset>();
  const groups = useLoad<string[]>("admin/assets/groups");
  const [failedFiles, setFailedFiles] = useState<File[]>([]), [progress, setProgress] = useState("");
  const [references, setReferences] = useState<Required<components["schemas"]["AssetReference"]>[]>();
  const { data, error, setError, reload, loading } = useLoad<Page<Asset>>(
    `admin/assets?page=${page}&q=${encodeURIComponent(q)}&type=${type}&group=${encodeURIComponent(group)}`,
  );
  const [busy, setBusy] = useState(false);
  const [success, setSuccess] = useState("");
  async function uploadFiles(files: File[]) {
    if (!files.length) return;
    if (files.length > 50) { setError("每批最多上传 50 个文件。"); return; }
    setBusy(true); setError(""); setSuccess("");
    const failed: File[] = [], errors: string[] = [];
    for (const [index, file] of files.entries()) {
      setProgress(`正在上传 ${index + 1} / ${files.length}`);
      try { const body = new FormData(); body.append("file", file); body.append("group", group); await api("admin/assets", "POST", body); }
      catch (e) { failed.push(file); errors.push(`${file.name}：${(e as Error).message}`); }
    }
    setFailedFiles(failed); setProgress(""); setError(errors.join("；")); setSuccess(`已上传 ${files.length - failed.length} 个，失败 ${failed.length} 个。`);
    await reload(); await groups.reload(); setBusy(false);
  }
  return (
    <>
      <Heading
        title="附件库"
        description="集中管理图片与文件，为内容增添细节。"
      >
        <label className="button file-button">
          <Upload size={17} />
          {busy ? "上传中…" : "上传附件"}
          <input
            type="file"
            multiple
            disabled={busy}
            accept=".png,.jpg,.jpeg,.gif,.webp,.pdf,.mp4,.webm,.mp3,.wav"
            onChange={e => { const files = Array.from(e.target.files || []); e.target.value = ""; void uploadFiles(files); }}
          />
        </label>
      </Heading>
      <Notice error={error} success={success} />
      {progress && <p role="status">{progress}</p>}{failedFiles.length > 0 && <button className="secondary" disabled={busy} onClick={() => void uploadFiles(failedFiles)}>重试失败的 {failedFiles.length} 个文件</button>}
      <LoadState loading={loading} error={error} retry={reload} />
      <div className="table-toolbar editorial-filters"><form className="compact-search" onSubmit={e => { e.preventDefault(); setQ(String(new FormData(e.currentTarget).get("q") || "")); setPage(1); }}><input name="q" aria-label="搜索文件名" placeholder="搜索文件名" maxLength={200} /><button className="secondary">搜索</button></form>
        <label>文件类型<select value={type} onChange={e => { setType(e.target.value); setPage(1); }}><option value="">全部类型</option><option value="image">图片</option><option value="video">视频</option><option value="audio">音频</option><option value="application">PDF 文档</option></select></label>
        <label>附件分组<select value={group} disabled={busy} onChange={e => { setGroup(e.target.value); setPage(1); }}><option value="">全部分组</option>{groups.data?.map(name => <option key={name}>{name}</option>)}</select></label></div>
      {editing && <EditorDialog title="附件名称与分组" close={() => { if (!busy) setEditing(undefined); }}><Notice error={error} />
        <label>文件名<input value={editing.name} maxLength={200} disabled={busy} onChange={e => setEditing({ ...editing, name: e.target.value })} /></label>
        <label>分组<input value={editing.group} list="asset-groups" maxLength={80} disabled={busy} placeholder="输入新分组或选择已有分组" onChange={e => setEditing({ ...editing, group: e.target.value })} /></label>
        <datalist id="asset-groups">{groups.data?.map(name => <option key={name}>{name}</option>)}</datalist>
        <button type="button" disabled={busy} onClick={async () => { setBusy(true); setError(""); try {
          await api(`admin/assets/${editing.id}`, "PUT", { name: editing.name, group: editing.group, version: editing.version });
          setEditing(undefined); await reload(); await groups.reload(); setSuccess("附件信息已保存，已有引用地址保持有效。");
        } catch (e) { setError((e as Error).message); } finally { setBusy(false); } }}>保存附件信息</button>
      </EditorDialog>}
      {cropping && <ImageCropDialog asset={cropping} close={() => setCropping(undefined)} saved={asset => { setCropping(undefined); setSuccess(`已另存“${asset.name}”，原图片保留。`); void reload(); }} />}
      {references && <section className="panel"><h2>附件引用位置</h2><p>历史版本和回收站也会保留附件引用。恢复内容前请勿删除文件。</p>
        {references.length ? <ul className="reference-list">{references.map((ref, index) => <li key={index}><a href={ref.kind === "site" ? "/admin/settings" : `/admin/${ref.kind === "page" ? "pages" : ref.kind === "template" ? "templates" : ref.kind === "block" ? "blocks" : ref.kind === "product" ? "products" : ref.kind === "case" ? "cases" : "posts"}${ref.deleted ? "?status=trash" : "/" + ref.contentId}`}>{ref.title}</a> · {ref.source}{ref.deleted && "（回收站）"}{ref.version != null && ` · 版本 ${ref.version}`}</li>)}</ul> : <p>当前未被引用。</p>}
        <button className="secondary" onClick={() => setReferences(undefined)}>关闭引用列表</button></section>}
      <p className="muted">
        支持 PNG、JPEG、GIF、WebP、PDF、MP4、WebM、MP3 和 WAV。默认单个文件不超过 10 MB。
      </p>
      <div className="asset-grid">
        {data?.items.map((a) => (
          <article className="panel asset-card" key={a.id}>
            <a
              href={a.url}
              target="_blank"
              className="asset-preview"
              aria-label={"查看 " + a.name}
            >
              {a.contentType.startsWith("image/") ? (
                <img src={a.url} alt={a.name} loading="lazy" />
              ) : (
                <FileText size={46} />
              )}
            </a>
            <strong title={a.name}>{a.name}</strong>
            <small>
              {(a.size / 1024).toFixed(1)} KB ·{" "}
              {new Date(a.createdAt).toLocaleDateString("zh-CN")}
            </small>
            <div className="row-actions">
              <button className="secondary" disabled={busy} onClick={() => { setError(""); setEditing(a); }}>名称与分组</button>
              {a.contentType.startsWith("image/") && <button className="secondary" disabled={busy} onClick={() => setCropping(a)}>裁剪图片</button>}
              <button className="secondary" onClick={async () => { try { setReferences(await api(`admin/assets/${a.id}/references`)); } catch (e) { setError((e as Error).message); } }}>引用位置</button>
              <button
                className="secondary"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(a.url);
                    setSuccess("附件地址已复制。");
                  } catch {
                    setError("浏览器无法复制，请打开附件后复制地址。");
                  }
                }}
              >
                复制地址
              </button>
              <button
                className="icon-button danger-text"
                aria-label={"删除 " + a.name}
                disabled={busy}
                onClick={async () => {
                  if (!confirm("删除此附件？已被内容引用的附件不能删除。"))
                    return;
                  setBusy(true);
                  try {
                    await api("admin/assets/" + a.id, "DELETE");
                    await reload();
                  } catch (e) {
                    setError((e as Error).message);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                <Trash2 size={17} />
              </button>
            </div>
          </article>
        ))}
      </div>
      {!loading && !error && data?.total === 0 && (
        <div className="empty-state">
          <Upload size={36} />
          <h3>为你的内容准备一些素材</h3>
          <p>上传第一张图片，开始建立附件库。</p>
        </div>
      )}
      <Pager data={data} setPage={setPage} />
    </>
  );
}

export function TaxonomyManager() {
  const changes = useUnsavedChanges();
  const { data, setData, error, setError, reload, loading } =
    useLoad<Taxonomy[]>("admin/taxonomy");
  const [editing, setEditing] = useState<Taxonomy>();
  const [busy, setBusy] = useState(false);
  const [success, setSuccess] = useState("");
  const [deleting, setDeleting] = useState<Taxonomy>();
  const [deleteError, setDeleteError] = useState("");
  const [deleted, setDeleted] = useState(false);
  return (
    <>
      <Heading
        title="分类与标签"
        description="用清晰的结构组织内容，帮助读者发现更多。"
      />
      <Notice error={error} success={success} />
      {deleting && <EditorDialog title="删除分类 / 标签" close={() => { if (!busy) setDeleting(undefined); }}>
        <Notice error={deleteError} success={deleted ? `已删除“${deleting.name}”。` : ""} />
        {!deleted && <p>确定删除“{deleting.name}”？被内容、导航或历史版本引用时无法删除。</p>}
        <div className="row-actions">
          {deleted ? <button type="button" onClick={() => setDeleting(undefined)}>完成</button> : <>
            <button type="button" className="secondary" disabled={busy} onClick={() => setDeleting(undefined)}>取消</button>
            <button type="button" className="danger" disabled={busy} onClick={async () => {
              setBusy(true); setDeleteError("");
              try {
                await api("admin/taxonomy/" + deleting.id, "DELETE");
                setData(rows => rows?.filter(row => row.id !== deleting.id));
                if (editing?.id === deleting.id) {
                  changes.markSaved();
                  setEditing(undefined);
                }
                setDeleted(true);
              } catch (e) {
                setDeleteError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}>{busy ? "正在删除…" : "确认删除"}</button>
          </>}
        </div>
      </EditorDialog>}
      <LoadState
        loading={loading}
        error={error}
        retry={() => {
          if (changes.confirmDiscard()) {
            changes.markSaved();
            window.location.reload();
          }
        }}
      />
      <div className="management-grid">
        <section className="panel">
          <h2>{editing ? "编辑分类 / 标签" : "添加分类 / 标签"}</h2>
          <form
            onChange={changes.markChanged}
            key={editing?.id || "new"}
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              setError(""); setSuccess("");
              const f = new FormData(e.currentTarget);
              try {
                await api(
                  "admin/taxonomy" + (editing ? "/" + editing.id : ""),
                  editing ? "PUT" : "POST",
                  Object.fromEntries(f),
                );
                changes.markSaved();
                setEditing(undefined);
                await reload();
                setSuccess("已保存。");
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            <fieldset className="form-fields" disabled={busy}>
              <label>
                类型
                <select name="kind" defaultValue={editing?.kind || "category"}>
                  <option value="category">分类</option>
                  <option value="tag">标签</option>
                </select>
              </label>
              <label>
                名称
                <input
                  name="name"
                  required
                  maxLength={100}
                  defaultValue={editing?.name}
                />
              </label>
              <label>
                访问地址
                <input
                  name="slug"
                  required
                  maxLength={100}
                  pattern="[a-z0-9]+(-[a-z0-9]+)*"
                  placeholder="例如：technology"
                  defaultValue={editing?.slug}
                />
                <small>使用小写字母、数字和连字符。</small>
              </label>
              <div className="row-actions">
                <button disabled={busy}>{editing ? "保存修改" : "添加"}</button>
                {editing && (
                  <button
                    type="button"
                    className="secondary"
                    onClick={() => {
                      if (changes.confirmDiscard()) {
                        changes.markSaved();
                        setEditing(undefined);
                      }
                    }}
                  >
                    取消
                  </button>
                )}
              </div>
            </fieldset>
          </form>
        </section>
        <section className="panel table-panel">
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>名称</th>
                  <th>类型</th>
                  <th>地址</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {data?.map((t) => (
                  <tr key={t.id}>
                    <td>
                      <strong>{t.name}</strong>
                    </td>
                    <td>
                      <span className="badge">
                        {t.kind === "category" ? "分类" : "标签"}
                      </span>
                    </td>
                    <td>{t.slug}</td>
                    <td>
                      <div className="row-actions">
                        <button
                          className="icon-button"
                          aria-label={"编辑 " + t.name}
                          disabled={busy || editing?.id === t.id}
                          onClick={() => {
                            if (changes.confirmDiscard()) {
                              changes.markSaved();
                              setEditing(t);
                            }
                          }}
                        >
                          <Pencil size={16} />
                        </button>
                        <button
                          className="icon-button danger-text"
                          aria-label={"删除 " + t.name}
                          disabled={busy}
                          onClick={() => {
                            setError(""); setSuccess(""); setDeleteError(""); setDeleted(false);
                            setDeleting(t);
                          }}
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!loading && !error && data?.length === 0 && (
            <p className="empty-state">还没有分类或标签。</p>
          )}
        </section>
      </div>
    </>
  );
}

export function CommentManager({ user }: { user: User }) {
  const [page, setPage] = useState(1), [pending, setPending] = useState(true);
  const [contentId, setContentId] = useState(""), [contentTitle, setContentTitle] = useState(""), [q, setQ] = useState("");
  const [selected, setSelected] = useState<string[]>([]), [busy, setBusy] = useState(false), [success, setSuccess] = useState("");
  const [replying, setReplying] = useState<Comment>();
  type Row = Required<components["schemas"]["ManagedComment"]>;
  const { data, error, setError, reload, loading } = useLoad<Page<Row>>(
    `admin/comments?${new URLSearchParams({ page: String(page), pending: String(pending), contentId, q })}`);
  async function moderate(ids: string[], action: string) {
    if (action === "delete" && !confirm(`永久删除选中的 ${ids.length} 条评论及回复？`)) return;
    setBusy(true); setError(""); setSuccess("");
    try { await api("admin/comments/batch", "POST", { ids, action }); setSelected([]); await reload(); setSuccess("评论处理完成。"); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  function filterContent(id: string, title = "") { setContentId(id); setContentTitle(title); setPage(1); setSelected([]); }
  return <><Heading title="评论" description="查看所属内容、审核读者反馈，并由管理员回复。" />
    <Notice error={error} success={success} /><LoadState loading={loading} error={error} retry={reload} />
    {replying && <CommentReply key={replying.id} comment={replying} close={() => setReplying(undefined)} saved={() => { setReplying(undefined); setSuccess("回复已保存；评论通过审核后会在前台展示。"); void reload(); }} />}
    <div className="table-toolbar editorial-filters"><div className="tabs">
      {[true, false].map(value => <button key={String(value)} className={pending === value ? "active" : ""} disabled={busy} onClick={() => { setPending(value); setPage(1); setSelected([]); }}>{value ? "待审核" : "全部评论"}</button>)}
    </div><form className="compact-search" onSubmit={e => { e.preventDefault(); setQ(String(new FormData(e.currentTarget).get("q") || "")); setPage(1); setSelected([]); }}>
      <input name="q" aria-label="搜索评论" placeholder="称呼或评论内容" maxLength={200} /><button className="secondary" disabled={busy}>搜索</button></form>
      {contentId && <p>当前内容：{contentTitle} <button className="secondary" onClick={() => filterContent("")}>查看全部内容</button></p>}
    </div><section className="panel"><div className="row-actions">
      <label className="checkbox-label"><input type="checkbox" aria-label="选择本页评论" disabled={busy || !data?.items.length} checked={!!data?.items.length && data.items.every(x => selected.includes(x.id))}
        onChange={e => setSelected(e.target.checked ? data?.items.map(x => x.id) || [] : [])} />本页全选</label>
      <span>已选 {selected.length} 条</span>{[["approve", "批量通过"], ["hide", "批量隐藏"], ["delete", "批量删除"]].map(([action, label]) =>
        <button key={action} className="secondary" disabled={busy || !selected.length} onClick={() => void moderate(selected, action)}>{label}</button>)}
    </div>{data?.items.map(row => { const c = row; return <article className="moderation-comment" key={c.id}>
      <div><label className="checkbox-label"><input type="checkbox" aria-label={`选择 ${c.author} 的评论`} disabled={busy} checked={selected.includes(c.id)}
        onChange={e => setSelected(e.target.checked ? [...selected, c.id] : selected.filter(id => id !== c.id))} /><strong>{c.author}</strong><span className={`badge ${c.approved ? "green" : ""}`}>{c.approved ? "已通过" : "待审核"}</span></label>
        <p>{row.editorUrl ? <a href={row.editorUrl}>{row.contentTitle}</a> : row.contentTitle}{" "}{row.contentUrl && <a href={row.contentUrl} target="_blank" rel="noopener noreferrer">查看前台</a>}</p>
        <p style={{ whiteSpace: "pre-wrap" }}>{c.body}</p><small className="muted">{new Date(c.createdAt).toLocaleString("zh-CN")}</small>
        {c.reply && <blockquote><strong>管理员回复 · {c.replyBy}</strong><p style={{ whiteSpace: "pre-wrap" }}>{c.reply}</p></blockquote>}</div>
      <div className="row-actions"><button className="secondary" disabled={busy} onClick={() => filterContent(c.contentId, row.contentTitle)}>只看此内容</button>
        {user.role === "Admin" && <button className="secondary" disabled={busy} onClick={() => setReplying(c)}>{c.reply ? "编辑回复" : "回复"}</button>}
        <button className="secondary" disabled={busy} onClick={() => void moderate([c.id], c.approved ? "hide" : "approve")}>{c.approved ? "隐藏" : "通过"}</button>
        <button className="danger secondary" disabled={busy} onClick={() => void moderate([c.id], "delete")}>删除</button></div>
    </article>; })}
      {!loading && data?.total === 0 && <p className="empty-state">没有符合条件的评论。</p>}
      <Pager data={data} setPage={value => { setPage(value); setSelected([]); }} /></section></>;
}

function CommentReply({ comment, close, saved }: { comment: Comment; close: () => void; saved: () => void }) {
  const changes = useUnsavedChanges("回复尚未保存，确定放弃吗？");
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  return <EditorDialog title="管理员回复" close={() => { if (!busy && changes.confirmDiscard()) close(); }}>
    <p>{comment.author}：{comment.body}</p><Notice error={error} />
    <form onChange={changes.markChanged} onSubmit={async e => {
      e.preventDefault(); setBusy(true); setError(""); const reply = String(new FormData(e.currentTarget).get("reply") || "");
      try { await api(`admin/comments/${comment.id}/reply`, "PUT", { reply }); changes.markSaved(); saved(); }
      catch (e) { setError((e as Error).message); } finally { setBusy(false); }
    }}><fieldset className="form-fields" disabled={busy}><label>回复内容<textarea name="reply" rows={5} maxLength={2000} defaultValue={comment.reply || ""} /></label>
      <p className="muted">回复为纯文本；清空后保存可移除回复。不会自动通过评论审核。</p><button>{busy ? "保存中…" : "保存回复"}</button></fieldset></form>
  </EditorDialog>;
}

export function UserManager() {
  const changes = useUnsavedChanges();
  const { data, error, setError, reload, loading } =
    useLoad<User[]>("admin/users");
  const [editing, setEditing] = useState<User | null>();
  const [busy, setBusy] = useState(false);
  const [success, setSuccess] = useState("");
  return (
    <>
      <Heading
        title="成员与权限"
        description="让合适的人参与创作，管理员始终至少保留一位。"
      >
        <button
          disabled={busy || editing === null}
          onClick={() => {
            if (changes.confirmDiscard()) {
              changes.markSaved();
              setEditing(null);
            }
          }}
        >
          <Plus size={16} />
          添加成员
        </button>
      </Heading>
      <Notice error={error} success={success} />
      <LoadState
        loading={loading}
        error={error}
        retry={() => {
          if (changes.confirmDiscard()) {
            changes.markSaved();
            window.location.reload();
          }
        }}
      />
      {editing !== undefined && (
        <section className="panel member-form">
          <h2>{editing ? "编辑成员" : "添加成员"}</h2>
          <form
            onChange={changes.markChanged}
            key={editing?.id || "new"}
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              const f = new FormData(e.currentTarget);
              try {
                await api(
                  "admin/users" + (editing ? "/" + editing.id : ""),
                  editing ? "PUT" : "POST",
                  {
                    username: f.get("username"),
                    displayName: f.get("displayName"),
                    role: f.get("role"),
                    enabled: f.get("enabled") === "on",
                    password: f.get("password") || null,
                    email: f.get("email") || "",
                  },
                );
                changes.markSaved();
                setEditing(undefined);
                await reload();
                setSuccess("成员信息已保存；被修改账号的旧登录会话已失效。");
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            <fieldset className="form-fields" disabled={busy}>
              <div className="form-grid">
                <label>
                  账号
                  <input
                    name="username"
                    required
                    pattern="[a-z0-9][a-z0-9._-]{2,63}"
                    defaultValue={editing?.username}
                    autoComplete="off"
                  />
                </label>
                <label>
                  姓名
                  <input
                    name="displayName"
                    required
                    maxLength={100}
                    defaultValue={editing?.displayName}
                  />
                </label>
                <label>
                  角色
                  <select name="role" defaultValue={editing?.role || "Editor"}>
                    <option value="Editor">内容编辑</option>
                    <option value="Admin">管理员</option>
                    <option value="Support">咨询专员（仅跟进自己的咨询）</option>
                  </select>
                </label>
                <label>
                  通知邮箱（选填）
                  <input name="email" type="email" maxLength={254} defaultValue={editing?.email || ""} />
                  <small>已分配咨询的邮件通知发给负责人；留空时发给站点收件人。</small>
                </label>
                <label>
                  {editing ? "新密码（留空不修改）" : "初始密码"}
                  <input
                    name="password"
                    type="password"
                    required={!editing}
                    minLength={12}
                    maxLength={200}
                    autoComplete="new-password"
                  />
                  <small>至少 12 个字符。</small>
                </label>
              </div>
              <label className="checkbox-label">
                <input
                  name="enabled"
                  type="checkbox"
                  defaultChecked={editing?.enabled ?? true}
                />
                启用账号
              </label>
              <div className="row-actions">
                <button disabled={busy}>保存成员</button>
                <button
                  type="button"
                  className="secondary"
                  onClick={() => {
                    if (changes.confirmDiscard()) {
                      changes.markSaved();
                      setEditing(undefined);
                    }
                  }}
                >
                  取消
                </button>
              </div>
            </fieldset>
          </form>
        </section>
      )}
      <section className="panel table-panel">
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>成员</th>
                <th>账号</th>
                <th>角色</th>
                <th>状态</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {data?.map((u) => (
                <tr key={u.id}>
                  <td>
                    <strong>{u.displayName}</strong>
                  </td>
                  <td>{u.username}</td>
                  <td>{u.role === "Admin" ? "管理员" : u.role === "Support" ? "咨询专员" : "内容编辑"}</td>
                  <td>
                    <span className={`badge ${u.enabled ? "green" : ""}`}>
                      {u.enabled ? "启用" : "停用"}
                    </span>
                  </td>
                  <td>
                    <div className="row-actions">
                      <button
                        className="secondary"
                        disabled={busy || editing?.id === u.id}
                        onClick={() => {
                          if (changes.confirmDiscard()) {
                            changes.markSaved();
                            setEditing(u);
                          }
                        }}
                      >
                        编辑
                      </button>
                      <button
                        className="icon-button danger-text"
                        aria-label={"删除 " + u.displayName}
                        disabled={busy}
                        onClick={async () => {
                          if (!confirm("删除此成员账号？")) return;
                          setBusy(true);
                          try {
                            await api("admin/users/" + u.id, "DELETE");
                            if (editing?.id === u.id) {
                              changes.markSaved();
                              setEditing(undefined);
                            }
                            await reload();
                          } catch (e) {
                            setError((e as Error).message);
                          } finally {
                            setBusy(false);
                          }
                        }}
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!loading && !error && data?.length === 0 && (
          <p className="empty-state">暂无成员。</p>
        )}
      </section>
    </>
  );
}

export function AuditManager() {
  const [page, setPage] = useState(1);
  const [filters, setFilters] = useState({ actor: "", action: "", target: "", from: "", to: "" });
  const users = useLoad<User[]>("admin/users");
  const query = new URLSearchParams({ page: String(page), ...filters });
  if (!filters.from) query.delete("from");
  if (!filters.to) query.delete("to");
  const { data, error, loading, reload } = useLoad<Page<AuditEntry>>(`admin/audit?${query}`);
  const labels: Record<string, string> = {
    initialize: "初始化站点",
    "content.restore-version": "恢复历史版本", "content.restore": "恢复回收站内容", "content.purge": "永久删除内容",
    "content.batch": "批量处理内容", "content.schedule": "设置发布计划", "content.schedule-run": "执行发布计划",
    "asset.metadata": "修改附件名称与分组", "comment.reply": "回复评论", "comment.batch": "批量审核评论",
    "password.recover": "服务器恢复管理员密码", "lead.submit": "提交客户咨询", "lead.followup": "更新咨询跟进", "lead.delete": "删除客户咨询",
    "maintenance.backup": "完成站点备份", "maintenance.backup-failed": "站点备份失败", "maintenance.backup-cleanup": "清理过期备份",
    "maintenance.traffic-cleanup": "清理过期访问明细", "notification.retry": "重新排队通知", "notification.test": "测试通知渠道", "inquiry-form.save": "更新咨询表单",
    "content.save": "保存草稿",
    "content.export": "导出内容包",
    "content.import": "导入内容包",
    "content.publish": "发布内容",
    "content.unpublish": "下架内容",
    "content.delete": "删除内容",
    "asset.upload": "上传附件",
    "asset.delete": "删除附件",
    "comment.submit": "提交评论",
    "comment.moderate": "审核评论",
    "comment.delete": "删除评论",
    "user.save": "保存成员",
    "user.delete": "删除成员",
    "password.change": "修改密码",
    "settings.save": "更新站点设置",
    "theme.apply": "应用主题外观",
    "menu.save": "保存导航",
    "menu.delete": "删除导航",
    "friend-link.save": "保存友情链接",
    "friend-link.delete": "删除友情链接",
    "taxonomy.save": "保存分类标签",
    "taxonomy.delete": "删除分类标签",
    "token.create": "创建访问令牌",
    "token.revoke": "撤销访问令牌",
  };
  return (
    <>
      <Heading
        title="操作记录"
        description="查看站点中的关键操作，不记录密码或正文。"
      />
      <Notice error={error || users.error} />
      <form className="panel editorial-filters table-toolbar" onSubmit={e => {
        e.preventDefault(); const form = new FormData(e.currentTarget);
        setFilters({ actor: String(form.get("actor") || ""), action: String(form.get("action") || ""), target: String(form.get("target") || ""),
          from: form.get("from") ? new Date(String(form.get("from"))).toISOString() : "", to: form.get("to") ? new Date(String(form.get("to"))).toISOString() : "" }); setPage(1);
      }}><label>操作者<select name="actor"><option value="">全部操作者</option><option value="visitor">访客</option><option value="operator">部署管理员</option><option value="scheduler">定时任务</option>
        {users.data?.map(u => <option key={u.id} value={u.id}>{u.displayName}（{u.username}）</option>)}</select></label>
        <label>操作类型<select name="action"><option value="">全部操作</option>{Object.entries(labels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label>操作对象<input name="target" maxLength={300} placeholder="对象名称或标识" /></label>
        <label>开始时间<input name="from" type="datetime-local" /></label><label>结束时间<input name="to" type="datetime-local" /></label>
        <button disabled={loading}>筛选记录</button><button type="reset" className="secondary" onClick={() => { setFilters({ actor: "", action: "", target: "", from: "", to: "" }); setPage(1); }}>清空筛选</button>
      </form>
      <LoadState loading={loading} error={error} retry={reload} />
      <section className="panel table-panel">
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>操作</th>
                <th>操作对象</th>
                <th>操作者</th>
                <th>时间</th>
              </tr>
            </thead>
            <tbody>
              {data?.items.map((a) => (
                <tr key={a.id}>
                  <td>{labels[a.action] || a.action}</td>
                  <td>
                    {a.targetId ? (
                      <>
                        <strong>{a.targetName}</strong>
                        <small className="audit-target">
                          {(
                            {
                              post: "文章", product: "产品", case: "案例", template: "模板", block: "公共区块", lead: "客户咨询", maintenance: "站点维护", notification: "通知", "content-package": "内容包",
                              page: "页面",
                              asset: "附件",
                              comment: "评论",
                              user: "成员",
                              settings: "站点设置",
                              category: "分类",
                              tag: "标签",
                              menu: "菜单",
                              "friend-link": "友情链接",
                              theme: "主题",
                              token: "访问令牌",
                            } as Record<string, string>
                          )[a.targetType] || a.targetType}{" "}
                          · {a.targetId}
                        </small>
                      </>
                    ) : a.targetName ? <strong>{a.targetName}</strong> : (
                      <span className="muted">旧版记录未保存操作对象</span>
                    )}
                  </td>
                  <td>
                    {a.actorName}<small className="audit-target">{a.actor}</small>
                    {a.tokenId && <small className="audit-target">API · {a.tokenName} · {a.tokenId}</small>}
                  </td>
                  <td>{new Date(a.createdAt).toLocaleString("zh-CN")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!loading && !error && data?.total === 0 && (
          <p className="empty-state">暂无操作记录。</p>
        )}
        <Pager data={data} setPage={setPage} />
      </section>
    </>
  );
}
export function PasswordManager() {
  const changes = useUnsavedChanges();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <>
      <Heading title="修改密码" description="修改后需要使用新密码重新登录。" />
      <Notice error={error} />
      <section className="panel settings-panel">
        <form
          onChange={changes.markChanged}
          onSubmit={async (e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            if (f.get("newPassword") !== f.get("confirm")) {
              setError("两次输入的新密码不一致。");
              return;
            }
            setBusy(true);
            try {
              await api("auth/password", "POST", {
                currentPassword: f.get("currentPassword"),
                newPassword: f.get("newPassword"),
              });
              changes.markSaved();
              resetCsrf();
              window.location.assign("/admin/login");
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <fieldset className="form-fields" disabled={busy}>
            <label>
              当前密码
              <input
                name="currentPassword"
                type="password"
                autoComplete="current-password"
                required
                maxLength={200}
              />
            </label>
            <label>
              新密码
              <input
                name="newPassword"
                type="password"
                autoComplete="new-password"
                required
                minLength={12}
                maxLength={200}
              />
            </label>
            <label>
              确认新密码
              <input
                name="confirm"
                type="password"
                autoComplete="new-password"
                required
                minLength={12}
                maxLength={200}
              />
            </label>
            <button disabled={busy}>保存新密码</button>
          </fieldset>
        </form>
      </section>
    </>
  );
}
