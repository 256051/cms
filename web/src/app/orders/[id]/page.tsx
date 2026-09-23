import SiteShell from "@/components/SiteShell";
import { BuyerOrder } from "@/components/ShopCheckout";
import { notFound } from "next/navigation";

export const metadata = { title: "订单与下载", robots: { index: false, follow: false } };
export default async function OrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[a-f0-9]{32}$/.test(id)) notFound();
  return <SiteShell><BuyerOrder id={id} /></SiteShell>;
}
