import type { Menu } from "./types";

export const menuTypes: Record<string, string> = { custom: "自定义链接", post: "文章", page: "自定义页面", product: "产品", case: "案例", category: "分类", tag: "标签" };

/** Stable hierarchy shared by the editor and public navigation. */
export function menuChildren(items: Menu[], parent = "") {
  return items.filter(x => x.parentId === parent).sort((a, b) => a.sort - b.sort || a.id.localeCompare(b.id));
}
export function menuRows(items: Menu[], parent = "", depth = 0): { item: Menu; depth: number }[] {
  if (depth >= 5) return [];
  return menuChildren(items, parent).flatMap(item => [{ item, depth }, ...menuRows(items, item.id, depth + 1)]);
}
