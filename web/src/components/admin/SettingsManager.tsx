"use client";
import { useState } from "react";
import { api } from "@/lib/client";
import type { Settings } from "@/lib/types";
import { defaultCopyright } from "@/lib/theme";
import { Heading, Notice, LoadState, useLoad } from "./shared";
import AssetSelector from "./AssetSelector";
import { useUnsavedChanges } from "./unsaved";

const sections = [["identity", "基本信息"], ["posts", "文章显示"], ["seo", "搜索引擎"], ["comments", "评论设置"], ["footer", "页脚信息"]] as const;
const sizes = [["homePageSize", "首页文章条数"], ["categoryPageSize", "分类页文章条数"], ["tagPageSize", "标签页文章条数"], ["searchPageSize", "搜索结果条数"]] as const;

export default function SettingsManager() {
  const changes = useUnsavedChanges();
  const { data, setData, error, setError, loading } = useLoad<Settings>("admin/settings");
  const [busy, setBusy] = useState(false), [success, setSuccess] = useState("");
  function change<K extends keyof Settings>(key: K, value: Settings[K]) {
    if (data) setData({ ...data, [key]: value });
    changes.markChanged(); setSuccess("");
  }
  return <>
    <Heading title="站点设置" description="管理网站信息、阅读与评论规则。保存后同步应用到所有主题。" />
    <Notice error={error} success={success} />
    <LoadState loading={loading} error={error} retry={() => { if (changes.confirmDiscard()) { changes.markSaved(); window.location.reload(); } }} />
    {data && <div className="settings-layout">
      <nav className="settings-nav" aria-label="设置分组">{sections.map(([id, name]) => <a key={id} href={`#settings-${id}`}>{name}</a>)}</nav>
      <form className="settings-form" onSubmit={async e => {
        e.preventDefault(); setBusy(true); setError(""); setSuccess("");
        try { setData(await api<Settings>("admin/settings", "PUT", data)); changes.markSaved(); setSuccess("站点设置已更新。"); }
        catch (e) { setError((e as Error).message); window.scrollTo({ top: 0, behavior: "instant" }); }
        finally { setBusy(false); }
      }}>
        <fieldset disabled={busy} className="form-fields">
          <section className="panel settings-card" aria-labelledby="settings-identity">
            <h2 id="settings-identity" tabIndex={-1}>基本信息</h2>
            <p className="muted">名称与副标题展示在网站顶部，图标从附件库选择。</p>
            <label>站点名称<input required maxLength={100} value={data.title} onChange={e => change("title", e.target.value)} /></label>
            <label>站点副标题<input maxLength={100} value={data.subtitle} placeholder="一句话介绍你的网站" onChange={e => change("subtitle", e.target.value)} /></label>
            <label>站点介绍<textarea rows={3} maxLength={500} value={data.description} onChange={e => change("description", e.target.value)} /></label>
            <div className="form-grid">
              <div><AssetSelector label="Logo" value={data.logoId} onChange={id => change("logoId", id)} />{data.logoId && <img className="settings-image" src={`/media/${data.logoId}`} alt="站点 Logo" width={56} height={56} />}</div>
              <div><AssetSelector label="浏览器图标 Favicon" value={data.faviconId} onChange={id => change("faviconId", id)} />{data.faviconId && <img className="settings-image" src={`/media/${data.faviconId}`} alt="浏览器图标预览" width={32} height={32} />}<small>建议使用正方形 PNG 图片。</small></div>
            </div>
            <label>内容语言<select aria-label="内容语言" aria-describedby="language-help" value={data.language} onChange={e => change("language", e.target.value)}><option value="zh-CN">简体中文</option><option value="zh-TW">繁体中文</option><option value="en">English</option></select></label>
            <small id="language-help">用于网页的内容语言标记，不会自动翻译正文或后台界面。</small>
          </section>
          <section className="panel settings-card" aria-labelledby="settings-posts">
            <h2 id="settings-posts" tabIndex={-1}>文章显示</h2><p className="muted">每页显示 1–50 篇文章，影响前台列表和分页。</p>
            <div className="form-grid">{sizes.map(([key, label]) => <label key={key}>{label}<input type="number" required min={1} max={50} step={1} value={data[key] || ""} onChange={e => change(key, Number(e.target.value))} /></label>)}</div>
          </section>
          <section className="panel settings-card" aria-labelledby="settings-seo">
            <h2 id="settings-seo" tabIndex={-1}>搜索引擎</h2>
            <label className="checkbox-label"><input type="checkbox" checked={data.blockSearchEngines} onChange={e => change("blockSearchEngines", e.target.checked)} />屏蔽搜索引擎收录</label>
            <p className="muted">开启后输出 noindex 并停止提供站点地图内容。这是收录提示，不限制访客访问。</p>
            <label>关键词<input maxLength={300} placeholder="多个关键词用逗号分隔" value={data.keywords} onChange={e => change("keywords", e.target.value)} /></label>
            <small>首页描述使用“站点介绍”，内容页优先使用文章摘要。关键词不保证搜索排名。</small>
          </section>
          <section className="panel settings-card" aria-labelledby="settings-comments">
            <h2 id="settings-comments" tabIndex={-1}>评论设置</h2>
            <label className="checkbox-label"><input type="checkbox" checked={data.commentsEnabled} onChange={e => change("commentsEnabled", e.target.checked)} />启用评论</label>
            <p className="muted">影响文章和独立页面。关闭后隐藏评论区并拒绝新评论，已有评论仍保留在后台。</p>
            <label className="checkbox-label"><input type="checkbox" disabled={!data.commentsEnabled} checked={data.requireCommentApproval} onChange={e => change("requireCommentApproval", e.target.checked)} />新评论需要审核</label>
            <small>关闭审核后，新提交的评论直接公开；之前待审核的评论仍需手动处理。</small>
            <label className="checkbox-label"><input type="checkbox" disabled={!data.commentsEnabled} checked={data.commentsRequireLogin} onChange={e => change("commentsRequireLogin", e.target.checked)} />仅允许登录用户评论</label>
            <small>使用已有管理员或编辑账号，评论署名使用账号姓名。</small>
          </section>
          <section className="panel settings-card" aria-labelledby="settings-footer">
            <h2 id="settings-footer" tabIndex={-1}>页脚信息</h2>
            <label>页脚文字<textarea maxLength={500} rows={4} placeholder={defaultCopyright()} value={data.footerText} onChange={e => change("footerText", e.target.value)} /></label>
            <small>支持纯文本和换行；留空显示“{defaultCopyright()}”，默认版权年份自动更新。</small>
          </section>
          <div className="settings-save"><span role="status" className="muted">{busy ? "正在保存…" : changes.dirty ? "有尚未保存的修改" : "所有设置已保存"}</span><button disabled={busy}>{busy ? "保存中…" : "保存设置"}</button></div>
        </fieldset>
      </form>
    </div>}
  </>;
}
