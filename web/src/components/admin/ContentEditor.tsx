"use client";
import { useEffect, useRef, useState } from "react";
import { Eye, Save, Send, Trash2 } from "lucide-react";
import { api, ApiError } from "@/lib/client";
import { editorSection, type Asset, type Content, type Taxonomy } from "@/lib/types";
import { newBlock, newLayout } from "@/lib/page-layout";
import { Heading, Notice, useLoad, LoadState } from "./shared";
import RichEditor from "./RichEditor";
import AssetSelector from "./AssetSelector";
import { useUnsavedChanges } from "./unsaved";
import ContentHistory from "./ContentHistory";
import PageBuilder from "./PageBuilder";
import BusinessFieldsEditor, { defaultBusinessFields } from "./BusinessFieldsEditor";
import type { components } from "@/lib/api.generated";
import WeChatDraftPanel from "./WeChatDraftPanel";
import AiWritingDialog from "./AiWritingDialog";

function BlockUses({ id }: { id: string }) {
  const { data, error, loading, reload } = useLoad<Required<components["schemas"]["BlockReference"]>[]>(`admin/blocks/${id}/references`);
  return <section className="panel"><div className="row-actions"><h2>区块引用位置</h2><button type="button" className="secondary" onClick={() => void reload()}>刷新引用</button></div>
    <Notice error={error} />{!loading && !data?.length && <p className="muted">暂未被引用。</p>}
    <ul className="reference-list">{data?.map((ref, index) => <li key={index}><a href={`/admin/${editorSection(ref.kind as Content["kind"])}${ref.deleted ? "?status=trash" : "/" + ref.contentId}`}>{ref.title}</a> · {ref.source}{ref.deleted && "（回收站）"}</li>)}</ul>
    <small>公开页面或定时计划引用中的区块不能下架；历史引用保留时不能永久删除。</small>
  </section>;
}

export default function ContentEditor({
  kind,
  id,
  userId,
}: {
  kind: Content["kind"];
  id?: string;
  userId: string;
}) {
  const [doc, setDoc] = useState<Content>();
  const seo = doc?.seo ?? { title: "", description: "", imageId: "", noIndex: false };
  const { dirty, setDirty } = useUnsavedChanges();
  const [busy, setBusy] = useState(false);
  const [wide, setWide] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const wechat = useLoad<Required<components["schemas"]["WeChatSettings"]>>("admin/wechat/settings");
  const [syncToWeChat, setSyncToWeChat] = useState(false);
  const wechatReady = !!wechat.data?.enabled && wechat.data.errors.length === 0 && !wechat.loading && !wechat.error;
  const syncThisPublication = kind === "post" && wechatReady && syncToWeChat;
  const [loading, setLoading] = useState(!!id);
  const [recovery, setRecovery] = useState<Content>();
  const [conflict, setConflict] = useState(false);
  const [failures, setFailures] = useState(0);
  const [localError, setLocalError] = useState("");
  const saving = useRef(false);
  const draftKey = `cms:draft:${userId}:${kind}:${id || "new"}`;
  useEffect(() => {
    try {
      const saved = localStorage.getItem(draftKey);
      if (saved) {
        const value = JSON.parse(saved) as Content;
        if (value.kind === kind && typeof value.html === "string" && typeof value.title === "string" &&
          Array.isArray(value.tagIds) && Number.isInteger(value.version)) setRecovery(value);
      }
    } catch { setLocalError("浏览器恢复副本不可用，请及时保存草稿。"); }
  }, [draftKey, kind]);
  function clearLocal() { try { localStorage.removeItem(draftKey); } catch { /* Saving to server remains available. */ } }
  useEffect(() => {
    if (!doc || !dirty || recovery) return;
    try { localStorage.setItem(draftKey, JSON.stringify(doc)); setLocalError(""); }
    catch { setLocalError("浏览器存储空间不足或不可用，当前输入尚未备份到本机，请保存草稿。"); }
  }, [doc, dirty, recovery, draftKey]);
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
        layout: (kind === "template" || kind === "block") ? newLayout() : null,
        seo: { title: "", description: "", imageId: "", noIndex: false },
        fields: defaultBusinessFields(kind),
        publicSlug: "",
        views: 0, todayViews: 0, visitors: 0,
        updatedAt: null, lastPublishedAt: null, deletedAt: null, scheduledPublishAt: null, scheduledUnpublishAt: null,
      });
  }, [id, kind]);
  const change = (patch: Partial<Content>) => {
    setDoc((d) => (d ? { ...d, ...patch } : d));
    setDirty(true);
    setSuccess("");
    setFailures(0);
  };
  async function save(publish = false) {
    if (!doc || busy || saving.current || recovery || aiOpen) return;
    saving.current = true;
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
      clearLocal();
      setFailures(0);
      setConflict(false);
      if (publish)
        saved = await api<Content>(
          `admin/contents/${saved.id}/publish`,
          "POST",
          { version: saved.version, syncToWeChat: syncThisPublication },
        );
      setDoc(saved);
      setDirty(false);
      setSuccess(publish ? kind === "block" ? "公共区块已发布，引用页面同步更新。" : kind === "template" ? "模板已发布，可在页面搭建器中选择。" : syncThisPublication ? wechat.data?.autoPublish ? "网站已发布，已安排公众号同步及自动发布，请查看发布结果。" : "网站已发布，已安排公众号草稿同步，请查看同步结果。" : "已发布，网站内容已更新。" : "草稿已保存。");
      completed = true;
    } catch (e) {
      setError((e as Error).message);
      setFailures(n => n + 1);
      if (e instanceof ApiError && e.status === 409) setConflict(true);
    } finally {
      saving.current = false;
      setBusy(false);
      if (!doc.id && saved && completed)
        window.location.replace(
          `/admin/${editorSection(kind)}/${saved.id}`,
        );
    }
  }
  useEffect(() => {
    if (!dirty || !doc?.title.trim() || busy || conflict || recovery || aiOpen || failures >= 3) return;
    const timer = window.setTimeout(() => void save(), failures ? 10000 : 5000);
    return () => window.clearTimeout(timer);
  });
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
          {doc && !doc.layout && <button type="button" className="secondary" disabled={busy || !!recovery || conflict} onClick={() => setAiOpen(true)}>AI 写作助手</button>}
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
            {busy ? "处理中…" : kind === "block" ? "发布公共区块" : kind === "template" ? "发布模板" : "保存并发布"}
          </button>
        </div>
      </Heading>
      <Notice error={error} success={success} />
      {aiOpen && doc && <AiWritingDialog doc={doc} terms={terms ?? []} apply={change} close={() => setAiOpen(false)} />}
      <Notice error={localError} />
      <p role="status" className="muted">{busy ? "正在处理…" : dirty ? "输入已保留，停止编辑 5 秒后自动保存草稿。" : "草稿已同步。"}
        {doc?.updatedAt && ` 最后保存：${new Date(doc.updatedAt).toLocaleString("zh-CN")}`}
        {failures >= 3 && " 自动重试已暂停，请检查网络后手动保存。"}</p>
      {recovery && <section className="panel"><h2>发现未提交的本机恢复副本</h2>
        <p>恢复副本：{recovery.title || "未命名"}。{doc && recovery.version !== doc.version ? "服务器版本已变化，恢复后需另存为新草稿。" : "恢复后可以继续编辑。"}</p>
        <div className="row-actions"><button disabled={!doc || busy} onClick={() => { setConflict(recovery.version !== doc?.version); setDoc(recovery); setDirty(true); setRecovery(undefined); }}>恢复输入</button>
          <button className="secondary" onClick={() => { clearLocal(); setRecovery(undefined); }}>放弃恢复副本</button></div></section>}
      {conflict && doc && <section className="panel"><h2>版本冲突，当前输入已保留</h2><p>请另存为新草稿，或复制需要的内容后重新加载服务器版本。</p>
        <button disabled={busy} onClick={() => { setDoc({ ...doc, id: "", slug: `copy-${Date.now().toString(36)}`, version: 0,
          published: false, publishedAt: null, lastPublishedAt: null, scheduledPublishAt: null, scheduledUnpublishAt: null }); setConflict(false); setFailures(0); setDirty(true); }}>将当前输入另存为新草稿</button></section>}
      <LoadState
        loading={loading}
        error={error}
        retry={() => window.location.reload()}
      />
      {doc && (
        <fieldset
          className={`editor-layout editor-fields${wide ? " editor-wide" : ""}${doc.layout ? " editor-builder" : ""}`}
          disabled={busy || !!recovery}
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
            {(kind === "product" || kind === "case") && <BusinessFieldsEditor fields={doc.fields || []} onChange={fields => change({ fields })} />}
            {kind !== "post" && <div className="builder-mode row-actions">
              <strong>{doc.layout ? "可视化页面搭建" : "富文本页面"}</strong>
              {!doc.layout && <button type="button" className="secondary" onClick={() => {
                const text = new DOMParser().parseFromString(doc.html, "text/html").body.textContent?.trim() || "";
                if (text && !confirm("切换后将保留正文文字，原有富文本排版可从保存后的历史版本恢复。是否继续？")) return;
                change({ layout: newLayout(text ? [{ ...newBlock("text"), title: "", text }] : []) });
              }}>使用页面搭建</button>}
              {doc.layout && kind !== "template" && kind !== "block" && <button type="button" className="secondary" onClick={() => {
                if (dirty) { setError("请先保存当前布局，再切换为富文本。"); return; }
                if (confirm("切换为富文本将保留静态文字和图片，动态模块不再自动更新。原布局可从历史恢复，是否继续？")) change({ layout: null });
              }}>转为富文本</button>}
              {doc.layout && kind !== "template" && kind !== "block" && <button type="button" className="secondary" onClick={async () => {
                const title = prompt("模板名称", (doc.title + "模板").slice(0, 200));
                if (!title?.trim()) return;
                setBusy(true); setError("");
                try { const template = await api<Content>("admin/contents", "POST", { ...doc, kind: "template", slug: `template-${Date.now().toString(36)}`, title, version: 0, fields: [] });
                  setSuccess(`已保存模板草稿“${template.title}”，可在模板库中编辑并发布。`); }
                catch (e) { setError((e as Error).message); } finally { setBusy(false); }
              }}>另存为模板</button>}
            </div>}
            {doc.layout ? <PageBuilder fields={doc.fields} allowReferences={kind !== "block"} layout={doc.layout} title={doc.title} disabled={busy || !!recovery} onChange={layout => change({ layout })} onBusyChange={setBusy} /> : <><label>正文</label><RichEditor
              value={doc.html}
              disabled={busy || !!recovery}
              wide={wide}
              onWideChange={() => setWide(!wide)}
              onBusyChange={(v) => {
                setBusy(v);
                if (v) setDirty(true);
              }}
              onChange={(html) => change({ html })}
              onError={setError}
            /></>}
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
              {kind === "post" && <div>
                <label className="checkbox-label"><input type="checkbox" checked={wechatReady && syncToWeChat}
                  disabled={!wechatReady || busy} aria-describedby="wechat-publish-help"
                  onChange={event => setSyncToWeChat(event.target.checked)} />{wechat.data?.autoPublish ? "同步到微信公众号（自动发布）" : "同步到微信公众号（草稿箱）"}</label>
                <small id="wechat-publish-help">{wechat.loading ? "正在检查公众号接入配置…" : wechat.error ? "无法读取公众号配置，暂不可勾选。" : !wechat.data?.enabled ? "尚未配置公众号接入，暂不可勾选。" : wechat.data.errors.length ? "公众号配置不完整，暂不可勾选：" + wechat.data.errors.join("；") : wechat.data.autoPublish ? "勾选后，新建同步任务会上传图片、创建草稿并自动发布；不会群发给粉丝。" : "勾选后，本次“保存并发布”会同步到公众号草稿箱；不会群发给粉丝。"}</small>
                {(wechat.error || !wechatReady && !wechat.loading) && <button type="button" className="secondary" onClick={() => void wechat.reload()}>重新检查接入</button>}
              </div>}
              <div className="status-row">
                <span>当前状态</span>
                <span className={`badge ${doc.published ? "green" : ""}`}>
                  {doc.published ? "已发布" : "草稿"}
                </span>
              </div>
              <label>
                访问地址
                <input
                  aria-label="访问地址"
                  value={doc.slug}
                  pattern="[a-z0-9]+(-[a-z0-9]+)*"
                  maxLength={160}
                  onChange={(e) => change({ slug: e.target.value })}
                />
                <small>小写字母、数字和连字符。发布后新地址生效，已发布过的旧链接自动跳转。</small>
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
            {kind === "post" && doc.id && <WeChatDraftPanel doc={doc} disabled={busy || dirty || !!recovery} />}
            {kind !== "template" && kind !== "block" && <section className="panel"><h2>搜索与分享</h2>
              <label>SEO 标题<input value={doc.seo?.title || ""} placeholder={doc.title} maxLength={200}
                onChange={e => change({ seo: { ...seo, title: e.target.value } })} /></label>
              <label>SEO 描述<textarea value={doc.seo?.description || ""} placeholder={doc.summary} maxLength={500} rows={3}
                onChange={e => change({ seo: { ...seo, description: e.target.value } })} /></label>
              <AssetSelector label="分享图片" disabled={busy} value={doc.seo?.imageId || ""}
                onChange={imageId => change({ seo: { ...seo, imageId } })} />
              <label className="checkbox-label"><input type="checkbox" checked={doc.seo?.noIndex || false}
                onChange={e => change({ seo: { ...seo, noIndex: e.target.checked } })} />禁止搜索引擎收录此页</label>
              <small>留空时使用标题、摘要及封面。更改随发布生效；禁止收录的页面从站点地图移除。</small>
            </section>}
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
                disabled={busy}
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
                    if (!confirm("将此内容移入回收站？评论和历史版本会保留，可从回收站恢复。"))
                      return;
                    setBusy(true);
                    try {
                      await api(`admin/contents/${doc.id}`, "DELETE", {
                        version: doc.version,
                      });
                      setDirty(false);
                      clearLocal();
                      window.location.assign(
                        "/admin/" + editorSection(kind),
                      );
                    } catch (e) {
                      setError((e as Error).message);
                      setBusy(false);
                    }
                  }}
                >
                  <Trash2 size={16} />
                  移入回收站
                </button>
              </section>
            )}
          </aside>
        </fieldset>
      )}
      {doc?.id && <ContentHistory doc={doc} disabled={busy || dirty || !!recovery} onBusyChange={setBusy} onChange={value => { setDoc(value); clearLocal(); setDirty(false); }} onError={setError} />}
      {kind === "block" && doc?.id && <BlockUses id={doc.id} />}
    </>
  );
}
