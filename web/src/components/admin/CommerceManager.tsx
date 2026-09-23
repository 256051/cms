"use client";
import { useEffect, useState } from "react";
import { api } from "@/lib/client";
import type { Content, Page } from "@/lib/types";
import { channelNames, orderStates, money, type CommerceSettings, type PaymentChannel, type SaleProduct, type ShopOrder } from "@/lib/commerce";
import { Heading, Notice, LoadState, Pager, useLoad } from "./shared";
import { useUnsavedChanges } from "./unsaved";
import EditorDialog from "./EditorDialog";

const fields: Record<string, [keyof PaymentChannel, string, boolean?][]> = {
  alipay: [["appId", "应用 App ID"], ["merchantId", "卖家 Seller ID"], ["privateKey", "应用私钥（PEM）", true], ["publicKey", "支付宝公钥（PEM）"]],
  wechat: [["appId", "应用 App ID"], ["merchantId", "商户号"], ["serialNo", "商户证书序列号"], ["publicKeyId", "微信支付公钥 ID"], ["privateKey", "商户私钥（PEM）", true], ["publicKey", "微信支付公钥（PEM）"], ["apiV3Key", "APIv3 密钥", true]],
  stripe: [["merchantId", "Stripe 账户 ID（acct_ 开头）"], ["secretKey", "Secret Key", true], ["webhookSecret", "Webhook 签名密钥", true]],
};
export function PaymentSettings() {
  const load = useLoad<CommerceSettings>("admin/commerce/settings");
  const [draft, setDraft] = useState<CommerceSettings>(), [busy, setBusy] = useState(false), [error, setError] = useState(""), [success, setSuccess] = useState("");
  const changes = useUnsavedChanges();
  useEffect(() => { if (load.data) setDraft(load.data); }, [load.data]);
  function change(id: string, key: keyof PaymentChannel, value: string | boolean) {
    setDraft(d => d && ({ ...d, channels: d.channels.map(x => x.id === id ? { ...x, values: { ...x.values, [key]: value } } : x) })); changes.markChanged();
  }
  return <><Heading title="支付设置" description="按需启用支付宝、微信支付和 Stripe。完成商户配置及实付联调后再开放收款。" />
    <Notice error={load.error} /><LoadState loading={load.loading} error={load.error} retry={load.reload} />
    {draft && <form onChange={changes.markChanged} onSubmit={async e => {
      e.preventDefault(); setBusy(true); setError(""); setSuccess("");
      try {
        const saved = await api<CommerceSettings>("admin/commerce/settings", "PUT", { siteUrl: draft.siteUrl, version: draft.version, channels: Object.fromEntries(draft.channels.map(c => [c.id, c.values])) });
        setDraft(saved); changes.markSaved(); setSuccess("支付设置已保存。正式收款前请完成商户联调。");
      } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
    }}><fieldset className="form-fields" disabled={busy}>
      <section className="panel"><label>网站 HTTPS 地址<input type="url" value={draft.siteUrl} disabled={draft.siteUrlManaged} placeholder="https://shop.example.com" onChange={e => setDraft({ ...draft, siteUrl: e.target.value })} /></label>
        <small>填写网站根地址，用于支付完成返回和支付通知。</small>{draft.siteUrlManaged && <p>网站地址由部署配置管理。</p>}</section>
      {draft.channels.map(c => <section className="panel" key={c.id}>
        <h2>{channelNames[c.id]} <span className="badge">{c.values.enabled ? c.configured ? "已配置，待实付验证" : "配置不完整" : "未启用"}</span></h2>
        {c.deploymentManaged && <p>此渠道由部署配置管理，后台修改不会覆盖部署配置。</p>}
        <fieldset className="form-fields" disabled={c.deploymentManaged}>
          <label className="checkbox-label"><input type="checkbox" checked={c.values.enabled} onChange={e => change(c.id, "enabled", e.target.checked)} />启用{channelNames[c.id]}</label>
          {c.id !== "wechat" && <label className="checkbox-label"><input type="checkbox" checked={c.values.testMode} onChange={e => change(c.id, "testMode", e.target.checked)} />测试环境（不开放正式文件下载）</label>}
          {fields[c.id].map(([key, label, secret]) => <label key={key}>{label}
            {key === "privateKey" || key === "publicKey" ? <textarea rows={4} autoComplete="off" spellCheck={false} value={String(c.values[key])} placeholder={secret && c.savedSecrets.includes(key[0].toUpperCase() + key.slice(1)) ? "已保存，留空保留原值" : "粘贴完整 PEM 内容"} onChange={e => change(c.id, key, e.target.value)} />
              : <input type={secret ? "password" : "text"} autoComplete="off" value={String(c.values[key])} placeholder={secret && c.savedSecrets.includes(key[0].toUpperCase() + key.slice(1)) ? "已保存，留空保留原值" : ""} onChange={e => change(c.id, key, e.target.value)} />}
          </label>)}
        </fieldset>
        {c.values.enabled && c.error && <p className="muted">{c.error}</p>}
        <label>支付通知地址<input readOnly value={c.notifyUrl} /></label>
        {c.id === "stripe" && <small>Webhook 事件：checkout.session.completed、checkout.session.async_payment_succeeded。</small>}
      </section>)}
      <Notice error={error} success={success} />
      <button disabled={busy}>{busy ? "正在保存…" : "保存支付设置"}</button>
    </fieldset></form>}</>;
}

export function CommerceProducts({ id }: { id?: string }) {
  const [page, setPage] = useState(1);
  const products = useLoad<Page<Content>>(`admin/contents?kind=product&page=${page}&pageSize=20`);
  if (id) return <SaleEditor key={id} id={id} />;
  return <><Heading title="商品销售" description="为已有产品设置售价、上架状态和付费交付文件。" /><Notice error={products.error} /><LoadState loading={products.loading} error={products.error} retry={products.reload} />
    <section className="panel"><p><a href="/admin/products/new">新建产品</a></p><div className="table-scroll"><table><thead><tr><th>产品</th><th>内容状态</th><th>操作</th></tr></thead><tbody>{products.data?.items.map(p => <tr key={p.id}>
      <td>{p.title}</td><td>{p.published ? "已发布" : "草稿"}</td><td><a href={`/admin/commerce-products/${p.id}`}>设置销售</a> · <a href={`/admin/products/${p.id}`}>编辑内容</a></td>
    </tr>)}</tbody></table></div>{products.data?.total === 0 && <p>先新建一个产品，再配置销售。</p>}<Pager data={products.data} setPage={setPage} /></section></>;
}
function SaleEditor({ id }: { id: string }) {
  const load = useLoad<SaleProduct>("admin/commerce/products/" + id);
  const [draft, setDraft] = useState<SaleProduct>(), [price, setPrice] = useState(""), [busy, setBusy] = useState(false), [error, setError] = useState(""), [success, setSuccess] = useState("");
  const changes = useUnsavedChanges();
  useEffect(() => { if (load.data) { setDraft(load.data); setPrice(load.data.price ? (load.data.price / 100).toFixed(2) : ""); } }, [load.data]);
  return <><Heading title="设置商品销售" description="上架还需产品内容已发布。更换价格或文件不会改变已有订单。" /><p><a href="/admin/commerce-products">返回商品销售</a> · <a href={`/admin/products/${id}`}>编辑产品内容</a></p>
    <Notice error={error || load.error} success={success} />{draft && <form className="panel" onChange={changes.markChanged} onSubmit={async e => {
      e.preventDefault(); setBusy(true); setError(""); setSuccess("");
      try {
        if (!/^\d+(\.\d{1,2})?$/.test(price)) throw new Error("价格最多保留两位小数。");
        const saved = await api<SaleProduct>("admin/commerce/products/" + id, "PUT", { ...draft, price: Math.round(Number(price) * 100) });
        setDraft(saved); changes.markSaved(); setSuccess("商品销售设置已保存。");
      } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
    }}><fieldset className="form-fields" disabled={busy}>
      <label>售价<input type="number" min="0.01" max="1000000" step="0.01" required value={price} onChange={e => setPrice(e.target.value)} /></label>
      <label>币种<select value={draft.currency} onChange={e => setDraft({ ...draft, currency: e.target.value })}>{[["CNY", "人民币"], ["USD", "美元"], ["EUR", "欧元"], ["HKD", "港币"], ["GBP", "英镑"]].map(([v, n]) => <option key={v} value={v}>{n}</option>)}</select><small>非人民币商品仅提供 Stripe 付款。</small></label>
      <label>付费交付文件<input type="file" onChange={async e => {
        const file = e.target.files?.[0]; e.target.value = ""; if (!file) return;
        if (file.size > 50 * 1024 * 1024) { setError("文件不能超过 50 MB。"); return; }
        setBusy(true); setError(""); setSuccess("");
        try { const form = new FormData(); form.append("file", file); const uploaded = await api<{ id: string; name: string; size: number }>("admin/commerce/files", "POST", form);
          setDraft({ ...draft, fileId: uploaded.id, fileName: uploaded.name, fileSize: uploaded.size }); changes.markChanged();
        } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
      }} /><small>软件安装包、资料或授权文件，单文件最多 50 MB。文件不会出现在公开附件库。</small></label>
      {draft.fileName && <p>当前交付：{draft.fileName}（{(draft.fileSize / 1024).toFixed(1)} KB）</p>}
      <label className="checkbox-label"><input type="checkbox" checked={draft.enabled} onChange={e => setDraft({ ...draft, enabled: e.target.checked })} />上架销售</label>
      <button disabled={busy}>{busy ? "正在处理…" : "保存销售设置"}</button>
    </fieldset></form>}</>;
}

export function CommerceOrders() {
  const [page, setPage] = useState(1), [status, setStatus] = useState("");
  const rows = useLoad<Page<ShopOrder>>(`admin/commerce/orders?page=${page}&status=${status}`);
  const [selected, setSelected] = useState<ShopOrder>(), [busy, setBusy] = useState(false), [error, setError] = useState(""), [success, setSuccess] = useState("");
  async function action(type: "refresh" | "close") {
    setBusy(true); setError(""); setSuccess("");
    try { const order = await api<ShopOrder>(`admin/commerce/orders/${selected!.id}/${type}`, "POST"); setSelected(order); await rows.reload(); setSuccess("订单状态：" + orderStates[order.status]); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  return <><Heading title="交易订单" description="查看数字商品交易。付款和退款状态以支付平台核对结果为准。" /><Notice error={rows.error} />
    <label>订单状态<select value={status} onChange={e => { setPage(1); setStatus(e.target.value); }}><option value="">全部</option>{Object.entries(orderStates).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
    <section className="panel"><div className="table-scroll"><table><thead><tr><th>商品 / 订单</th><th>金额</th><th>买家邮箱</th><th>渠道</th><th>状态</th><th>操作</th></tr></thead><tbody>{rows.data?.items.map(row => <tr key={row.id}>
      <td>{row.title}<small className="traffic-path">{row.id}</small></td><td>{money(row.amount, row.currency)}</td><td>{row.email}</td><td>{channelNames[row.channel]}{row.testMode && "（测试）"}</td><td>{orderStates[row.status]}</td><td><button className="secondary" onClick={() => { setSelected(row); setError(""); setSuccess(""); }}>查看订单</button></td>
    </tr>)}</tbody></table></div>{rows.data?.total === 0 && <p>暂无订单。</p>}<Pager data={rows.data} setPage={setPage} /></section>
    {selected && <EditorDialog title="订单详情" close={() => { if (!busy) setSelected(undefined); }}><Notice error={error} success={success} />
      <p>{selected.title} · {money(selected.amount, selected.currency)} · {orderStates[selected.status]}</p><p className="traffic-path">订单号：{selected.id}</p>
      <p>交付文件：{selected.fileName}。{selected.testMode ? "测试订单不开放正式下载。" : "支付确认后买家凭订单凭证下载。"}</p>
      <p className="muted">退款先在支付平台商户后台处理，再核对状态。已确认退款的订单会停止下载。</p>
      <div className="row-actions"><button disabled={busy} onClick={() => void action("refresh")}>{busy ? "处理中…" : "核对支付 / 退款状态"}</button>
        {selected.status === "pending" && <button className="danger" disabled={busy} onClick={() => void action("close")}>关闭待付款订单</button>}</div>
    </EditorDialog>}</>;
}
