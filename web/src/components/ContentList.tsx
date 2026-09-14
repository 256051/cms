import Link from "next/link";
import { siteHref } from "@/lib/theme";
import { ArrowUpRight, BookOpen } from "lucide-react";
import {
  contentUrl,
  type Content,
  type Page,
  type Taxonomy,
} from "@/lib/types";

export default function ContentList({
  data,
  taxonomy,
  base = "/",
  query = "",
  preview,
  featured = false,
  themeId = "classic",
}: {
  data: Page<Content>;
  taxonomy: Taxonomy[];
  base?: string;
  query?: string;
  preview?: string;
  featured?: boolean;
  themeId?: string;
}) {
  return (
    <>
      <div className={`article-grid${featured ? " featured-grid" : ""}`}>
        {data.items.map((post, i) => themeId === "cactus" || themeId === "retypeset" ? (
          <article className="article-card text-entry" key={post.id}>
            <time className="entry-date" dateTime={post.publishedAt || undefined}>{post.publishedAt ? new Date(post.publishedAt).toLocaleDateString("zh-CN", { timeZone: "UTC" }) : ""}</time>
            <div className="entry-content">
              <h2><Link href={siteHref(contentUrl(post), preview)}>{post.title}</Link></h2>
              {themeId === "retypeset" && post.summary && <p>{post.summary}</p>}
            </div>
          </article>
        ) : (
          <article className={`article-card${post.coverId ? " has-cover" : " no-cover"}`} key={post.id}>
            {(themeId !== "fuwari" || post.coverId) && <Link
              className="card-cover"
              href={siteHref(contentUrl(post), preview)}
              tabIndex={-1}
              aria-hidden="true"
            >
              {post.coverId ? (
                <img
                  src={`/media/${post.coverId}`}
                  alt=""
                  loading={i > 1 ? "lazy" : "eager"}
                />
              ) : (
                <div className={`cover-placeholder tone-${i % 3}`}>
                  <BookOpen size={44} strokeWidth={1} />
                  <span>READ & REFLECT</span>
                </div>
              )}
            </Link>}
            <div className="card-body">
              <div className="article-meta">
                <span>
                  {taxonomy.find((t) => t.id === post.categoryId)?.name ||
                    "随笔"}
                </span>
                <time dateTime={post.publishedAt || undefined}>
                  {post.publishedAt
                    ? new Date(post.publishedAt).toLocaleDateString("zh-CN", {
                        timeZone: "UTC",
                      })
                    : ""}
                </time>
              </div>
              <h2>
                <Link href={siteHref(contentUrl(post), preview)}>{post.title}</Link>
              </h2>
              <p>{post.summary || "打开文章，继续阅读。"}</p>
              <Link href={siteHref(contentUrl(post), preview)} className="read-link">
                阅读全文 <ArrowUpRight size={16} />
              </Link>
            </div>
          </article>
        ))}
      </div>
      {data.items.length === 0 && (
        <div className="empty-state">
          <BookOpen size={36} />
          <h2>这里还没有文章</h2>
          <p>新的想法正在路上，稍后再来看看。</p>
        </div>
      )}
      <Pagination
        data={data}
        href={(n) => siteHref(`${base}?${query ? query + "&" : ""}page=${n}`, preview)}
      />
    </>
  );
}
export function Pagination({
  data,
  href,
}: {
  data: Pick<Page<unknown>, "total" | "page" | "pageSize">;
  href: (page: number) => string;
}) {
  const pages = Math.max(1, Math.ceil(data.total / data.pageSize));
  return pages > 1 ? (
    <nav className="pagination" aria-label="分页">
      {data.page > 1 && <Link href={href(data.page - 1)}>上一页</Link>}
      <span>
        第 {data.page} / {pages} 页
      </span>
      {data.page < pages && <Link href={href(data.page + 1)}>下一页</Link>}
    </nav>
  ) : null;
}
