"use client";
import { useState } from "react";
import type { Asset, Page } from "@/lib/types";
import { Notice, useLoad, LoadState } from "./shared";

export default function AssetSelector({
  value,
  onChange,
  label,
}: {
  value: string;
  onChange: (id: string) => void;
  label: string;
}) {
  const [page, setPage] = useState(1);
  const { data, error, loading, reload } = useLoad<Page<Asset>>(
    `admin/assets?page=${page}`,
  );
  const images =
    data?.items.filter((a) => a.contentType.startsWith("image/")) || [];
  return (
    <div>
      <label>
        {label}
        <select
          aria-label={label}
          disabled={loading || !!error}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        >
          <option value="">不使用图片</option>
          {value && !images.some((a) => a.id === value) && (
            <option value={value}>当前已选图片</option>
          )}
          {images.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
      </label>
      <Notice error={error} />
      <LoadState loading={loading} error={error} retry={reload} />
      {!loading && !error && data?.total === 0 && (
        <small className="muted">附件库还没有图片，可先上传。</small>
      )}
      {data && data.total > data.pageSize && (
        <div className="row-actions">
          <button
            type="button"
            className="secondary"
            disabled={page <= 1}
            onClick={() => setPage(page - 1)}
          >
            上一批附件
          </button>
          <button
            type="button"
            className="secondary"
            disabled={page * data.pageSize >= data.total}
            onClick={() => setPage(page + 1)}
          >
            下一批附件
          </button>
        </div>
      )}
    </div>
  );
}
