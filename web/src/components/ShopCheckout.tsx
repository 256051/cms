"use client";
import { useEffect, useRef, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { api } from "@/lib/client";
import { channelNames, orderStates, money, type ShopOrder } from "@/lib/commerce";

type Offer = { price: number; currency: string; version: number; fileName: string; channels: { id: string; testMode: boolean }[] };
const receiptKey = (id: string) => "cms.order." + id;
const token = () => Array.from(crypto.getRandomValues(new Uint8Array(32)), b => b.toString(16).padStart(2, "0")).join("");
function downloadText(name: string, value: string) {
  const url = URL.createObjectURL(new Blob([value], { type: "text/plain;charset=utf-8" }));
  const link = document.createElement("a"); link.href = url; link.download = name; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function ShopCheckout({ productId }: { productId: string }) {
  const [offer, setOffer] = useState<Offer | null>(), [channel, setChannel] = useState(""), [email, setEmail] = useState(""), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const attempt = useRef<{ key: string; token: string } | null>(null);
  useEffect(() => { let active = true; void api<Offer | null>("shop/products/" + productId).then(data => { if (active) { setOffer(data); setChannel(data?.channels[0]?.id || ""); } }).catch(() => { if (active) setError("购买信息暂时无法加载，请刷新后重试。"); }); return () => { active = false; }; }, [productId]);
  if (offer === null) return null;
  return <section className="shop-checkout" aria-label="购买数字商品"><h2>购买与下载</h2>
    {error && <p className="alert" role="alert">{error}</p>}
    {offer && <><p className="shop-price">{money(offer.price, offer.currency)}</p><p>付款后下载：{offer.fileName}</p>
      {offer.channels.length ? <form onSubmit={async e => {
        e.preventDefault(); if (busy) return; setBusy(true); setError("");
        try {
          const key = productId + ":" + channel + ":" + email;
          if (attempt.current?.key !== key) {
            const previous = localStorage.getItem("cms.checkout." + productId);
            let saved;
            try { saved = previous ? JSON.parse(previous) : null; } catch { /* A corrupt local draft can safely be replaced. */ }
            attempt.current = saved?.key === key && /^[a-f0-9]{64}$/.test(saved.token) ? saved : { key, token: token() };
          }
          const receipt = attempt.current!;
          localStorage.setItem("cms.checkout." + productId, JSON.stringify(receipt));
          const order = await api<ShopOrder>("shop/orders", "POST", { productId, channel, email, receiptToken: receipt.token, productVersion: offer.version });
          localStorage.setItem(receiptKey(order.id), receipt.token);
          localStorage.removeItem("cms.checkout." + productId);
          window.location.assign("/orders/" + order.id);
        } catch (e) { setError((e as Error).message); setBusy(false); }
      }}><fieldset disabled={busy} className="form-fields">
        <label>联系邮箱<input type="email" required maxLength={254} autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} /></label>
        <fieldset><legend>支付方式</legend>{offer.channels.map(c => <label className="checkbox-label" key={c.id}><input type="radio" name="payment-channel" value={c.id} checked={channel === c.id} onChange={() => setChannel(c.id)} />{channelNames[c.id]}{c.testMode && "（测试，不开放下载）"}</label>)}</fieldset>
        <p className="muted">单次购买一份数字商品。订单凭证会保存在当前浏览器，请在订单页另存一份，便于换设备查询。</p>
        <button disabled={busy || !channel}>{busy ? "正在创建订单…" : "立即购买"}</button>
      </fieldset></form> : <p>暂未开放在线收款，请联系商家咨询。</p>}</>}
  </section>;
}

export function BuyerOrder({ id }: { id: string }) {
  const [receipt, setReceipt] = useState(""), [order, setOrder] = useState<ShopOrder>(), [busy, setBusy] = useState(false), [error, setError] = useState(""), [qr, setQr] = useState("");
  async function request<T>(suffix = "", method = "GET", binary = false, credential = receipt) {
    return api<T>(`shop/orders/${id}${suffix}`, method, undefined, false, binary, { "X-Order-Token": credential });
  }
  useEffect(() => {
    let active = true;
    try { const saved = localStorage.getItem(receiptKey(id)) || ""; setReceipt(saved); if (saved) void api<ShopOrder>(`shop/orders/${id}`, "GET", undefined, false, false, { "X-Order-Token": saved }).then(value => { if (active) setOrder(value); }).catch(e => { if (active) setError(e.message); }); }
    catch { if (active) setError("无法读取浏览器中的订单凭证，请手动输入。"); }
    return () => { active = false; };
  }, [id]);
  useEffect(() => {
    if (order?.status !== "pending") return;
    let active = true;
    const timer = setInterval(() => { if (document.visibilityState === "visible") void api<ShopOrder>(`shop/orders/${id}`, "GET", undefined, false, false, { "X-Order-Token": receipt }).then(value => { if (active) setOrder(value); }).catch(() => { /* Explicit refresh reports network failures; polling never grants delivery. */ }); }, 5000);
    return () => { active = false; clearInterval(timer); };
  }, [id, receipt, order?.status]);
  async function action(type: "pay" | "refresh" | "close" | "download") {
    if (busy) return; setBusy(true); setError("");
    try {
      if (type === "pay") {
        const link = await request<{ url: string }>("/pay", "POST");
        if (order?.channel === "wechat") setQr(link.url); else window.location.assign(link.url);
      } else if (type === "download") {
        const blob = await request<Blob>("/download", "GET", true); const url = URL.createObjectURL(blob);
        const link = document.createElement("a"); link.href = url; link.download = order!.fileName; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
      } else setOrder(await request<ShopOrder>("/" + type, "POST"));
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  return <section className="shop-checkout"><h1>订单与下载</h1><p className="shop-order-id">订单号：{id}</p>{error && <p className="alert" role="alert">{error}</p>}
    {!order ? <form onSubmit={async e => { e.preventDefault(); setBusy(true); setError(""); try { const result = await request<ShopOrder>(); localStorage.setItem(receiptKey(id), receipt); setOrder(result); } catch (e) { setError((e as Error).message); } finally { setBusy(false); } }}>
      <label>订单凭证<input type="password" required minLength={64} maxLength={64} autoComplete="off" value={receipt} onChange={e => setReceipt(e.target.value.trim())} /></label><button disabled={busy}>{busy ? "正在查询…" : "查询订单"}</button>
    </form> : <><h2>{order.title}</h2><p className="shop-price">{money(order.amount, order.currency)}</p><p role="status">{orderStates[order.status]} · {channelNames[order.channel]}{order.testMode && " · 测试订单"}</p>
      <p>交付文件：{order.fileName}</p><p>联系邮箱：{order.email}</p>
      <button className="secondary" onClick={() => downloadText(`订单-${id}.txt`, `订单地址：${window.location.origin}/orders/${id}\n订单凭证：${receipt}\n请妥善保管，不要公开分享。`)}>保存订单凭证</button>
      {order.status === "pending" && <><p>付款后会自动更新；也可主动查询支付结果。付款有效期至 {new Date(order.expiresAt).toLocaleString("zh-CN")}。</p>
        {qr && <div className="shop-qr"><QRCodeSVG value={qr} size={240} title="微信付款二维码" /><p>使用微信扫一扫付款</p></div>}
        <div className="row-actions"><button disabled={busy} onClick={() => void action("pay")}>{busy ? "处理中…" : "前往付款"}</button><button className="secondary" disabled={busy} onClick={() => void action("refresh")}>查询支付结果</button><button className="secondary" disabled={busy} onClick={() => void action("close")}>关闭订单</button></div></>}
      {order.canDownload && <button disabled={busy} onClick={() => void action("download")}>{busy ? "正在准备下载…" : "下载商品文件"}</button>}
      {order.testMode && <p>测试订单用于核对支付流程，不开放正式文件下载。</p>}
      {order.status === "refunded" && <p>订单已退款，下载权限已关闭。</p>}
    </>}
  </section>;
}
