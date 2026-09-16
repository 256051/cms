"use client";
import { useEffect, useState } from "react";
import { Eye, Save, Send, Trash2 } from "lucide-react";
import { api } from "@/lib/client";
import type { Asset, Content, Taxonomy } from "@/lib/types";
import { Heading, Notice, useLoad, LoadState } from "./shared";
import RichEditor from "./RichEditor";
import AssetSelector from "./AssetSelector";
import { useUnsavedChanges } from "./unsaved";

export default function ContentEditor({
  kind,
  id,
}: {
  kind: "post" | "page";
  id?: string;
}) {
  const [doc, setDoc] = useState<Content>();
  const { dirty, setDirty } = useUnsavedChanges();
  const [busy, setBusy] = useState(false);
  const [wide, setWide] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [loading, setLoading] = useState(!!id);
  const {
    data: terms,
    error: termsError,
    loading: termsLoading,
    reload: reloadTerms,
  } = useLoad<Taxonomy[]>("admin/taxonomy");
  useEffect(() => {
    if (id)
      api<Content>("admin/contents/" + id)
        .then(setDoc)
        .catch((e) => setError(e.message))
        .finally(() => setLoading(false));
    else
      setDoc({
        id: "",
        kind,
        slug: `${kind}-${Date.now().toString(36)}`,
        title: "",
        summary: "",
        html: "<p></p>",
        coverId: "",
        categoryId: "",
        tagIds: [],
        version: 0,
        published: false,
        publishedAt: null,
        views: 0, todayViews: 0, visitors: 0,
      });
  }, [id, kind]);
  const change = (patch: Partial<Content>) => {
    setDoc((d) => (d ? { ...d, ...patch } : d));
    setDirty(true);
    setSuccess("");
  };
  async function save(publish = false) {
    if (!doc || busy) return;
    setBusy(true);
    setError("");
    let saved: Content | undefined;
    let completed = false;
    try {
      saved = await api<Content>(
        "admin/contents" + (doc.id ? "/" + doc.id : ""),
        doc.id ? "PUT" : "POST",
        doc,
      );
      // A saved draft remains recoverable even if the separate publish request fails.
      setDoc(saved);
      setDirty(false);
      if (publish)
        saved = await api<Content>(
          `admin/contents/${saved.id}/publish`,
          "POST",
          { version: saved.version },
        );
      setDoc(saved);
      setDirty(false);
      setSuccess(publish ? "已发布，网站内容已更新。" : "草稿已保存。");
      completed = true;
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
      if (!id && saved && completed)
        window.location.replace(
          `/admin/${kind === "post" ? "posts" : "pages"}/${saved.id}`,
        );
    }
  }
  useEffect(() => {
    const shortcut = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        if (!busy && doc && !document.querySelector("dialog[open]"))
          void save();
      }
    };
    window.addEventListener("keydown", shortcut);
    return () => window.removeEventListener("keydown", shortcut);
  });
  return (
    <>
      <Heading
        title={id ? "编辑内容" : "开始新的创作"}
        description={
          dirty ? "有尚未保存的修改" : "保存草稿后预览，确认后再发布。"
        }
      >
        <div className="row-actions">
          {doc?.id && (
            <a
              className="button secondary"
              target="_blank"
              href={"/admin/preview/" + doc.id}
            >
              <Eye size={16} />
              预览已保存草稿
            </a>
          )}
          <button
            className="secondary"
            disabled={busy || !doc}
            onClick={() => save()}
          >
            <Save size={16} />
            保存草稿
          </button>
          <button disabled={busy || !doc} onClick={() => save(true)}>
            <Send size={16} />
            {busy ? "处理中…" : "保存并发布"}
          </button>
        </div>
      </Heading>
      <Notice error={error} success={success} />
      <LoadState
        loading={loading}
        error={error}
        retry={() => window.location.reload()}
      />
      {doc && (
        <fieldset
          className={`editor-layout editor-fields${wide ? " editor-wide" : ""}`}
          disabled={busy}
        >
          <section className="panel editor-main">
            <label>
              标题
              <input
                className="title-input"
                placeholder="给你的内容起个标题"
                value={doc.title}
                maxLength={200}
                onChange={(e) => change({ title: e.target.value })}
              />
            </label>
            <label>正文</label>
            <RichEditor
              value={doc.html}
              disabled={busy}
              wide={wide}
              onWideChange={() => setWide(!wide)}
              onBusyChange={(v) => {
                setBusy(v);
                if (v) setDirty(true);
              }}
              onChange={(html) => change({ html })}
              onError={setError}
            />
          </section>
          <aside className="editor-aside">
            <section className="panel">
              <label>
                摘要
                <textarea
                  rows={3}
                  placeholder="用几句话介绍这篇内容…"
                  value={doc.summary}
                  maxLength={500}
                  onChange={(e) => change({ summary: e.target.value })}
                />
              </label>
            </section>
            <section className="panel">
              <h2>发布设置</h2>
              <div className="status-row">
                <span>当前状态</span>
                <span className={`badge ${doc.published ? "green" : ""}`}>
                  {doc.published ? "已发布" : "草稿"}
                </span>
              </div>
              <label>
                访问地址
                <input
                  value={doc.slug}
                  disabled={!!doc.id}
                  pattern="[a-z0-9]+(-[a-z0-9]+)*"
                  maxLength={160}
                  onChange={(e) => change({ slug: e.target.value })}
                />
                <small>小写字母、数字和连字符；创建后固定。</small>
              </label>
              <label>
                分类
                <select
                  disabled={termsLoading || !!termsError}
                  value={doc.categoryId}
                  onChange={(e) => change({ categoryId: e.target.value })}
                >
                  <option value="">不分类</option>
                  {terms
                    ?.filter((t) => t.kind === "category")
                    .map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                </select>
              </label>
              <Notice error={termsError} />
              <LoadState
                loading={termsLoading}
                error={termsError}
                retry={reloadTerms}
              />
              <fieldset disabled={termsLoading || !!termsError}>
                <legend>标签</legend>
                <div className="checkbox-list">
                  {terms
                    ?.filter((t) => t.kind === "tag")
                    .map((t) => (
                      <label key={t.id}>
                        <input
                          type="checkbox"
                          checked={doc.tagIds.includes(t.id)}
                          onChange={(e) =>
                            change({
                              tagIds: e.target.checked
                                ? [...doc.tagIds, t.id]
                                : doc.tagIds.filter((id) => id !== t.id),
                            })
                          }
                        />
                        {t.name}
                      </label>
                    ))}
                </div>
                {!termsLoading &&
                  !termsError &&
                  !terms?.some((t) => t.kind === "tag") && (
                    <small className="muted">可在“分类与标签”中添加。</small>
                  )}
              </fieldset>
            </section>
            <section className="panel">
              <h2>封面图片</h2>
              {doc.coverId && (
                <img
                  className="cover-preview"
                  src={"/media/" + doc.coverId}
                  alt="当前封面"
                />
              )}
              <AssetSelector
                label="从附件库选择"
                value={doc.coverId}
                onChange={(coverId) => change({ coverId })}
              />
              <label className="upload-label">
                上传封面
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/gif"
                  disabled={busy}
                  onChange={async (e) => {
                    const f = e.target.files?.[0];
                    if (!f) return;
                    setBusy(true);
                    try {
                      const form = new FormData();
                      form.append("file", f);
                      const a = await api<Asset>("admin/assets", "POST", form);
                      change({ coverId: a.id });
                    } catch (e) {
                      setError((e as Error).message);
                    } finally {
                      setBusy(false);
                    }
                  }}
                />
              </label>
            </section>
            {doc.id && (
              <section className="panel danger-panel">
                <h2>内容操作</h2>
                {doc.published && (
                  <button
                    className="secondary"
                    disabled={busy || dirty}
                    title={dirty ? "请先保存当前修改" : undefined}
                    onClick={async () => {
                      if (!confirm("确定下架？网站将立即停止展示此内容。"))
                        return;
                      setBusy(true);
                      try {
                        setDoc(
                          await api<Content>(
                            `admin/contents/${doc.id}/unpublish`,
                            "POST",
                            { version: doc.version },
                          ),
                        );
                        setDirty(false);
                        setSuccess("内容已下架。");
                      } catch (e) {
                        setError((e as Error).message);
                      } finally {
                        setBusy(false);
                      }
                    }}
                  >
                    下架内容
                  </button>
                )}
                <button
                  className="danger"
                  disabled={busy}
                  onClick={async () => {
                    if (!confirm("永久删除此内容及评论？此操作无法撤销。"))
                      return;
                    setBusy(true);
                    try {
                      await api(`admin/contents/${doc.id}`, "DELETE", {
                        version: doc.version,
                      });
                      setDirty(false);
                      window.location.assign(
                        "/admin/" + (kind === "post" ? "posts" : "pages"),
                      );
                    } catch (e) {
                      setError((e as Error).message);
                      setBusy(false);
                    }
                  }}
                >
                  <Trash2 size={16} />
                  删除内容
                </button>
              </section>
            )}
          </aside>
        </fieldset>
      )}
    </>
  );
}
