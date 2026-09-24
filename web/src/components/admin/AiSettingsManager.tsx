"use client";
import { useEffect, useState } from "react";
import { api } from "@/lib/client";
import type { components } from "@/lib/api.generated";
import { Heading, Notice, LoadState, useLoad } from "./shared";
import { useUnsavedChanges } from "./unsaved";

type Settings = Required<components["schemas"]["AiConfigurationView"]>;
type Options = Required<components["schemas"]["AiOptions"]>;
type Result = Required<components["schemas"]["AiWritingResult"]>;

export default function AiSettingsManager() {
  const load = useLoad<Settings>("admin/ai/configuration");
  const [draft, setDraft] = useState<Options>();
  const [busy, setBusy] = useState(""), [error, setError] = useState(""), [success, setSuccess] = useState("");
  const changes = useUnsavedChanges();
  useEffect(() => { if (load.data) setDraft(load.data.values as Options); }, [load.data]);
  function change(patch: Partial<Options>) {
    setDraft(value => value && { ...value, ...patch }); changes.markChanged(); setSuccess(""); setError("");
  }
  async function save(event: React.FormEvent) {
    event.preventDefault(); if (!draft || busy || load.data?.deploymentManaged) return;
    setBusy("save"); setError(""); setSuccess("");
    try {
      const saved = await api<Settings>("admin/ai/configuration", "PUT", draft);
      load.setData(saved); changes.markSaved();
      setSuccess("AI 设置已加密保存到数据库，无需重启。可点击测试连接验证实际生成。");
    } catch (e) { setError((e as Error).message); } finally { setBusy(""); }
  }
  async function test() {
    if (busy || changes.dirty) return;
    setBusy("test"); setError(""); setSuccess("");
    try {
      const result = await api<Result>("admin/ai/test", "POST");
      setSuccess("连接测试通过，模型已返回文字：" + result.text);
    } catch (e) { setError((e as Error).message); } finally { setBusy(""); }
  }
  return <>
    <Heading title="AI 写作设置" description="配置写作服务，供管理员与编辑生成内容草稿。" />
    <Notice error={load.error || error} success={success} />
    <LoadState loading={load.loading} error={load.error} retry={load.reload} />
    {draft && load.data && <form onSubmit={save}>
      {load.data.deploymentManaged && <div className="alert" role="status">当前由服务器配置（Consul、环境变量或配置文件）覆盖，后台暂不可编辑。</div>}
      <fieldset className="form-fields" disabled={!!busy || load.data.deploymentManaged}>
        <section className="panel">
          <h2>模型接入 <span className="badge">{changes.dirty ? "有未保存的修改" : draft.enabled ? "已启用" : "未启用"}</span></h2>
          <label className="checkbox-label"><input type="checkbox" checked={draft.enabled} onChange={e => change({ enabled: e.target.checked })} />启用 AI 写作助手</label>
          <label>API 地址<input type="url" required={draft.enabled} maxLength={500} autoComplete="off" value={draft.apiUrl}
            placeholder="https://api.example.com/v1" onChange={e => change({ apiUrl: e.target.value })} /></label>
          <small>支持公网 HTTPS、兼容 OpenAI 的 Chat Completions 接口。填写服务商提供的基础地址（通常含 /v1），也可填写完整的 /chat/completions 地址。</small>
          <label>API Key<input type="password" maxLength={4096} autoComplete="new-password" value={draft.apiKey}
            placeholder={load.data.hasSecret ? "已保存，留空保留原密钥" : "请输入 API Key"} onChange={e => change({ apiKey: e.target.value })} /></label>
          <small>密钥加密保存，不回显。更换 API 地址时必须重新填写对应密钥；停用助手可保留配置。</small>
          <label>模型名称<input required={draft.enabled} maxLength={200} value={draft.model} autoComplete="off"
            placeholder="填写服务商支持的模型名称" onChange={e => change({ model: e.target.value })} /></label>
          <Notice error={load.data.errors.join("；")} />
        </section>
        <button disabled={!changes.dirty || !!busy}>{busy === "save" ? "正在保存…" : "保存 AI 设置"}</button>
      </fieldset>
      <section className="panel">
        <h2>连接测试</h2>
        <p>使用已保存的配置请求一小段文字。测试与写作均可能消耗服务商额度。</p>
        {changes.dirty && <p role="status">请先保存修改，再测试连接。</p>}
        <button type="button" className="secondary" disabled={!!busy || changes.dirty || !draft.enabled || load.data.errors.length > 0} onClick={() => void test()}>
          {busy === "test" ? "正在请求模型…" : "测试连接"}
        </button>
        <p>保存后进入文章或富文本页面编辑器，点击“AI 写作助手”。只有点击生成时才会把当前标题、正文和要求发送给配置的服务商；结果先预览，应用后按现有流程保存草稿。</p>
      </section>
    </form>}
  </>;
}
