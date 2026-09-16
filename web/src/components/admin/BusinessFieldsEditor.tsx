import type { Content } from "@/lib/types";

type Fields = NonNullable<Content["fields"]>;
export function defaultBusinessFields(kind: Content["kind"]): Fields {
  return (kind === "product" ? [["model", "产品型号"], ["parameters", "产品参数"], ["scenarios", "适用场景"]]
    : kind === "case" ? [["industry", "所属行业"], ["customer", "客户名称"], ["outcomes", "实施成果"]] : [])
    .map(([key, label]) => ({ key, label, value: "" }));
}

export default function BusinessFieldsEditor({ fields, onChange }: { fields: Fields; onChange: (value: Fields) => void }) {
  return <section className="business-fields-editor"><h2>业务字段</h2><p className="muted">填写产品参数或案例信息，可添加、删除或重命名字段；发布后有内容的字段会显示在页面中。</p>
    {fields.map((field, index) => <div className="form-grid" key={field.key}><label>字段名称 {index + 1}<input required value={field.label} maxLength={60}
      onChange={e => onChange(fields.map((x, i) => i === index ? { ...x, label: e.target.value } : x))} /></label>
      <label>{field.label || `字段内容 ${index + 1}`}<textarea value={field.value} maxLength={2000} rows={2}
        onChange={e => onChange(fields.map((x, i) => i === index ? { ...x, value: e.target.value } : x))} /></label>
      <button type="button" className="secondary danger" onClick={() => onChange(fields.filter((_, i) => i !== index))}>删除字段 {index + 1}</button></div>)}
    <button type="button" className="secondary" disabled={fields.length >= 20} onClick={() => onChange([...fields, {
      key: "field-" + crypto.randomUUID().replaceAll("-", "").slice(0, 26), label: "自定义字段", value: "" }])}>添加业务字段（{fields.length} / 20）</button>
  </section>;
}
