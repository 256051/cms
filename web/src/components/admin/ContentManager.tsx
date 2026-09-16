"use client";
import { useState } from "react";
import { FileText, Plus, Search, ArrowUpRight } from "lucide-react";
import { contentUrl, type Content, type Page } from "@/lib/types";
import { Heading, Notice, Pager, useLoad, LoadState } from "./shared";
export default function ContentManager({ kind }: { kind: "post" | "page" }) {
  const [page, setPage] = useState(1);
  const [q, setQ] = useState("");
  const [sort, setSort] = useState("recent");
  const { data, error, loading, reload } = useLoad<Page<Content>>(
    `admin/contents?kind=${kind}&page=${page}&q=${encodeURIComponent(q)}&sort=${sort}`,
  );
  const base = kind === "post" ? "posts" : "pages";
  return (
    <>
      <Heading
        title={kind === "post" ? "文章" : "独立页面"}
        description={
          kind === "post"
            ? "管理你的想法、故事和知识。"
            : "创建关于我们、介绍等长期展示的内容。"
        }
      >
        <a className="button" href={`/admin/${base}/new`}>
          <Plus size={17} />
          新建{kind === "post" ? "文章" : "页面"}
        </a>
      </Heading>
      <Notice error={error} />
      <LoadState loading={loading} error={error} retry={reload} />
      <section className="panel table-panel">
        <div className="table-toolbar">
          <strong>
            全部内容 <span className="count-badge">{data?.total ?? "—"}</span>
          </strong>
          <label>排序<select value={sort} onChange={event => { setSort(event.target.value); setPage(1); }}>
            <option value="recent">最近创建</option><option value="views">浏览量从高到低</option>
          </select></label>
          <form
            className="compact-search"
            onSubmit={(e) => {
              e.preventDefault();
              setQ(String(new FormData(e.currentTarget).get("q") || ""));
              setPage(1);
            }}
          >
            <Search size={17} />
            <input
              name="q"
              aria-label="搜索内容"
              placeholder="搜索标题或摘要"
              maxLength={200}
            />
            <button className="secondary">搜索</button>
          </form>
        </div>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>标题</th>
                <th>状态</th>
                <th>最近发布</th>
                <th>累计 / 今日浏览</th>
                <th>独立访客</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {data?.items.map((c) => (
                <tr key={c.id}>
                  <td>
                    <a
                      className="content-title"
                      href={`/admin/${base}/${c.id}`}
                    >
                      <span className="file-tile">
                        <FileText size={20} />
                      </span>
                      <span>
                        <strong>{c.title}</strong>
                        <small>/{c.slug}</small>
                      </span>
                    </a>
                  </td>
                  <td>
                    <span className={`badge ${c.published ? "green" : ""}`}>
                      {c.published ? "已发布" : "草稿"}
                    </span>
                  </td>
                  <td className="muted">
                    {c.publishedAt
                      ? new Date(c.publishedAt).toLocaleDateString("zh-CN")
                      : "—"}
                  </td>
                  <td>{c.views ?? 0} / {c.todayViews ?? 0}</td>
                  <td>{c.visitors ?? 0}</td>
                  <td>
                    <div className="row-actions">
                      <span className="sr-only">文章操作</span>
                      <a href={`/admin/${base}/${c.id}`}>编辑</a>
                      {c.published && (
                        <a
                          href={contentUrl(c)}
                          target="_blank"
                          aria-label={"查看 " + c.title}
                        >
                          <ArrowUpRight size={17} />
                        </a>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!loading && !error && !data?.items.length && (
          <div className="empty-state">
            <FileText size={32} />
            <h3>{q ? "没有找到匹配内容" : "还没有内容"}</h3>
            <p>
              {q
                ? "试试其他标题或摘要关键词。"
                : "从第一篇文章开始，记录你的想法。"}
            </p>
            <a href={`/admin/${base}/new`} className="button">
              新建内容
            </a>
          </div>
        )}
        <Pager data={data} setPage={setPage} />
      </section>
    </>
  );
}
