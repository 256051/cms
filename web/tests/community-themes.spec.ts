import { test, expect } from "@playwright/test";
import fs from "node:fs";
import { fillCaptcha } from "./login";
import { contrast, communityThemes } from "../src/lib/theme";
import type { Content, Settings, ThemesView, ThemeView } from "../src/lib/types";

if (!process.env.CMS_TEST_BASE_URL || !process.env.CMS_TEST_CREDENTIALS_PATH)
  throw new Error("请通过 python tests/docker_smoke.py 在独立测试站点运行浏览器验收。");
const credentials = JSON.parse(fs.readFileSync(process.env.CMS_TEST_CREDENTIALS_PATH, "utf8").replace(/^\uFEFF/, ""));

test("community themes: unsaved previews, article directories and reading without JavaScript", async ({ page, context, browser }) => {
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
    const token = (await (await page.request.get("/api/v1/auth/csrf")).json()).data.token;
    const response = await page.request.fetch("/api/v1/" + route, { method, data, headers: { "X-CSRF-TOKEN": token } });
    expect(response.ok(), `${method} ${route}: ${response.status()}`).toBeTruthy();
    return (await response.json()).data;
  }
  const original = await api<ThemesView>("admin/themes");
  const originalSite = await api<Settings>("admin/settings");
  const definitions = communityThemes.map(({ id, name }) => {
    const definition = original.themes.find(theme => theme.id === id);
    expect(definition?.name).toMatch(new RegExp(`^${name} · `));
    return definition!;
  });
  async function activate(id: string, options: typeof definitions[number]["options"]) {
    const current = await api<ThemesView>("admin/themes");
    return api<ThemesView>("admin/themes/active", { themeId: id, options, version: current.version }, "PUT");
  }
  const reading = await context.newPage();
  reading.on("pageerror", error => errors.push(error.message));
  const noJavaScript = await browser.newContext({
    baseURL: process.env.CMS_TEST_BASE_URL,
    javaScriptEnabled: false,
    ignoreHTTPSErrors: process.env.CMS_TEST_SELF_SIGNED === "1",
  });
  const guest = await noJavaScript.newPage();
  const created: Content[] = [];
  const stamp = "community-theme-" + Date.now().toString(36);
  const marker = "社区主题正文在关闭脚本后仍可阅读 " + stamp;
  const paragraphs = Array.from({ length: 8 }, (_, index) => `<p>第 ${index + 1} 段阅读内容。${"为重复标题和移动端目录定位留出真实的文章阅读距离。".repeat(8)}</p>`).join("");
  async function publish(suffix: string, html: string) {
    const draft = await api<Content>("admin/contents", {
      kind: "post", slug: `${stamp}-${suffix}`, title: `${stamp} ${suffix}`,
      summary: "社区主题独立浏览器验收", html, coverId: "", categoryId: "", tagIds: [], version: 0,
    });
    created.push(draft);
    return api<Content>(`admin/contents/${draft.id}/publish`, { version: draft.version });
  }

  try {
    if (!originalSite.commentsEnabled)
      await api("admin/settings", { ...originalSite, commentsEnabled: true }, "PUT");
    const article = await publish("headings", `<p>${marker}</p><h2>重复章节</h2>${paragraphs}<h3>重复小节</h3>${paragraphs}<h2>重复章节</h2>${paragraphs}<h3>重复小节</h3>${paragraphs}<h2> </h2><h3><br></h3>`);
    const noHeadings = await publish("no-headings", "<p>只有正文，没有可用的章节标题。</p><h2> </h2><h3><br></h3>");
    await page.goto("/admin/themes");
    await expect(page.getByRole("heading", { name: "主题外观", exact: true })).toBeVisible();

    for (const [index, definition] of definitions.entries()) {
      if (index > 0) page.once("dialog", dialog => dialog.accept());
      await page.getByRole("button", { name: `配置 ${definition.name}`, exact: true }).click();
      await expect(page.getByRole("heading", { name: `${definition.name} · 外观设置`, exact: true })).toBeFocused();
      const previewTitle = `未保存预览 ${definition.id} ${stamp}`;
      await page.getByLabel("首页标题", { exact: true }).fill(previewTitle);
      const publicBefore = await api<ThemeView>("public/theme");
      const stateBefore = await api<ThemesView>("admin/themes");
      const popup = page.waitForEvent("popup");
      await page.getByRole("link", { name: "预览主题", exact: true }).click();
      const preview = await popup;
      preview.on("pageerror", error => errors.push(error.message));
      try {
        await expect(preview.getByRole("heading", { name: previewTitle, exact: true })).toBeVisible();
        await expect(preview.locator(".public-site")).toHaveAttribute("data-theme", definition.id);
        expect(await api("public/theme")).toEqual(publicBefore);
        expect(await api("admin/themes")).toEqual(stateBefore);
        const previewHome = preview.url();
        const previewArticle = new URL(previewHome);
        previewArticle.pathname = "/admin/themes/preview/posts/" + article.slug;
        await preview.goto(previewArticle.toString());
        await expect(preview.locator("#article-body")).toContainText(marker);
        await expect(preview.getByRole("button", { name: "提交评论", exact: true })).toBeDisabled();
        await expect(preview.getByRole("navigation", { name: "本文目录", exact: true }).getByRole("link")).toHaveCount(4);

        // A visitor's active theme can change while this unsaved preview keeps its own configuration.
        const other = definitions[(index + 1) % definitions.length];
        await activate(other.id, other.options);
        expect((await api<ThemeView>("public/theme")).themeId).toBe(other.id);
        await preview.reload();
        await expect(preview.locator(".public-site")).toHaveAttribute("data-theme", definition.id);
        await expect(preview.getByRole("button", { name: "提交评论", exact: true })).toBeDisabled();
        await preview.goto(previewHome);
        await expect(preview.getByRole("heading", { name: previewTitle, exact: true })).toBeVisible();
        expect((await api<ThemeView>("public/theme")).options.heroTitle).not.toBe(previewTitle);
      } finally {
        await preview.close();
      }

      await activate(definition.id, definition.defaults);
      for (const width of [375, 1440]) {
        await reading.setViewportSize({ width, height: 960 });
        await reading.goto("/posts/" + article.slug);
        const body = reading.locator("#article-body");
        await expect(body).toContainText(marker);
        const skip = reading.getByRole("link", { name: "跳到正文", exact: true });
        await skip.focus();
        await expect(skip).toBeVisible();
        const colors = await skip.evaluate(element => [getComputedStyle(element).color, getComputedStyle(element).backgroundColor]);
        const hex = (color: string) => "#" + color.match(/\d+/g)!.slice(0, 3).map(value => Number(value).toString(16).padStart(2, "0")).join("");
        expect(contrast(hex(colors[0]), hex(colors[1]))).toBeGreaterThanOrEqual(4.5);
        if (width === 375 && await reading.locator(".theme-sidebar").count() > 0) {
          expect(await reading.evaluate(() => {
            const main = document.getElementById("main")!;
            const sidebar = document.querySelector(".theme-sidebar")!;
            return !!(main.compareDocumentPosition(sidebar) & Node.DOCUMENT_POSITION_FOLLOWING)
              && sidebar.getBoundingClientRect().top >= main.getBoundingClientRect().bottom;
          })).toBe(true);
        }
        const toc = reading.getByRole("navigation", { name: "本文目录", exact: true });
        const links = toc.getByRole("link");
        // Heading IDs and the directory appear after hydration; duplicate text must not share an anchor.
        await expect(links).toHaveCount(4);
        const headings = await body.locator("h2, h3").evaluateAll(elements => elements
          .filter(element => element.textContent?.trim())
          .map(element => ({ id: element.id, text: element.textContent!.trim() })));
        expect(headings.map(heading => heading.text)).toEqual(["重复章节", "重复小节", "重复章节", "重复小节"]);
        expect(headings.every(heading => heading.id.length > 0)).toBe(true);
        expect(new Set(headings.map(heading => heading.id)).size).toBe(4);
        for (const [position, heading] of headings.entries())
          await expect(links.nth(position)).toHaveAttribute("href", "#" + encodeURIComponent(heading.id));
        expect(await reading.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);

        const summary = toc.locator("summary");
        await expect(summary).toHaveText("本文目录");
        await summary.click();
        await expect(links.last()).not.toBeVisible();
        await summary.press("Enter");
        await expect(links.last()).toBeVisible();
        await links.last().click();
        await expect.poll(() => new URL(reading.url()).hash).toBe("#" + encodeURIComponent(headings[3].id));
        await expect.poll(() => reading.evaluate(id => {
          const target = document.getElementById(id);
          if (!target) return false;
          const bounds = target.getBoundingClientRect();
          return bounds.top >= -1 && bounds.top < innerHeight;
        }, headings[3].id)).toBe(true);
        expect(await reading.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);

        await reading.goto("/posts/" + noHeadings.slug);
        await expect(reading.locator("#article-body")).toContainText("只有正文，没有可用的章节标题。");
        await reading.waitForLoadState("networkidle");
        await expect(reading.getByRole("navigation", { name: "本文目录", exact: true })).toHaveCount(0);
      }

      const response = await guest.goto("/posts/" + article.slug);
      expect(response?.status()).toBe(200);
      const html = await response!.text();
      expect(html).toContain(marker);
      expect(html).toContain(`data-theme="${definition.id}"`);
      await expect(guest.locator("#article-body")).toContainText(marker);
      await expect(guest.locator(".public-site")).toHaveAttribute("data-theme", definition.id);
    }
    expect(errors).toEqual([]);
  } finally {
    // This suite owns only its prefixed content and restores every theme profile it touched.
    for (const definition of definitions) await activate(definition.id, definition.options);
    const active = original.themes.find(theme => theme.id === original.activeThemeId)!;
    await activate(active.id, active.options);
    if (!originalSite.commentsEnabled) {
      const currentSite = await api<Settings>("admin/settings");
      await api("admin/settings", { ...originalSite, version: currentSite.version }, "PUT");
    }
    for (const content of created) {
      const current = await api<Content>("admin/contents/" + content.id);
      await api("admin/contents/" + content.id, { version: current.version }, "DELETE");
    }
    await reading.close();
    await noJavaScript.close();
  }
});
