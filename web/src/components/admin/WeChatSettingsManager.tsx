"use client";
import { useEffect, useState } from "react";
import { api } from "@/lib/client";
import type { components } from "@/lib/api.generated";
import { Heading, Notice, LoadState, useLoad } from "./shared";
import { useUnsavedChanges } from "./unsaved";

type Settings = Required<components["schemas"]["WeChatConfigurationView"]>;
type Options = Required<components["schemas"]["WeChatOptions"]>;

export default function WeChatSettingsManager() {
  const load = useLoad<Settings>("admin/wechat/configuration");
  const [draft, setDraft] = useState<Options>();
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [success, setSuccess] = useState("");
  const changes = useUnsavedChanges();
  useEffect(() => { if (load.data) setDraft(load.data.values as Options); }, [load.data]);
  function change(patch: Partial<Options>) { setDraft(value => value && { ...value, ...patch }); changes.markChanged(); setSuccess(""); }
  async function save(event: React.FormEvent) {
    event.preventDefault(); if (!draft || busy || load.data?.deploymentManaged) return;
    setBusy(true); setError(""); setSuccess("");
    try {
      const saved = await api<Settings>("admin/wechat/configuration", "PUT", draft);
      load.setData(saved); setDraft(saved.values as Options); changes.markSaved();
      setSuccess(saved.values.autoPublish ? "公众号设置已保存到数据库，无需重启。自动发布已开启，新的同步任务将提交微信发布。" : "公众号设置已保存到数据库，无需重启。请先同步一篇草稿，检查公众号权限、IP 白名单和排版。");
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  return <>
    <Heading title="公众号设置" description="配置微信公众号接入，选择同步草稿或同步后自动发布。" />
    <Notice error={load.error || error} success={success} />
    <LoadState loading={load.loading} error={load.error} retry={load.reload} />
    {draft && load.data && <form onSubmit={save}>
      {load.data.deploymentManaged && <div className="alert" role="status">当前由服务器配置（Consul、环境变量或配置文件）覆盖，后台暂不可编辑。请管理员移除 WeChat 配置覆盖并重启 API 后刷新此页，即可使用数据库配置。</div>}
      <fieldset className="form-fields" disabled={busy || load.data.deploymentManaged}>
        <section className="panel">
          <h2>公众号接入 <span className="badge">{changes.dirty ? "有未保存的修改" : draft.enabled ? load.data.errors.length ? "配置待完善" : "已配置，待实际同步验证" : "未启用"}</span></h2>
          <label className="checkbox-label"><input type="checkbox" checked={draft.enabled} onChange={e => change({ enabled: e.target.checked })} />启用公众号同步</label>
          <label>公众号 AppID<input required={draft.enabled} maxLength={32} value={draft.appId} autoComplete="off" placeholder="wx 开头的公众号 AppID" onChange={e => change({ appId: e.target.value })} /></label>
          <label>公众号 AppSecret<input type="password" autoComplete="new-password" maxLength={256} value={draft.appSecret}
            placeholder={load.data.hasSecret ? "已保存，留空保留原密钥" : "请输入公众号 AppSecret"} onChange={e => change({ appSecret: e.target.value })} /></label>
          <small>密钥加密保存，读取时不回显。更换 AppID 时需要重新填写对应密钥；关闭同步可保留配置。</small>
          <label>默认作者<input maxLength={16} value={draft.author} onChange={e => change({ author: e.target.value })} /></label>
          <label>网站 HTTPS 地址<input type="url" required={draft.enabled} maxLength={500} value={draft.siteUrl} placeholder="https://example.com" onChange={e => change({ siteUrl: e.target.value })} /></label>
          <small>填写网站根地址，用于公众号的“阅读原文”，不要粘贴带方括号的 Markdown 链接。</small>
          <label className="checkbox-label"><input type="checkbox" checked={draft.autoSync} onChange={e => change({ autoSync: e.target.checked })} />定时发布和 API 发布默认同步</label>
          <small>文章编辑页以本次发布的勾选为准，未勾选就不发送。此设置仅影响定时发布及未指定同步选择的 API 请求。</small>
          <label className="checkbox-label"><input type="checkbox" checked={draft.autoPublish} onChange={e => change({ autoPublish: e.target.checked })} />同步草稿后自动发布</label>
          <small>默认关闭，保留草稿供人工审核。开启后，新建的同步任务会提交公众号发布，需具备微信发布接口权限；不会向粉丝群发，不保存微信文章链接，也不会补发已有草稿。</small>
          {draft.autoPublish && <p role="status">当前模式：新建同步任务将自动发布。关闭后尚未提交的任务会取消自动发布；微信已受理的任务仍会查询结果。</p>}
          <Notice error={load.data.errors.join("；")} />
        </section>
        <button disabled={busy || !changes.dirty}>{busy ? "正在保存…" : "保存公众号设置"}</button>
      </fieldset>
      <section className="panel"><h2>接入说明</h2>
        <p>在微信公众平台获取 AppID、AppSecret，并将 API 服务器的公网出口 IP 加入白名单。保存配置不会向粉丝发送消息，也不代表微信接口权限已验证。</p>
        <p>保存后进入文章编辑页，勾选同步到微信公众号，再发布。勾选旁会显示当前是草稿箱还是自动发布模式；已打开的文章页需刷新。首次接入建议先关闭自动发布，检查草稿排版。</p>
        <p><a href="https://mp.weixin.qq.com/" target="_blank" rel="noopener noreferrer">打开微信公众平台</a></p>
      </section>
    </form>}
  </>;
}
