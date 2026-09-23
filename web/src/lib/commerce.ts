export type PaymentChannel = { enabled: boolean; testMode: boolean; appId: string; merchantId: string; privateKey: string; publicKey: string; serialNo: string; publicKeyId: string; apiV3Key: string; secretKey: string; webhookSecret: string };
export type ChannelSettings = { id: string; values: PaymentChannel; savedSecrets: string[]; configured: boolean; deploymentManaged: boolean; error: string; notifyUrl: string };
export type CommerceSettings = { siteUrl: string; version: number; siteUrlManaged: boolean; channels: ChannelSettings[] };
export type SaleProduct = { productId: string; enabled: boolean; price: number; currency: string; fileId: string; fileName: string; fileSize: number; version: number };
export type ShopOrder = { id: string; productId: string; title: string; amount: number; currency: string; channel: string; status: string; email: string; testMode: boolean; createdAt: string; paidAt: string | null; expiresAt: string; canDownload: boolean; fileName: string };
export const channelNames: Record<string, string> = { alipay: "支付宝", wechat: "微信支付", stripe: "Stripe" };
export const orderStates: Record<string, string> = { pending: "待付款", paid: "已付款", closed: "已关闭", refunded: "已退款" };
export const money = (amount: number, currency: string) => new Intl.NumberFormat("zh-CN", { style: "currency", currency }).format(amount / 100);
