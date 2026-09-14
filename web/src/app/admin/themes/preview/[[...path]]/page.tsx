import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { HomePage, DetailPage, SearchPage } from "@/components/PublicPages";
import type { Envelope, ThemeView } from "@/lib/types";

export const metadata = { title: "主题预览", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default async function ThemePreview({ params, searchParams }: {
  params: Promise<{ path?: string[] }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const values = await searchParams;
  const query = new URLSearchParams();
  for (const key of ["themeId", "accentColor", "heroTitle", "heroDescription"]) {
    if (Array.isArray(values[key])) notFound();
    if (typeof values[key] === "string") query.set(key, values[key]);
  }
  const response = await fetch(`${process.env.API_INTERNAL_URL || "http://127.0.0.1:5080"}/api/v1/admin/themes/preview?${query}`, {
    headers: { Cookie: (await cookies()).toString() }, cache: "no-store",
  });
  if (response.status === 401) redirect("/admin/login");
  if (response.status === 403) redirect("/admin");
  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: "预览服务暂时不可用，请返回重试。" }));
    return <main className="error-page"><h1>无法预览主题</h1><p role="alert">{error.message}</p><a className="button" href="/admin/themes">返回主题管理</a></main>;
  }
  const context = { theme: ((await response.json()) as Envelope<ThemeView>).data, preview: query.toString() };
  const path = (await params).path || [];
  const paging = Promise.resolve({ page: typeof values.page === "string" ? values.page : undefined, q: typeof values.q === "string" ? values.q : undefined });
  if (path.length === 0) return <HomePage context={context} searchParams={paging} />;
  if (path.length === 1 && path[0] === "search") return <SearchPage context={context} searchParams={paging} />;
  if (path.length === 2 && ["posts", "pages", "category", "tag"].includes(path[0]))
    return <DetailPage context={context} params={Promise.resolve({ archive: path[0], slug: path[1] })} searchParams={paging} />;
  notFound();
}
