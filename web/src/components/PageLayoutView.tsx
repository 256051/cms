import type { CSSProperties } from "react";
import { contentUrl, type Content, type PageBlockItem, type PageLayout } from "@/lib/types";

export default function PageLayoutView({ layout, posts = {}, preview = false, href = (value: string) => value }: {
  layout: PageLayout; posts?: Record<string, Content[]>; preview?: boolean; href?: (value: string) => string;
}) {
  function picture(item: Pick<PageBlockItem, "imageId" | "imageAlt">) {
    return item.imageId && <img className="page-block-image" src={`/media/${item.imageId}`} alt={item.imageAlt} loading="lazy" />;
  }
  function link(item: Pick<PageBlockItem, "linkUrl" | "linkText">) {
    return item.linkUrl && <a className="page-block-button" href={href(item.linkUrl)}>{item.linkText || "了解更多"}</a>;
  }
  return <div className={`page-layout page-width-${layout.width}`}>
    {layout.blocks.filter(block => !block.hidden).map(block => <section key={block.id} id={`section-${block.id}`} data-block={block.type}
      className={`page-block page-block-${block.type} page-tone-${block.tone} page-align-${block.align} page-space-${block.spacing}${block.mobile?.hidden ? " page-mobile-hidden" : ""}`}
      data-mobile-align={block.mobile?.align} data-mobile-space={block.mobile?.spacing} data-mobile-text={block.mobile?.textSize}
      style={{ "--page-mobile-columns": block.mobile?.columns || 1 } as CSSProperties}>
      <div className={block.type === "hero" && block.imageId ? "page-hero-grid" : undefined}>
        <div className="page-block-copy">{block.title && <h2>{block.title}</h2>}{block.html ? <div className="prose page-block-rich" dangerouslySetInnerHTML={{ __html: block.html }} /> : block.text && <p className="page-block-text">{block.text}</p>}
          {["hero", "text", "cta"].includes(block.type) && link(block)}</div>
        {["hero", "image"].includes(block.type) && picture(block)}
      </div>
      {block.type === "cards" && <div className="page-card-grid" style={{ "--page-columns": block.columns } as CSSProperties}>
        {block.items.map((item, index) => <article className="page-card" key={index}>{picture(item)}<h3>{item.title}</h3><p className="page-block-text">{item.text}</p>{link(item)}</article>)}
      </div>}
      {block.type === "faq" && <div className="page-faq">{block.items.map((item, index) => <details key={index}><summary>{item.title}</summary><p className="page-block-text">{item.text}</p></details>)}</div>}
      {block.type === "posts" && <div className="page-card-grid" style={{ "--page-columns": block.columns } as CSSProperties}>
        {(posts[block.id] ?? []).map(post => <article className="page-card" key={post.id}>{post.coverId && picture({ imageId: post.coverId, imageAlt: post.title })}
          <h3><a href={href(contentUrl(post))}>{post.title}</a></h3><p>{post.summary}</p></article>)}
        {!posts[block.id]?.length && <p className="page-empty">{preview ? "此处显示所选分类的已发布文章。" : "暂无已发布内容。"}</p>}
      </div>}
      {block.type === "contact" && (preview ? <div className="page-contact-placeholder">咨询表单区域 · 发布后访客可填写需求及联系方式</div> : <div data-inquiry-slot />)}
    </section>)}
    {preview && layout.blocks.every(x => x.hidden) && <p className="page-empty">添加模块后即可预览页面。</p>}
  </div>;
}
