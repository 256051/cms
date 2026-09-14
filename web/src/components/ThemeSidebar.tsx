import Link from "next/link";
import { BookOpen, FolderOpen, Tags } from "lucide-react";
import { siteHref } from "@/lib/theme";
import type { Settings, Taxonomy } from "@/lib/types";

/** Fuwari's profile and taxonomy columns use only this site's public data. */
export default function ThemeSidebar({ site, taxonomy, preview }: { site: Settings; taxonomy: Taxonomy[]; preview?: string }) {
  const categories = taxonomy.filter(term => term.kind === "category");
  const tags = taxonomy.filter(term => term.kind === "tag");
  return <aside className="theme-sidebar" aria-label="站点与分类">
    <section className="theme-profile">
      <Link href={siteHref("/", preview)} className="profile-image" aria-label={site.title + "首页"}>
        {site.logoId ? <img src={`/media/${site.logoId}`} alt="" width={80} height={80} /> : <BookOpen size={38} strokeWidth={1.4} aria-hidden="true" />}
      </Link>
      <h2>{site.title}</h2>
      {site.subtitle && <p className="profile-subtitle">{site.subtitle}</p>}
      <p>{site.description}</p>
    </section>
    {categories.length > 0 && <section className="sidebar-section">
      <h2><FolderOpen size={18} aria-hidden="true" />分类</h2>
      <ul>{categories.map(term => <li key={term.id}><Link href={siteHref(`/category/${term.slug}`, preview)}>{term.name}<span aria-hidden="true">›</span></Link></li>)}</ul>
    </section>}
    {tags.length > 0 && <section className="sidebar-section">
      <h2><Tags size={18} aria-hidden="true" />标签</h2>
      <div className="sidebar-tags">{tags.map(term => <Link key={term.id} href={siteHref(`/tag/${term.slug}`, preview)}>{term.name}</Link>)}</div>
    </section>}
  </aside>;
}
