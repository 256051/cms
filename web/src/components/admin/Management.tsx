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

export function AssetManager() {
  const [page, setPage] = useState(1);
  const { data, error, setError, reload, loading } = useLoad<Page<Asset>>(
    "admin/assets?page=" + page,
  );
  const [busy, setBusy] = useState(false);
  const [success, setSuccess] = useState("");
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
            disabled={busy}
            accept=".png,.jpg,.jpeg,.gif,.webp,.pdf,.mp4,.webm,.mp3,.wav"
            onChange={async (e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              setBusy(true);
              setError("");
              try {
                const body = new FormData();
                body.append("file", file);
                await api("admin/assets", "POST", body);
                await reload();
                setSuccess("附件已上传。");
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          />
        </label>
      </Heading>
      <Notice error={error} success={success} />
      <LoadState loading={loading} error={error} retry={reload} />
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
  const { data, error, setError, reload, loading } =
    useLoad<Taxonomy[]>("admin/taxonomy");
  const [editing, setEditing] = useState<Taxonomy>();
  const [busy, setBusy] = useState(false);
  const [success, setSuccess] = useState("");
  return (
    <>
      <Heading
        title="分类与标签"
        description="用清晰的结构组织内容，帮助读者发现更多。"
      />
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
      <div className="management-grid">
        <section className="panel">
          <h2>{editing ? "编辑分类 / 标签" : "添加分类 / 标签"}</h2>
          <form
            onChange={changes.markChanged}
            key={editing?.id || "new"}
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
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
                          onClick={async () => {
                            if (!confirm("删除此分类或标签？")) return;
                            setBusy(true);
                            try {
                              await api("admin/taxonomy/" + t.id, "DELETE");
                              if (editing?.id === t.id) {
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
            <p className="empty-state">还没有分类或标签。</p>
          )}
        </section>
      </div>
    </>
  );
}

export function CommentManager() {
  const [page, setPage] = useState(1);
  const [pending, setPending] = useState(true);
  const { data, error, setError, reload, loading } = useLoad<Page<Comment>>(
    `admin/comments?page=${page}&pending=${pending}`,
  );
  const [busy, setBusy] = useState(false);
  async function action(c: Comment, remove = false) {
    if (remove && !confirm("永久删除此评论？")) return;
    setBusy(true);
    try {
      await api(
        "admin/comments/" + c.id,
        remove ? "DELETE" : "PUT",
        remove ? undefined : { approved: !c.approved },
      );
      await reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <Heading title="评论" description="审核读者的反馈，让交流保持友好。" />
      <Notice error={error} />
      <LoadState loading={loading} error={error} retry={reload} />
      <div className="tabs">
        <button
          className={pending ? "active" : ""}
          onClick={() => {
            setPending(true);
            setPage(1);
          }}
        >
          待审核
        </button>
        <button
          className={!pending ? "active" : ""}
          onClick={() => {
            setPending(false);
            setPage(1);
          }}
        >
          全部评论
        </button>
      </div>
      <section className="panel">
        {data?.items.map((c) => (
          <article className="moderation-comment" key={c.id}>
            <div>
              <strong>{c.author}</strong>{" "}
              <span className={`badge ${c.approved ? "green" : ""}`}>
                {c.approved ? "已通过" : "待审核"}
              </span>
              <p>{c.body}</p>
              <small className="muted">
                {new Date(c.createdAt).toLocaleString("zh-CN")}
              </small>
            </div>
            <div className="row-actions">
              <button
                className="secondary"
                disabled={busy}
                onClick={() => action(c)}
              >
                {c.approved ? <X size={16} /> : <Check size={16} />}{" "}
                {c.approved ? "隐藏" : "通过"}
              </button>
              <button
                className="danger"
                disabled={busy}
                onClick={() => action(c, true)}
              >
                删除
              </button>
            </div>
          </article>
        ))}
        {!loading && !error && data?.total === 0 && (
          <div className="empty-state">
            <Check size={32} />
            <h3>{pending ? "暂时没有待审核评论" : "还没有评论"}</h3>
            <p>新的读者反馈会出现在这里。</p>
          </div>
        )}
        <Pager data={data} setPage={setPage} />
      </section>
    </>
  );
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
                  </select>
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
                  <td>{u.role === "Admin" ? "管理员" : "内容编辑"}</td>
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
  const { data, error, loading, reload } = useLoad<Page<AuditEntry>>(
    "admin/audit?page=" + page,
  );
  const labels: Record<string, string> = {
    initialize: "初始化站点",
    "content.save": "保存草稿",
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
      <Notice error={error} />
      <LoadState loading={loading} error={error} retry={reload} />
      <section className="panel table-panel">
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>操作</th>
                <th>操作对象</th>
                <th>操作者标识</th>
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
                              post: "文章",
                              page: "页面",
                              asset: "附件",
                              comment: "评论",
                              user: "成员",
                              settings: "站点设置",
                              category: "分类",
                              tag: "标签",
                              menu: "菜单",
                              theme: "主题",
                              token: "访问令牌",
                            } as Record<string, string>
                          )[a.targetType] || a.targetType}{" "}
                          · {a.targetId}
                        </small>
                      </>
                    ) : (
                      <span className="muted">旧版记录未保存操作对象</span>
                    )}
                  </td>
                  <td>
                    {a.actor === "visitor"
                      ? "访客"
                      : a.actor === "operator"
                        ? "部署管理员"
                        : a.actor}
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
