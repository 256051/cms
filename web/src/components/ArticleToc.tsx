"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";

/** Builds a directory from the already-rendered, sanitized article body. */
export default function ArticleToc({ contentId }: { contentId: string }) {
  const pathname = usePathname();
  const [headings, setHeadings] = useState<{ id: string; text: string; level: number }[]>([]);

  useEffect(() => {
    const added: { element: HTMLElement; id: string; previous: string | null }[] = [];
    let sequence = 1;
    const collected = Array.from(document.getElementById("article-body")?.querySelectorAll<HTMLElement>("h2, h3") ?? [])
      .filter(heading => heading.textContent?.trim())
      .map(heading => {
        if (!heading.id) {
          let id = `cms-heading-${sequence++}`;
          while (document.getElementById(id)) id = `cms-heading-${sequence++}`;
          added.push({ element: heading, id, previous: heading.getAttribute("id") });
          heading.id = id;
        }
        return { id: heading.id, text: heading.textContent!.trim(), level: Number(heading.tagName.slice(1)) };
      });
    setHeadings(collected);

    let hash = "";
    try { hash = decodeURIComponent(window.location.hash.slice(1)); } catch { /* A malformed fragment has no target. */ }
    const target = added.find(heading => heading.id === hash)?.element;
    const frame = target ? requestAnimationFrame(() => target.scrollIntoView()) : undefined;

    return () => {
      if (frame !== undefined) cancelAnimationFrame(frame);
      for (const { element, id, previous } of added) {
        if (element.id !== id) continue;
        if (previous === null) element.removeAttribute("id");
        else element.setAttribute("id", previous);
      }
    };
  }, [contentId, pathname]);

  if (!headings.length) return null;

  return <nav className="article-toc" aria-label="本文目录">
    <details open>
      <summary>本文目录</summary>
      <ul>{headings.map((heading, index) => <li key={`${index}-${heading.id}`} className={heading.level === 3 ? "toc-level-3" : undefined}>
        <a href={`#${encodeURIComponent(heading.id)}`}>{heading.text}</a>
      </li>)}</ul>
    </details>
  </nav>;
}
