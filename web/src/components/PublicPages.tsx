import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowDown, ArrowUpRight } from "lucide-react";
import SiteShell from "./SiteShell";
import ContentList from "./ContentList";
import CommentSection from "./CommentSection";
import { publicApi, PublicApiError, siteUrl } from "@/lib/server";
import { contentUrl, type Content, type Page, type Settings, type Taxonomy, type ThemeView } from "@/lib/types";
import { siteHref, themeSource, type ThemeContext } from "@/lib/theme";
import ArticleToc from "./ArticleToc";

export async function homeMetadata() {
  const s = await publicApi<Settings>("settings");
  return {
    title: { absolute: s.title },
    description: s.description,
    keywords: s.keywords,
    alternates: { canonical: siteUrl() },
  };
}
export async function HomePage({
  searchParams,
  context,
}: {
  searchParams: Promise<{ page?: string }>;
  context?: ThemeContext;
}) {
  const params = await searchParams;
  const [posts, taxonomy, theme] = await Promise.all([
    publicApi<Page<Content>>(`contents?page=${Number(params.page) || 1}`),
    publicApi<Taxonomy[]>("taxonomy"),
    context?.theme ?? publicApi<ThemeView>("theme"),
  ]);
  return (
    <SiteShell context={{ theme, preview: context?.preview }}>
      <section className="hero">
        <div>
          <span className="eyebrow">
            <span className="dot" /> {theme.themeId === "cactus" ? "NOTES / CODE / LIFE" : theme.themeId === "retypeset" ? "文字有温度，阅读有回响" : "思考 · 记录 · 分享"}
          </span>
          <h1>{theme.options.heroTitle.split("\n").map((line, i) => i === 0 ? line : <span key={i}><br />{line}</span>)}</h1>
          <p>{theme.options.heroDescription}</p>
          <a href="#latest" className="hero-link">
            开始阅读 <ArrowDown size={17} />
          </a>
        </div>
        <div className="hero-note">
          <span className="note-number">01 /</span>
          <div className="note-lines" />
          <blockquote>
            写下所见，
            <br />
            留下所想。
          </blockquote>
          <span className="note-caption">
            A SPACE FOR GOOD IDEAS <ArrowUpRight size={20} />
          </span>
        </div>
      </section>
      <section className="site-section" id="latest">
        <div className="section-heading">
          <div>
            <span className="eyebrow">THE LATEST</span>
            <h2>最近发布</h2>
          </div>
          <span className="muted">共 {posts.total} 篇文章</span>
        </div>
        <div className="category-links">
          <Link className="active" href={siteHref("/", context?.preview)}>
            全部内容
          </Link>
          {taxonomy
            .filter((t) => t.kind === "category")
            .map((t) => (
              <Link href={siteHref(`/category/${t.slug}`, context?.preview)} key={t.id}>
                {t.name}
              </Link>
            ))}
        </div>
        <ContentList data={posts} taxonomy={taxonomy} themeId={theme.themeId} preview={context?.preview} featured={theme.themeId === "magazine" && posts.page === 1} />
      </section>
    </SiteShell>
  );
}

type Params = { archive: string; slug: string };
export async function resolveContent({ archive, slug }: Params) {
  if (!["posts", "pages", "category", "tag"].includes(archive)) notFound();
  if (archive === "category" || archive === "tag") {
    const taxonomy = await publicApi<Taxonomy[]>("taxonomy");
    const term = taxonomy.find((t) => t.kind === archive && t.slug === slug);
    if (!term) notFound();
    return { term, taxonomy, post: null };
  }
  try {
    const post = await publicApi<Content>(
      `contents/${encodeURIComponent(slug)}`,
    );
    if ((archive === "posts" ? "post" : "page") !== post.kind) notFound();
    return {
      post,
      term: null,
      taxonomy: await publicApi<Taxonomy[]>("taxonomy"),
    };
  } catch (e) {
    if (e instanceof PublicApiError && e.status === 404) notFound();
    throw e;
  }
}
export async function detailMetadata({
  params,
}: {
  params: Promise<Params>;
}) {
  const p = await params;
  const data = await resolveContent(p);
  const site = await publicApi<Settings>("settings");
  const description =
    data.post?.summary ||
    (data.term
      ? `${data.term.name}的文章归档。${site.description}`
      : site.description);
  return {
    title: data.post?.title || data.term?.name,
    description,
    alternates: { canonical: `${siteUrl()}/${p.archive}/${p.slug}` },
    openGraph: data.post
      ? {
          title: data.post.title,
          description,
          type: "article",
          url: siteUrl() + contentUrl(data.post),
          images: data.post.coverId
            ? [`${siteUrl()}/media/${data.post.coverId}`]
            : [],
        }
      : undefined,
  };
}
export async function DetailPage({
  params,
  searchParams,
  context,
}: {
  params: Promise<Params>;
  searchParams: Promise<{ page?: string }>;
  context?: ThemeContext;
}) {
  const p = await params;
  const data = await resolveContent(p);
  const theme = context?.theme ?? await publicApi<ThemeView>("theme");
  const resolvedContext = { theme, preview: context?.preview };
  if (data.term) {
    const page = Number((await searchParams).page) || 1;
    const posts = await publicApi<Page<Content>>(
      `contents?${data.term.kind === "category" ? "categoryId" : "tagId"}=${data.term.id}&page=${page}`,
    );
    return (
      <SiteShell context={resolvedContext}>
        <section className="site-section">
          <span className="eyebrow">
            {data.term.kind === "category" ? "分类归档" : "标签归档"}
          </span>
          <h1>{data.term.name}</h1>
          <ContentList
            preview={context?.preview}
            data={posts}
            taxonomy={data.taxonomy}
            themeId={theme.themeId}
            base={`/${p.archive}/${p.slug}`}
          />
        </section>
      </SiteShell>
    );
  }
  const post = data.post!;
  const settings = await publicApi<Settings>("settings");
  return (
    <SiteShell context={resolvedContext}>
      <article className="reading">
        <Link href={siteHref("/", context?.preview)} className="back-link">
          ← 返回文章列表
        </Link>
        <header>
          <div className="article-meta">
            <span>
              {data.taxonomy.find((t) => t.id === post.categoryId)?.name ||
                (post.kind === "page" ? "独立页面" : "随笔")}
            </span>
            <time dateTime={post.publishedAt || undefined}>
              {post.publishedAt &&
                new Date(post.publishedAt).toLocaleDateString("zh-CN", {
                  timeZone: "UTC",
                })}
            </time>
          </div>
          <h1>{post.title}</h1>
          {post.summary && <p className="reading-summary">{post.summary}</p>}
        </header>
        {post.coverId && (
          <img
            className="reading-cover"
            src={`/media/${post.coverId}`}
            alt="文章封面"
          />
        )}
        <div className="reading-layout">
        {themeSource(theme.themeId) && <ArticleToc key={`${post.id}:${post.version}`} contentId={post.id} />}
        <div
          id="article-body"
          className="prose"
          dangerouslySetInnerHTML={{ __html: post.html }}
        />
        </div>
        <div className="tag-list">
          {post.tagIds
            .map((id) => data.taxonomy.find((t) => t.id === id))
            .filter(Boolean)
            .map((t) => (
              <Link href={siteHref(`/tag/${t!.slug}`, context?.preview)} key={t!.id}>
                # {t!.name}
              </Link>
            ))}
        </div>
        {settings.commentsEnabled && <CommentSection contentId={post.id} preview={!!context?.preview} requireApproval={settings.requireCommentApproval} requireLogin={settings.commentsRequireLogin} />}
      </article>
    </SiteShell>
  );
}

export async function SearchPage({
  searchParams,
  context,
}: {
  searchParams: Promise<{ q?: string; page?: string }>;
  context?: ThemeContext;
}) {
  const { q = "", page = "1" } = await searchParams;
  const [posts, taxonomy, theme] = await Promise.all([
    publicApi<Page<Content>>(
      `contents?search=true&q=${encodeURIComponent(q.slice(0, 200))}&page=${Number(page) || 1}`,
    ),
    publicApi<Taxonomy[]>("taxonomy"),
    context?.theme ?? publicApi<ThemeView>("theme"),
  ]);
  return (
    <SiteShell context={{ theme, preview: context?.preview }}>
      <section className="site-section">
        <span className="eyebrow">DISCOVER</span>
        <h1>寻找感兴趣的内容</h1>
        <form className="search-form" action={siteHref("/search", context?.preview).split("?")[0]}>
          {context?.preview && Array.from(new URLSearchParams(context.preview)).map(([key, value]) => <input key={key} type="hidden" name={key} value={value} />)}
          <label className="sr-only" htmlFor="search">
            搜索文章标题和摘要
          </label>
          <input
            id="search"
            name="q"
            placeholder="搜索文章标题或摘要…"
            defaultValue={q}
            maxLength={200}
          />
          <button>搜索</button>
        </form>
        <p className="muted">
          {q ? `“${q}”的搜索结果` : "全部文章"} · {posts.total} 篇
        </p>
        <ContentList
          preview={context?.preview}
          data={posts}
          taxonomy={taxonomy}
          themeId={theme.themeId}
          base="/search"
          query={`q=${encodeURIComponent(q)}`}
        />
      </section>
    </SiteShell>
  );
}
