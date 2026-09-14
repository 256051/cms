import AdminApp from "@/components/admin/AdminApp";
export const metadata = {
  title: "内容管理",
  robots: { index: false, follow: false },
};
export default async function Admin({
  params,
}: {
  params: Promise<{ section?: string[] }>;
}) {
  return <div lang="zh-CN"><AdminApp route={(await params).section || []} /></div>;
}
