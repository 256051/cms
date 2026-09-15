import type { CSSProperties } from "react";
import type { ThemeView } from "./types";

export type ThemeContext = { theme: ThemeView; preview?: string };
export type ColorMode = "light" | "dark" | "system";
export const colorModeCookie = "cms-color-mode";
export function parseColorMode(value?: string): ColorMode { return value === "light" || value === "dark" ? value : "system"; }
export const secondBatchThemeIds = ["chirpy", "oranges", "aircloud", "stellar", "halorum", "aurora", "iemo", "clarity"] as const;
export const themeIds = ["classic", "paper", "magazine", "midnight", "fuwari", "retypeset", "cactus", ...secondBatchThemeIds] as const;
export const communityThemes = [
  { id: "fuwari", name: "Fuwari", url: "https://github.com/saicaca/fuwari" },
  { id: "retypeset", name: "Retypeset", url: "https://github.com/radishzzz/astro-theme-retypeset" },
  { id: "cactus", name: "Cactus", url: "https://github.com/probberechts/hexo-theme-cactus" },
  { id: "chirpy", name: "Chirpy", url: "https://github.com/cotes2020/jekyll-theme-chirpy" },
  { id: "oranges", name: "Oranges", url: "https://github.com/zchengsite/hexo-theme-oranges" },
  { id: "aircloud", name: "Aircloud", url: "https://github.com/aircloud/hexo-theme-aircloud" },
  { id: "stellar", name: "Stellar", url: "https://github.com/xaoxuu/hexo-theme-stellar" },
  { id: "halorum", name: "Halorum", url: "https://github.com/mulingyuer/Typecho_Theme_JJ" },
  { id: "aurora", name: "Aurora", url: "https://github.com/auroral-ui/hexo-theme-aurora" },
  { id: "iemo", name: "iEmo", url: "https://github.com/kannafay/iEmo" },
  { id: "clarity", name: "Clarity", url: "https://github.com/L33Z22L11/blog-v3" },
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
export function themeStyle(theme: ThemeView, mode?: "light" | "dark"): CSSProperties {
  const cactus = theme.themeId === "cactus", fuwari = theme.themeId === "fuwari";
  const retypeset = theme.themeId === "retypeset", paper = theme.themeId === "paper";
  const dark = mode ? mode === "dark" : theme.themeId === "midnight" || cactus;
  const background = dark ? cactus ? "#1D1F21" : "#0F172A" : retypeset ? "#FAF9F6" : paper ? "#FAF8F4" : "#FFFFFF";
  const palettes: Record<string, { bg: string; soft: string }> = {
    chirpy: { bg: "#FAFAFC", soft: "#EFF2F7" },
    oranges: { bg: "#FFFDFA", soft: "#FAEEDC" },
    aircloud: { bg: "#FFFFFF", soft: "#EEF4F5" },
    stellar: { bg: "#F4F7F7", soft: "#E5F1EE" },
    halorum: { bg: "#F2F3F5", soft: "#EDF2FC" },
    aurora: { bg: "#F7F5FB", soft: "#EFE9F7" },
    iemo: { bg: "#FAF8F5", soft: "#F3E9E1" },
    clarity: { bg: "#F1F5FA", soft: "#E7EFF8" },
  };
  const palette = palettes[theme.themeId];
  const soft = dark ? cactus ? "#282A2E" : "#172B3F" : palette?.soft ?? (fuwari ? "#EFEBF7" : retypeset ? "#EEEAE3" : paper ? "#EDEAE2" : "#F1F5F9");
  const accent = theme.options.accentColor;
  return {
    "--theme-accent": accent,
    "--theme-on-accent": contrast(accent, "#FFFFFF") >= 4.5 ? "#FFFFFF" : "#000000",
    "--blue": accessible(accent, soft, dark),
    "--blue-dark": accessible(accent, soft, dark),
    "--blue-soft": soft,
    "--surface": background,
    "--bg": dark ? cactus ? background : "#090F1C" : palette?.bg ?? (fuwari ? "#F2F0F5" : background),
    "--ink": dark ? cactus ? "#C9CACC" : "#E2E8F0" : retypeset ? "#35312D" : "#202B40",
    "--muted": accessible(dark ? cactus ? "#A3A6AA" : "#A8B6C9" : retypeset ? "#716A62" : "#626F80", soft, dark),
    "--line": dark ? cactus ? "#424549" : "#334155" : "#E6E7E9",
    "--green": dark ? "#86EFAC" : "#167B59",
    "--danger": dark ? "#FDA4AF" : "#B42336",
    colorScheme: dark ? "dark" : "light",
  } as CSSProperties;
}

/** Both palettes are in the initial HTML; CSS follows the OS without waiting for JavaScript. */
export function themeModeStyle(theme: ThemeView): CSSProperties {
  const light = themeStyle(theme, "light") as Record<string, string>;
  const dark = themeStyle(theme, "dark") as Record<string, string>;
  return Object.fromEntries(Object.entries(light).filter(([key]) => key.startsWith("--")).map(([key, value]) =>
    [key, value === dark[key] ? value : `light-dark(${value}, ${dark[key]})`],
  )) as CSSProperties;
}
