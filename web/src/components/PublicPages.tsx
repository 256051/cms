import Link from "next/link";
import { notFound, permanentRedirect } from "next/navigation";
import { ArrowDown, ArrowUpRight } from "lucide-react";
import SiteShell from "./SiteShell";
import ContentList from "./ContentList";
import CommentSection from "./CommentSection";
import { publicApi, PublicApiError, siteUrl } from "@/lib/server";
import { contentUrl, type Content, type Page, type Settings, type Taxonomy, type ThemeView } from "@/lib/types";
import { siteHref, themeSource, type ThemeContext } from "@/lib/theme";
import ArticleToc from "./ArticleToc";
import { ArticleViewCount } from "./PublicTraffic";
import PageLayoutContent from "./PageLayoutContent";
import BusinessDetails from "./BusinessDetails";
import ShopCheckout from "./ShopCheckout";

export async function BusinessArchive({ params, searchParams }: { params: Promise<{ archive: string }>; searchParams: Promise<{ page?: string }> }) {
  const { archive } = await params;
  if (archive !== "products" && archive !== "cases") notFound();
  const page = Number((await searchParams).page) || 1;
  const [data, taxonomy, theme] = await Promise.all([publicApi<Page<Content>>(`contents?kind=${archive === "products" ? "product" : "case"}&page=${page}`),
    publicApi<Taxonomy[]>("taxonomy"), publicApi<ThemeView>("theme")]);
  return <SiteShell><section className="site-section"><h1>{archive === "products" ? "产品" : "案例"}</h1>
    <ContentList data={data} taxonomy={taxonomy} themeId={theme.themeId} base={`/${archive}`} />
  </section></SiteShell>;
}

export async function homeMetadata() {
  const [s, home] = await Promise.all([publicApi<Settings>("settings"), publicApi<Content | null>("home")]);
  const image = home?.seo?.imageId || home?.coverId;
  return {
    title: { absolute: home?.seo?.title || s.title },
    description: home?.seo?.description || s.description,
    keywords: s.keywords,
    alternates: { canonical: siteUrl() },
    robots: s.blockSearchEngines || home?.seo?.noIndex ? { index: false } : undefined,
    openGraph: home ? { title: home.seo?.title || home.title, description: home.seo?.description || home.summary,
      url: siteUrl(), images: image ? [`${siteUrl()}/media/${image}`] : [] } : undefined,
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
  const home = await publicApi<Content | null>("home");
  if (home) return <SiteShell context={context} layout={home.layout}>
    <article id="article-body"><h1 className={!home.layout || home.layout.showTitle ? "page-layout-title" : "sr-only"}>{home.title}</h1>
      {home.layout ? <PageLayoutContent layout={home.layout} context={context} /> : <div className="page-layout prose" dangerouslySetInnerHTML={{ __html: home.html }} />}
    </article>
  </SiteShell>;
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
        <ContentList data={posts} taxonomy={taxonomy} themeId={theme.themeId} preview={context?.preview} featured={["magazine", "aurora"].includes(theme.themeId) && posts.page === 1} />
      </section>
    </SiteShell>
  );
}

type Params = { archive: string; slug: string };
export async function resolveContent({ archive, slug }: Params) {
  if (!["posts", "pages", "products", "cases", "category", "tag"].includes(archive)) notFound();
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
    if (({ posts: "post", pages: "page", products: "product", cases: "case" }[archive]) !== post.kind) notFound();
    if (post.slug !== slug) permanentRedirect(contentUrl(post));
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
    data.post?.seo?.description || data.post?.summary ||
    (data.term
      ? `${data.term.name}的文章归档。${site.description}`
      : site.description);
  return {
    title: data.post?.seo?.title || data.post?.title || data.term?.name,
    description,
    robots: site.blockSearchEngines || data.post?.seo?.noIndex ? { index: false } : undefined,
    alternates: { canonical: data.post?.id === site.homePageId ? siteUrl() : `${siteUrl()}/${p.archive}/${p.slug}` },
    openGraph: data.post
      ? {
          title: data.post.seo?.title || data.post.title,
          description,
          type: "article",
          url: siteUrl() + contentUrl(data.post),
          images: data.post.seo?.imageId || data.post.coverId
            ? [`${siteUrl()}/media/${data.post.seo?.imageId || data.post.coverId}`]
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
  if (post.layout) return <SiteShell context={resolvedContext} layout={post.layout}>
    <article id="article-body"><h1 className={post.layout.showTitle ? "page-layout-title" : "sr-only"}>{post.title}</h1>
      <BusinessDetails fields={post.fields} />
      <PageLayoutContent layout={post.layout} context={resolvedContext} />
      {post.kind === "product" && !context?.preview && <ShopCheckout productId={post.id} />}
    </article>
  </SiteShell>;
  const discovery = await publicApi<{ previous: Content | null; next: Content | null; related: Content[] }>(`contents/${encodeURIComponent(post.slug)}/discovery`);
  const settings = await publicApi<Settings>("settings");
  return (
    <SiteShell context={resolvedContext}>
      <article className="reading">
        <Link href={siteHref(post.kind === "product" ? "/products" : post.kind === "case" ? "/cases" : "/", context?.preview)} className="back-link">
          ← 返回{post.kind === "product" ? "产品" : post.kind === "case" ? "案例" : "文章"}列表
        </Link>
        <header>
          <div className="article-meta">
            <span>
              {data.taxonomy.find((t) => t.id === post.categoryId)?.name ||
                (post.kind === "page" ? "独立页面" : post.kind === "product" ? "产品" : post.kind === "case" ? "案例" : "随笔")}
            </span>
            <time dateTime={post.publishedAt || undefined}>
              {post.publishedAt &&
                new Date(post.publishedAt).toLocaleDateString("zh-CN", {
                  timeZone: "UTC",
                })}
            </time>
            <ArticleViewCount key={post.id} initial={post.views ?? 0} />
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
        <BusinessDetails fields={post.fields} />
        {post.kind === "product" && !context?.preview && <ShopCheckout productId={post.id} />}
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
        <nav className="content-discovery" aria-label="继续阅读">
          {discovery.previous && <Link href={siteHref(contentUrl(discovery.previous), context?.preview)}>上一篇：{discovery.previous.title}</Link>}
          {discovery.next && <Link href={siteHref(contentUrl(discovery.next), context?.preview)}>下一篇：{discovery.next.title}</Link>}
        </nav>
        {discovery.related.length > 0 && <section className="content-discovery"><h2>相关文章</h2>{discovery.related.map(item => <Link key={item.id} href={siteHref(contentUrl(item), context?.preview)}>{item.title}</Link>)}</section>}
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
            搜索文章标题、摘要和正文
          </label>
          <input
            id="search"
            name="q"
            placeholder="搜索文章标题、摘要或正文…"
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
