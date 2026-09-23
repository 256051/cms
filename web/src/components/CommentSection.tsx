"use client";
import { useEffect, useState } from "react";
import { api, ApiError } from "@/lib/client";
import type { Comment, Page, User } from "@/lib/types";
export default function CommentSection({ contentId, preview = false, requireApproval = true, requireLogin = false }: { contentId: string; preview?: boolean; requireApproval?: boolean; requireLogin?: boolean }) {
  const [data, setData] = useState<Page<Comment>>();
  const [page, setPage] = useState(1);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [account, setAccount] = useState<User>();
  const [sessionChecked, setSessionChecked] = useState(!requireLogin);
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    if (!requireLogin) return;
    let active = true;
    const check = () => api<User>("auth/me").then(user => { if (active) setAccount(user); }).catch(e => {
      if (active) { setAccount(undefined); if (!(e instanceof ApiError && e.status === 401)) setError(e.message); }
    }).finally(() => { if (active) setSessionChecked(true); });
    void check(); window.addEventListener("focus", check);
    return () => { active = false; window.removeEventListener("focus", check); };
  }, [requireLogin]);
  useEffect(() => {
    let active = true;
    api<Page<Comment>>(`public/comments?contentId=${contentId}&page=${page}`)
      .then(value => { if (active) setData(value); })
      .catch((e) => { if (active) setError(e.message); });
    return () => { active = false; };
  }, [contentId, page, refresh]);
  return (
    <section className="comments">
      <h2>一起聊聊</h2>
      <p className="muted">{requireApproval ? "留下你的想法，评论审核通过后展示。" : "留下你的想法，提交后即可展示。"}</p>
      {error && (
        <p role="alert" className="alert">
          {error}
        </p>
      )}
      {data?.items.map((c) => (
        <article className="comment" key={c.id}>
          <strong>{c.author}</strong>
          <time>{new Date(c.createdAt).toLocaleDateString("zh-CN")}</time>
          <p>{c.body}</p>
          {c.reply && <blockquote><strong>管理员回复 · {c.replyBy}</strong><p style={{ whiteSpace: "pre-wrap" }}>{c.reply}</p>
            {c.repliedAt && <time dateTime={c.repliedAt}>{new Date(c.repliedAt).toLocaleDateString("zh-CN")}</time>}</blockquote>}
        </article>
      ))}
      {data && (
        <div className="pager">
          {page > 1 && (
            <button className="secondary" onClick={() => setPage(page - 1)}>
              上一页
            </button>
          )}
          {page * data.pageSize < data.total && (
            <button className="secondary" onClick={() => setPage(page + 1)}>
              下一页
            </button>
          )}
        </div>
      )}
      {preview && <p className="muted">预览模式下无法提交评论。</p>}
      {requireLogin && !account && <p className="muted">{sessionChecked ? <><a href="/admin/login" target="_blank" rel="noopener noreferrer">登录已有账号</a>后可评论，登录完成后返回此页。</> : "正在确认登录状态…"}</p>}
      {requireLogin && account && <p className="muted">评论署名：{account.displayName}</p>}
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (preview) return;
          setBusy(true);
          setError("");
          const form = e.currentTarget;
          const values = new FormData(form);
          try {
            const comment = await api<Comment>("public/comments", "POST", {
              contentId,
              author: account?.displayName || values.get("author") || "",
              body: values.get("body"),
            });
            setMessage(comment.approved ? "评论已发布。" : "已提交，等待审核。");
            if (comment.approved) { setPage(1); setRefresh(x => x + 1); }
            form.reset();
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <fieldset disabled={preview || busy || (requireLogin && (!sessionChecked || !account))} className="form-fields">
        {!requireLogin && <label>
          称呼
          <input
            name="author"
            required
            maxLength={60}
            autoComplete="nickname"
          />
        </label>}
        <label>
          你的想法
          <textarea name="body" required maxLength={2000} rows={4} />
        </label>
        <button disabled={busy}>{busy ? "提交中…" : "提交评论"}</button>
        <span role="status">{message}</span>
        </fieldset>
      </form>
    </section>
  );
}
