"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError } from "@/lib/client";
import type { Page } from "@/lib/types";

export function useLoad<T>(path: string) {
  const [data, setData] = useState<T>();
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const sequence = useRef(0);
  const reload = useCallback(async () => {
    const request = ++sequence.current;
    setLoading(true);
    setData(undefined);
    setError("");
    try {
      const result = await api<T>(path);
      if (request === sequence.current) setData(result);
    } catch (e) {
      if (request !== sequence.current) return;
      setError((e as Error).message);
      if (e instanceof ApiError && e.status === 401)
        window.location.assign("/admin/login");
    } finally {
      if (request === sequence.current) setLoading(false);
    }
  }, [path]);
  useEffect(() => {
    void reload();
    return () => {
      sequence.current++;
    };
  }, [reload]);
  return { data, setData, error, setError, loading, reload };
}
export function Notice({
  error,
  success,
}: {
  error?: string;
  success?: string;
}) {
  return (
    <>
      {error && (
        <div className="alert" role="alert">
          {error}
        </div>
      )}
      {!error && success && (
        <div className="success" role="status">
          {success}
        </div>
      )}
    </>
  );
}
export function LoadState({
  loading,
  error,
  retry,
}: {
  loading: boolean;
  error?: string;
  retry: () => void;
}) {
  return (
    <>
      {loading && <Loading />}
      {!loading && error && (
        <button className="secondary" type="button" onClick={retry}>
          重新加载
        </button>
      )}
    </>
  );
}
export function Pager({
  data,
  setPage,
}: {
  data?: Page<unknown>;
  setPage: (n: number) => void;
}) {
  return data ? (
    <div className="pager">
      <span>
        共 {data.total} 条 · 第 {data.page} 页
      </span>
      <button
        className="secondary"
        disabled={data.page <= 1}
        onClick={() => setPage(data.page - 1)}
      >
        上一页
      </button>
      <button
        className="secondary"
        disabled={data.page * data.pageSize >= data.total}
        onClick={() => setPage(data.page + 1)}
      >
        下一页
      </button>
    </div>
  ) : null;
}
export function Heading({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="admin-heading">
      <div>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {children}
    </div>
  );
}
export function Loading() {
  return (
    <div className="loading" role="status">
      正在加载…
    </div>
  );
}
