import type { Content } from "@/lib/types";

export default function BusinessDetails({ fields }: { fields: Content["fields"] }) {
  const populated = (fields || []).filter(x => x.value);
  return populated.length ? <section className="business-details" aria-label="详细信息"><dl>{populated.map(field =>
    <div key={field.key}><dt>{field.label}</dt><dd>{field.value}</dd></div>)}</dl></section> : null;
}
