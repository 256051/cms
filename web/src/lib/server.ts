import "server-only";
import type { Envelope } from "./types";

export class PublicApiError extends Error {
  constructor(public status: number) {
    super("内容服务暂时不可用");
  }
}
export async function publicApi<T>(path: string): Promise<T> {
  const base = process.env.API_INTERNAL_URL || "http://127.0.0.1:5080";
  const response = await fetch(`${base}/api/v1/public/${path}`, {
    cache: "no-store",
  });
  if (!response.ok) throw new PublicApiError(response.status);
  return ((await response.json()) as Envelope<T>).data;
}
export const siteUrl = () =>
  (process.env.SITE_URL || "http://localhost:3000").replace(/\/$/, "");
