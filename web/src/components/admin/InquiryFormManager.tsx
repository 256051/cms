"use client";
import { useEffect, useState } from "react";
import { api } from "@/lib/client";
import type { components } from "@/lib/api.generated";
import { Heading, Notice, useLoad, LoadState } from "./shared";
import { useUnsavedChanges } from "./unsaved";

type Form = Required<components["schemas"]["InquiryFormView"]>;
export default function InquiryFormManager() {
  const load = useLoad<Form>("admin/inquiry-form"), [doc, setDoc] = useState<Form>();
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [success, setSuccess] = useState("");
  const changes = useUnsavedChanges();
  useEffect(() => { if (load.data) setDoc(load.data); }, [load.data]);
  function change(fields: Form["fields"]) { setDoc({ ...doc!, fields }); changes.markChanged(); setSuccess(""); }
  return <><Heading title="咨询表单" description="配置客户咨询的附加字段，已收到的咨询保留提交时的名称与内容。" />
    <Notice error={error || load.error} success={success} /><LoadState loading={load.loading} error={load.error} retry={load.reload} />
    {doc && <form className="panel settings-panel inquiry-form-editor" onSubmit={async e => {
      e.preventDefault(); setBusy(true); setError(""); try {
        setDoc(await api<Form>("admin/inquiry-form", "PUT", { ...doc, fields: doc.fields.map(field => ({ ...field, options: (field.options || []).map(x => x.trim()).filter(Boolean) })) }));
        changes.markSaved(); setSuccess("表单已保存，访客填写时会使用这些字段。");
      } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
    }}><p>称呼、联系方式、需求描述及联系授权为固定必填项，公司／学校可选填写。下面最多添加 20 项。</p>
      <fieldset disabled={busy} className="form-fields"><legend>附加字段</legend>
        {doc.fields.map((field, index) => <section className="panel inquiry-field" key={field.key}>
          <div className="form-grid"><label>字段名称 {index + 1}<input required value={field.label} maxLength={60} onChange={e => change(doc.fields.map((x, i) => i === index ? { ...x, label: e.target.value } : x))} /></label>
          <label>填写方式 {index + 1}<select aria-label={`填写方式 ${index + 1}`} value={field.type} onChange={e => change(doc.fields.map((x, i) => i === index ? { ...x, type: e.target.value, options: e.target.value === "select" ? ["选项一", "选项二"] : [] } : x))}>
            <option value="text">单行文字</option><option value="textarea">多行文字</option><option value="select">下拉选择</option><option value="number">数字</option><option value="date">日期</option></select></label></div>
          {field.type === "select" && <label>可选内容（一行一个，最多 20 项）<textarea value={(field.options || []).join("\n")} maxLength={1620} rows={4} onChange={e => change(doc.fields.map((x, i) => i === index ? { ...x, options: e.target.value.split("\n") } : x))} /></label>}
          <label className="checkbox-label"><input type="checkbox" checked={field.required} onChange={e => change(doc.fields.map((x, i) => i === index ? { ...x, required: e.target.checked } : x))} />此项必填</label>
          <div className="row-actions"><button type="button" className="secondary" disabled={index === 0} onClick={() => { const fields = [...doc.fields]; [fields[index - 1], fields[index]] = [fields[index], fields[index - 1]]; change(fields); }}>上移字段</button>
            <button type="button" className="secondary danger" onClick={() => change(doc.fields.filter((_, i) => i !== index))}>删除字段 {index + 1}</button></div>
        </section>)}
        <div className="row-actions"><button type="button" className="secondary" disabled={doc.fields.length >= 20} onClick={() => change([...doc.fields, {
          key: "field-" + crypto.randomUUID().replaceAll("-", "").slice(0, 26), label: "新增字段", type: "text", required: false, options: [] }])}>添加表单字段</button>
          <button>{busy ? "正在保存…" : "保存表单"}</button></div>
      </fieldset></form>}
  </>;
}
