import type { Envelope } from "./types";

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public code: string,
    public traceId?: string,
    public retryAfterSeconds?: number,
  ) {
    super(message + (traceId ? `（追踪编号：${traceId}）` : ""));
  }
}
let csrf: string | null = null;
let csrfRequest: Promise<string> | null = null;
export function resetCsrf() {
  csrf = null;
}
export async function api<T>(
  path: string,
  method = "GET",
  body?: unknown,
  keepalive = false,
): Promise<T> {
  const headers: Record<string, string> = {};
  if (method !== "GET") {
    if (!csrf) {
      csrfRequest ??= (async () => {
      const response = await fetch("/api/v1/auth/csrf", {
        cache: "no-store",
        credentials: "same-origin",
      });
      if (!response.ok)
        throw new ApiError(
          "无法建立页面验证，请刷新重试。",
          response.status,
          "CSRF_INVALID",
        );
      return ((await response.json()) as Envelope<{ token: string }>).data.token;
      })();
      try { csrf = await csrfRequest; } finally { csrfRequest = null; }
    }
    headers["X-CSRF-TOKEN"] = csrf;
  }
  const form = body instanceof FormData;
  if (body !== undefined && !form) headers["Content-Type"] = "application/json";
  const response = await fetch("/api/v1/" + path, {
    method,
    headers,
    body: body === undefined ? undefined : form ? body : JSON.stringify(body),
    cache: "no-store",
    credentials: "same-origin",
    keepalive,
  });
  const result = await response.json().catch(() => ({
    message: "服务暂时不可用，请稍后重试。",
    code: "NETWORK_ERROR",
  }));
  if (!response.ok) {
    if (result.code === "CSRF_INVALID") csrf = null;
    throw new ApiError(
      result.message || "请求失败",
      response.status,
      result.code,
      result.traceId,
      Number(response.headers.get("Retry-After")) || undefined,
    );
  }
  return (result as Envelope<T>).data;
}
