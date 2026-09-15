import { test, expect, type Locator } from "@playwright/test";
import fs from "node:fs";
import { fillCaptcha } from "./login";
import { colorModeCookie, contrast, themeStyle } from "../src/lib/theme";
import type { Content, ThemesView } from "../src/lib/types";

if (!process.env.CMS_TEST_BASE_URL || !process.env.CMS_TEST_CREDENTIALS_PATH)
  throw new Error("请在独立测试站点运行显示模式验收。");
const credentials = JSON.parse(fs.readFileSync(process.env.CMS_TEST_CREDENTIALS_PATH, "utf8").replace(/^\uFEFF/, ""));
const hex = (color: string) => "#" + color.match(/[\d.]+/g)!.slice(0, 3).map(value => Math.round(Number(value)).toString(16).padStart(2, "0")).join("");
async function setMode(button: Locator, mode: string) {
  for (let attempt = 0; attempt < 3 && await button.getAttribute("data-mode") !== mode; attempt++) await button.click();
  await expect(button).toHaveAttribute("data-mode", mode);
}

test("all themes: light, dark and system appearance, SSR preference and keyboard control", async ({ page, context, browser }) => {
  test.setTimeout(360_000);
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto("/admin/login");
  await page.getByLabel("账号", { exact: true }).fill(credentials.username);
  await page.getByLabel("密码", { exact: true }).fill(credentials.password);
  await fillCaptcha(page);
  await page.getByRole("button", { name: "登录工作台" }).click();
  await expect(page.getByRole("heading", { name: /你好/ })).toBeVisible();
  async function api<T>(route: string, data?: unknown, method = data === undefined ? "GET" : "POST"): Promise<T> {
    const csrf = (await (await page.request.get("/api/v1/auth/csrf")).json()).data.token;
    const result = await page.request.fetch("/api/v1/" + route, { method, data, headers: { "X-CSRF-TOKEN": csrf } });
    expect(result.ok(), `${method} ${route}: ${result.status()}`).toBeTruthy(); return (await result.json()).data;
  }
  const original = await api<ThemesView>("admin/themes");
  const draft = await api<Content>("admin/contents", {
    kind: "post", title: "显示模式验收", slug: "color-modes-" + Date.now().toString(36), summary: "代码、表格、链接和评论。",
    html: '<p>显示模式正文</p><h2>阅读章节</h2><p><a href="/search">站内链接</a>与普通文字。</p><blockquote>引用内容</blockquote><pre><code>const mode = "system";</code></pre><table><tbody><tr><th>模式</th><th>用途</th></tr><tr><td>跟随系统</td><td>自动切换</td></tr></tbody></table>',
    coverId: "", categoryId: "", tagIds: [], version: 0,
  });
  await api(`admin/contents/${draft.id}/publish`, { version: draft.version });
  const chooser = page.getByRole("button", { name: /^显示模式：/ });
  const background = () => page.locator(".public-site").evaluate(el => getComputedStyle(el).backgroundColor);
  const guest = await browser.newContext({ baseURL: process.env.CMS_TEST_BASE_URL, colorScheme: "light", ignoreHTTPSErrors: process.env.CMS_TEST_SELF_SIGNED === "1" });
  try {
    for (const definition of original.themes) {
      for (const width of [1440, 768, 375]) {
        await page.setViewportSize({ width, height: 960 });
        await page.goto(`/admin/themes/preview?themeId=${definition.id}`);
        for (const mode of ["light", "dark"] as const) {
          await setMode(chooser, mode);
          await page.emulateMedia({ colorScheme: mode === "light" ? "dark" : "light" });
          await expect(page.locator("html")).toHaveAttribute("data-color-mode", mode);
          const palette = themeStyle({ themeId: definition.id, options: definition.options }, mode) as Record<string, string>;
          expect(hex(await background())).toBe(palette["--bg"].toLowerCase());
          const colors = await page.locator(".public-site").evaluate(el => {
            const probe = document.createElement("span"); el.append(probe);
            const result = Object.fromEntries(["ink", "muted", "blue", "surface", "bg", "blue-soft"].map(key => {
              probe.style.color = `var(--${key})`; return [key, getComputedStyle(probe).color];
            })); probe.remove(); return result;
          });
          for (const foreground of ["ink", "muted", "blue"]) for (const surface of ["surface", "bg", "blue-soft"])
            expect(contrast(hex(colors[foreground]), hex(colors[surface])), `${definition.id} ${mode} ${foreground}/${surface}`).toBeGreaterThanOrEqual(4.5);
          expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
          await chooser.focus(); await expect(chooser).toBeInViewport();
          const target = await chooser.boundingBox();
          expect(target!.width).toBeGreaterThanOrEqual(44); expect(target!.height).toBeGreaterThanOrEqual(44);
          await expect(chooser.locator("svg")).toHaveCount(1);
          if (width !== 768) await page.screenshot({ path: `../artifacts/color-${definition.id}-${mode}-${width}.png`, fullPage: true, animations: "disabled" });
        }
        await setMode(chooser, "system");
        for (const mode of ["light", "dark"] as const) {
          await page.emulateMedia({ colorScheme: mode });
          await expect.poll(async () => hex(await background())).toBe((themeStyle({ themeId: definition.id, options: definition.options }, mode) as Record<string, string>)["--bg"].toLowerCase());
          await expect(chooser).toHaveAttribute("data-mode", "system");
        }
      }
      await page.goto(`/admin/themes/preview/posts/${draft.slug}?themeId=${definition.id}`);
      for (const mode of ["light", "dark"] as const) {
        await setMode(chooser, mode);
        for (const selector of [".prose", ".prose pre", ".prose th", ".prose blockquote", ".color-mode-switch", ".comments input"]) {
          const colors = await page.locator(selector).first().evaluate(el => {
            const color = getComputedStyle(el).color;
            let node: Element | null = el, background = "rgba(0, 0, 0, 0)";
            while (node && background === "rgba(0, 0, 0, 0)") { background = getComputedStyle(node).backgroundColor; node = node.parentElement; }
            return [color, background];
          });
          expect(contrast(hex(colors[0]), hex(colors[1])), `${definition.id} ${mode} ${selector}`).toBeGreaterThanOrEqual(4.5);
        }
        await expect(page.locator("#article-body")).toContainText("显示模式正文");
      }
    }
    await page.goto("/");
    await setMode(chooser, "light"); await chooser.focus();
    await expect(chooser).toHaveAttribute("aria-label", "显示模式：当前明亮模式，点击切换为黑暗模式");
    await page.keyboard.press("Enter");
    await expect(chooser).toHaveAttribute("data-mode", "dark");
    await expect(chooser.locator("path")).toHaveAttribute("d", /^M524\.8 938\.667/);
    await page.keyboard.press("Space"); await expect(chooser).toHaveAttribute("data-mode", "system");
    await page.keyboard.press("Enter"); await expect(chooser).toHaveAttribute("data-mode", "light");
    await page.keyboard.press("Enter");
    await page.reload(); await expect(chooser).toHaveAttribute("data-mode", "dark");
    expect((await context.cookies()).find(cookie => cookie.name === colorModeCookie)?.value).toBe("dark");
    const publicHtml = await (await page.request.get("/")).text();
    expect(publicHtml).toContain('data-color-mode="dark"');
    await page.getByRole("link", { name: "搜索", exact: true }).click(); await expect(chooser).toHaveAttribute("data-mode", "dark");
    const newTab = await context.newPage(); await newTab.goto("/");
    const otherControl = newTab.getByRole("button", { name: /^显示模式：/ });
    await expect(otherControl).toHaveAttribute("data-mode", "dark");
    await setMode(otherControl, "light");
    // Headless bringToFront does not consistently dispatch the OS window focus event.
    await page.bringToFront(); await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await expect(chooser).toHaveAttribute("data-mode", "light");
    await setMode(otherControl, "dark");
    await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true })));
    await expect(chooser).toHaveAttribute("data-mode", "dark"); await newTab.close();
    const otherVisitor = await guest.newPage(); await otherVisitor.goto("/");
    await expect(otherVisitor.getByRole("button", { name: /^显示模式：/ })).toHaveAttribute("data-mode", "system");
    await guest.addCookies([{ name: colorModeCookie, value: "invalid-mode", url: process.env.CMS_TEST_BASE_URL! }]);
    await otherVisitor.reload(); await expect(otherVisitor.locator("html")).toHaveAttribute("data-color-mode", "system"); await otherVisitor.close();
    await page.goto(`/posts/${draft.slug}`);
    await page.getByLabel("你的想法", { exact: true }).fill("尚未提交的评论");
    await setMode(chooser, "light"); await expect(page.getByLabel("你的想法", { exact: true })).toHaveValue("尚未提交的评论");
    const noScript = await browser.newContext({ baseURL: process.env.CMS_TEST_BASE_URL, javaScriptEnabled: false, colorScheme: "dark", ignoreHTTPSErrors: process.env.CMS_TEST_SELF_SIGNED === "1" });
    try {
      const reader = await noScript.newPage();
      await reader.goto(`/posts/${draft.slug}`);
      expect(await reader.locator("html").getAttribute("data-color-mode")).toBe("system");
      const active = original.themes.find(theme => theme.id === original.activeThemeId)!;
      expect(hex(await reader.locator(".public-site").evaluate(el => getComputedStyle(el).backgroundColor))).toBe((themeStyle({ themeId: active.id, options: active.options }, "dark") as Record<string, string>)["--bg"].toLowerCase());
      await expect(reader.locator("#article-body")).toContainText("显示模式正文");
      await noScript.addCookies([{ name: colorModeCookie, value: "light", url: process.env.CMS_TEST_BASE_URL! }]);
      await reader.reload(); expect(await reader.locator("html").getAttribute("data-color-mode")).toBe("light");
      expect(hex(await reader.locator(".public-site").evaluate(el => getComputedStyle(el).backgroundColor))).toBe((themeStyle({ themeId: active.id, options: active.options }, "light") as Record<string, string>)["--bg"].toLowerCase());
    } finally { await noScript.close(); }
    await page.goto("/admin/themes");
    await expect(chooser).toHaveCount(0);
    expect(await page.locator(".admin-layout").evaluate(el => getComputedStyle(el).backgroundColor)).toBe("rgb(246, 247, 250)");
    expect(await api("admin/themes")).toEqual(original); expect(errors).toEqual([]);
  } finally {
    await guest.close();
    const current = await api<Content>(`admin/contents/${draft.id}`);
    await api(`admin/contents/${draft.id}`, { version: current.version }, "DELETE");
  }
});
