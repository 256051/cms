import type { CSSProperties } from "react";
import type { ThemeView } from "./types";

export type ThemeContext = { theme: ThemeView; preview?: string };
export const themeIds = ["classic", "paper", "magazine", "midnight", "fuwari", "retypeset", "cactus"] as const;
export const communityThemes = [
  { id: "fuwari", name: "Fuwari", url: "https://github.com/saicaca/fuwari" },
  { id: "retypeset", name: "Retypeset", url: "https://github.com/radishzzz/astro-theme-retypeset" },
  { id: "cactus", name: "Cactus", url: "https://github.com/probberechts/hexo-theme-cactus" },
] as const;
export function themeSource(id: string) { return communityThemes.find(theme => theme.id === id); }
export function defaultCopyright() { return `© ${new Date().getFullYear()} IT猫 · itmao.club`; }

export function siteHref(href: string, preview?: string) {
  if (!preview || !href.startsWith("/") || href.startsWith("//")) return href;
  const url = new URL(href, "http://cms.invalid");
  if (!/^\/(?:$|search\/?$|(?:posts|pages|category|tag)\/[^/]+\/?$)/.test(url.pathname)) return href;
  const query = new URLSearchParams(preview);
  url.searchParams.forEach((v, k) => { if (k === "page" || k === "q") query.set(k, v); });
  return "/admin/themes/preview" + (url.pathname === "/" ? "" : url.pathname) + "?" + query + url.hash;
}

function rgb(hex: string) { return [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16)); }
function luminance(color: number[]) {
  return color.map(x => x / 255).map(x => x <= .04045 ? x / 12.92 : ((x + .055) / 1.055) ** 2.4).reduce((sum, x, i) => sum + x * [.2126, .7152, .0722][i], 0);
}
export function contrast(a: string, b: string) {
  const [x, y] = [luminance(rgb(a)), luminance(rgb(b))].sort((a, b) => b - a);
  return (x + .05) / (y + .05);
}
function accessible(color: string, background: string, light: boolean) {
  const original = rgb(color), target = light ? 255 : 0;
  for (let n = 0; n <= 100; n++) {
    const adjusted = "#" + original.map(x => Math.round(x + (target - x) * n / 100).toString(16).padStart(2, "0")).join("");
    if (contrast(adjusted, background) >= 4.5) return adjusted;
  }
  return light ? "#FFFFFF" : "#000000";
}
export function themeStyle(theme: ThemeView): CSSProperties {
  const cactus = theme.themeId === "cactus", fuwari = theme.themeId === "fuwari";
  const retypeset = theme.themeId === "retypeset", paper = theme.themeId === "paper";
  const dark = theme.themeId === "midnight" || cactus;
  const background = cactus ? "#1D1F21" : dark ? "#0F172A" : retypeset ? "#FAF9F6" : paper ? "#FAF8F4" : "#FFFFFF";
  const soft = cactus ? "#282A2E" : dark ? "#172B3F" : fuwari ? "#EFEBF7" : retypeset ? "#EEEAE3" : paper ? "#EDEAE2" : "#F1F5F9";
  const accent = theme.options.accentColor;
  return {
    "--theme-accent": accent,
    "--theme-on-accent": contrast(accent, "#FFFFFF") >= 4.5 ? "#FFFFFF" : "#000000",
    "--blue": accessible(accent, soft, dark),
    "--blue-dark": accessible(accent, soft, dark),
    "--blue-soft": soft,
    "--surface": background,
    "--bg": cactus ? background : dark ? "#090F1C" : fuwari ? "#F2F0F5" : background,
    "--ink": cactus ? "#C9CACC" : dark ? "#E2E8F0" : retypeset ? "#35312D" : "#202B40",
    "--muted": cactus ? "#A3A6AA" : dark ? "#A8B6C9" : retypeset ? "#716A62" : "#626F80",
    "--line": cactus ? "#424549" : dark ? "#334155" : "#E6E7E9",
    colorScheme: dark ? "dark" : "light",
  } as CSSProperties;
}
