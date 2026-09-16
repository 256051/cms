"use client";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { usePathname, useSearchParams } from "next/navigation";
import { api } from "@/lib/client";
import type { components } from "@/lib/api.generated";

const id = () => crypto.randomUUID().replaceAll("-", "");
type Navigation = { key: string; id: string; accepted?: string; pending?: Promise<string> };

export function ArticleViewCount({ initial }: { initial: number }) {
  const [views, setViews] = useState(initial);
  useEffect(() => {
    setViews(initial);
    const update = (event: Event) => setViews((event as CustomEvent<number>).detail);
    window.addEventListener("cms:article-views", update);
    return () => window.removeEventListener("cms:article-views", update);
  }, [initial]);
  return <span>{views} 次阅读</span>;
}

/** One tracker per public shell; SSR, prefetched pages and previews never execute a view write. */
export default function PublicTraffic({ preview = false }: { preview?: boolean }) {
  const path = usePathname();
  const params = useSearchParams();
  const key = path + "?" + params.toString();
  const navigation = useRef<Navigation | null>(null);
  if (!navigation.current || navigation.current.key !== key) navigation.current = { key, id: "" };
  const current = navigation.current;
  const [open, setOpen] = useState(false), [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(""), [error, setError] = useState("");
  const [inquiry, setInquiry] = useState<components["schemas"]["InquiryFormView"]>(), [formError, setFormError] = useState("");
  async function loadForm() {
    try { setInquiry(await api("public/inquiry-form")); setFormError(""); }
    catch { setFormError("咨询表单加载失败，请重试。"); }
  }
  useEffect(() => { if (!preview) void loadForm(); }, [preview]);
  const leadId = useRef(""), submitted = useRef("");
  const firstField = useRef<HTMLInputElement>(null);
  const [slot, setSlot] = useState<Element | null>(null);
  useEffect(() => { setSlot(preview ? null : document.querySelector("[data-inquiry-slot]")); }, [key, preview]);
  const metadata = () => ({ path, referrer: document.referrer.slice(0, 2048),
    campaign: [new URLSearchParams(location.search).get("utm_source"), new URLSearchParams(location.search).get("utm_campaign")].filter(Boolean).join(" / ").slice(0, 100) });
  function ensureVisit() {
    if (preview || document.visibilityState !== "visible" || navigator.doNotTrack === "1") return Promise.resolve("");
    if (current.accepted !== undefined) return Promise.resolve(current.accepted);
    current.id ||= id();
    current.pending ??= api<{ id: string; views: number }>("public/visits", "POST", { id: current.id, ...metadata() })
      .then(receipt => {
        current.accepted = receipt.id;
        if (receipt.id && navigation.current === current) window.dispatchEvent(new CustomEvent("cms:article-views", { detail: receipt.views }));
        return receipt.id;
      })
      .finally(() => { current.pending = undefined; });
    return current.pending;
  }
  async function action(kind: "download" | "consultation", targetId = "") {
    try {
      const visitId = await ensureVisit();
      if (visitId) await api(`public/visits/${visitId}/events`, "POST", { id: id(), kind, targetId }, true);
    } catch { /* Reading and navigation remain available when telemetry is blocked. */ }
  }
  useEffect(() => {
    if (preview) return;
    let disposed = false, seconds = 0, depth = 0, last = performance.now(), visible = document.visibilityState === "visible";
    let frame = 0;
    const sample = () => {
      const now = performance.now();
      if (visible) seconds = Math.min(14400, seconds + (now - last) / 1000);
      last = now;
      visible = document.visibilityState === "visible";
      const article = document.getElementById("article-body");
      if (article && visible) {
        const rect = article.getBoundingClientRect();
        depth = Math.max(depth, Math.min(100, Math.max(0, Math.round((innerHeight - rect.top) / Math.max(1, rect.height) * 100))));
      }
    };
    const flush = () => {
      sample();
      if (current.accepted) void api(`public/visits/${current.accepted}/reading`, "POST",
        { activeSeconds: Math.floor(seconds), depth }, true).catch(() => {});
      else if (visible && !disposed) void ensureVisit().catch(() => {});
    };
    const scroll = () => { if (!frame) frame = requestAnimationFrame(() => { frame = 0; sample(); }); };
    const click = (event: MouseEvent) => {
      const link = event.target instanceof Element ? event.target.closest("a[href]") : null;
      if (!link) return;
      const url = new URL(link.getAttribute("href")!, location.href);
      const match = url.origin === location.origin && /^\/media\/([a-f0-9]{32})$/.exec(url.pathname);
      if (match) void action("download", match[1]);
    };
    sample();
    void ensureVisit().then(() => { if (!disposed) flush(); }).catch(() => {});
    const timer = window.setInterval(flush, 15000);
    document.addEventListener("visibilitychange", flush);
    window.addEventListener("pagehide", flush);
    window.addEventListener("scroll", scroll, { passive: true });
    window.addEventListener("resize", scroll);
    document.addEventListener("click", click);
    return () => {
      disposed = true; flush(); clearInterval(timer); cancelAnimationFrame(frame);
      document.removeEventListener("visibilitychange", flush); window.removeEventListener("pagehide", flush);
      window.removeEventListener("scroll", scroll); window.removeEventListener("resize", scroll);
      document.removeEventListener("click", click);
    };
  // The navigation object persists through Strict Mode effect replay and changes for actual route navigation.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current, preview]);
  useEffect(() => { if (open) firstField.current?.focus(); }, [open]);
  if (preview) return null;
  const form = <section className="inquiry-section" aria-labelledby="inquiry-heading">
    <div className="inquiry-intro"><div><h2 id="inquiry-heading">想进一步了解？</h2><p>留下需求和联系方式，我们会就本次咨询与你联系。</p></div>
      <button type="button" className="button" aria-expanded={open} aria-controls="inquiry-form" onClick={() => {
        if (!open) void action("consultation"); setOpen(!open);
      }}>{open ? "收起咨询" : "咨询 / 预约演示"}</button></div>
    {open && <form id="inquiry-form" className="inquiry-form" onSubmit={async event => {
      event.preventDefault(); if (busy) return;
      setBusy(true); setError(""); setMessage("");
      const form = event.currentTarget, fields = new FormData(form);
      const values = { name: String(fields.get("name") || ""), contact: String(fields.get("contact") || ""),
        organization: String(fields.get("organization") || ""), need: String(fields.get("need") || ""),
        consent: fields.get("consent") === "on", website: String(fields.get("website") || ""),
        fields: Object.fromEntries((inquiry?.fields || []).map(field => [field.key, String(fields.get("custom-" + field.key) || "")])) };
      const signature = JSON.stringify(values);
      if (!leadId.current || submitted.current !== signature) { leadId.current = id(); submitted.current = signature; }
      try {
        const visitId = await ensureVisit().catch(() => "");
        await api("public/leads", "POST", { ...values, ...metadata(), id: leadId.current, visitId });
        form.reset(); leadId.current = ""; submitted.current = "";
        setMessage("咨询已提交，我们会通过你留下的联系方式回复。");
      } catch (e) { setError((e as Error).message); }
      finally { setBusy(false); }
    }}>
      <fieldset disabled={busy || !inquiry || !!formError} className="form-fields">
        <div className="inquiry-fields">
          <label>称呼<input ref={firstField} name="name" required maxLength={60} autoComplete="name" /></label>
          <label>联系方式<input name="contact" required maxLength={160} placeholder="手机号、邮箱或微信号" /></label>
          <label className="inquiry-wide">公司或学校（选填）<input name="organization" maxLength={200} autoComplete="organization" /></label>
          <label className="inquiry-wide">需求描述<textarea name="need" required maxLength={2000} rows={4} /></label>
          {(inquiry?.fields || []).map(field => <label key={field.key} className={field.type === "textarea" ? "inquiry-wide" : undefined}>{field.label}{!field.required && "（选填）"}
            {field.type === "select" ? <select aria-label={field.label + (field.required ? "" : "（选填）")} name={"custom-" + field.key} required={field.required}><option value="">请选择</option>{field.options?.map(option => <option key={option}>{option}</option>)}</select>
              : field.type === "textarea" ? <textarea name={"custom-" + field.key} required={field.required} maxLength={2000} rows={3} />
              : <input name={"custom-" + field.key} type={field.type} required={field.required} maxLength={2000}
                step={field.type === "number" ? "any" : undefined} min={field.type === "number" ? -1000000000 : undefined} max={field.type === "number" ? 1000000000 : undefined} />}
          </label>)}
        </div>
        <label className="inquiry-trap" aria-hidden="true">网站<input name="website" tabIndex={-1} autoComplete="off" /></label>
        <label className="inquiry-consent"><input name="consent" type="checkbox" required />我同意将以上信息用于本次咨询及后续联系，信息不会公开展示。</label>
        <button type="submit">{busy ? "正在提交…" : "提交咨询"}</button>
      </fieldset>
      {error && <p role="alert" className="alert">{error}</p>}
      {(formError || error) && <div><p role="alert">{formError}</p><button type="button" className="secondary" disabled={busy} onClick={() => void loadForm()}>更新表单字段</button></div>}
      {message && <p role="status" className="success">{message}</p>}
    </form>}
    <small className="traffic-notice">本站使用有效期 180 天的随机浏览器标识统计访问与阅读情况，并记录访问 IP 及其大致所属地区，仅管理员可见；浏览器启用“请勿跟踪”时停止访问采集。</small>
  </section>;
  return slot ? createPortal(form, slot) : form;
}
