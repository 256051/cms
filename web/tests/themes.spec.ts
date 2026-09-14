import { fillCaptcha, loginCaptcha } from "./login";
import { test, expect } from "@playwright/test";
import fs from "node:fs";
import { contrast, themeIds, themeStyle } from "../src/lib/theme";

if (!process.env.CMS_TEST_BASE_URL || !process.env.CMS_TEST_CREDENTIALS_PATH)
  throw new Error("请通过 python tests/docker_smoke.py 在独立测试站点运行浏览器验收。");
const credentials = JSON.parse(fs.readFileSync(process.env.CMS_TEST_CREDENTIALS_PATH, "utf8"));

test("seven themes, private previews, saved profiles, accessible colors and public HTML", async ({ page, request, context }) => {
  test.setTimeout(300_000);
  const errors: string[] = [];
  page.on("pageerror", e => errors.push(e.message));
  await page.goto("/admin/login");
  await page.getByLabel("账号", { exact: true }).fill(credentials.username);
  await page.getByLabel("密码", { exact: true }).fill(credentials.password);
  await fillCaptcha(page);
  await page.getByRole("button", { name: "登录工作台" }).click();
  await expect(page.getByRole("heading", { name: /你好/ })).toBeVisible();
  async function api(route: string, data?: unknown, method = data === undefined ? "GET" : "POST") {
    const token = (await (await page.request.get("/api/v1/auth/csrf")).json()).data.token;
    const response = await page.request.fetch("/api/v1/" + route, { method, data, headers: { "X-CSRF-TOKEN": token } });
    expect(response.ok()).toBeTruthy(); return (await response.json()).data;
  }
  const site = await api("admin/settings");
  await api("admin/settings", { ...site, title: "留白 · 内容站", description: "在日常里发现灵感，用文字分享值得收藏的想法。", keywords: "阅读,创作,生活" }, "PUT");
  const stamp = Date.now().toString(36);
  const category = await api("admin/taxonomy", { kind: "category", name: "阅读与创作", slug: "theme-category-" + stamp });
  const tag = await api("admin/taxonomy", { kind: "tag", name: "灵感", slug: "theme-tag-" + stamp });
  const art = await context.newPage();
  await art.setContent('<svg xmlns="http://www.w3.org/2000/svg" width="800" height="450" viewBox="0 0 800 450"><defs><linearGradient id="g"><stop stop-color="#c1d5cd"/><stop offset="1" stop-color="#e6ddd1"/></linearGradient></defs><rect width="800" height="450" fill="url(#g)"/><circle cx="600" cy="115" r="165" fill="#f5eee2"/><path d="M0 420 Q260 140 480 450M120 450 Q400 220 800 360" stroke="#7b948c" stroke-width="45" fill="none"/><rect x="290" y="80" width="180" height="260" rx="5" fill="#fbf8f0" transform="rotate(-8 380 210)"/><path d="M330 140h85m-90 30h110m-110 30h70" stroke="#91a49c" stroke-width="5"/></svg>');
  const coverBytes = await art.locator("svg").screenshot(); await art.close();
  const token = (await api("auth/csrf")).token;
  const uploaded = await page.request.post("/api/v1/admin/assets", { headers: { "X-CSRF-TOKEN": token }, multipart: { file: { name: "theme-editorial.png", mimeType: "image/png", buffer: coverBytes } } });
  expect(uploaded.ok()).toBeTruthy(); const cover = (await uploaded.json()).data;
  const titles = ["把日常写成值得阅读的故事", "好的设计，从留白开始", "在字里行间，寻找新的灵感"];
  const input = { kind: "post", title: titles[0], slug: "theme-" + stamp, summary: "让表达回归简单，为每一个值得记录的瞬间，留下一点空间。", html: '<h2>让想法慢慢生长</h2><p>主题展示正文，中文与 emoji 🎉。</p><blockquote>文字连接思想，也连接彼此。</blockquote><pre><code>Console.WriteLine("Hello CMS");</code></pre><table><tbody><tr><th>主题</th><th>内容</th></tr><tr><td>简洁</td><td>真实阅读</td></tr></tbody></table>', coverId: cover.id, categoryId: category.id, tagIds: [tag.id], version: 0 };
  let post: any;
  for (let i = 12; i >= 0; i--) {
    const doc = await api("admin/contents", { ...input, slug: input.slug + "-" + i, title: titles[i % 3] + (i > 2 ? ` · ${i}` : ""), coverId: i === 0 ? cover.id : "" });
    await api(`admin/contents/${doc.id}/publish`, { version: doc.version });
    if (i === 0) post = doc;
  }
  const independent = await api("admin/contents", { ...input, kind: "page", slug: "theme-about-" + stamp, title: "关于这个内容空间" });
  await api(`admin/contents/${independent.id}/publish`, { version: independent.version });
  const draft = await api("admin/contents", { ...input, slug: "theme-private-" + stamp, title: "未发布的秘密草稿" });
  await api("admin/menu", { label: "关于", url: "/pages/" + independent.slug, sort: 1 });

  await page.goto("/admin/themes");
  await expect(page.getByRole("heading", { name: "主题外观", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "配置 极简阅读", exact: true }).click();
  await expect(page.getByRole("heading", { name: "极简阅读 · 外观设置" })).toBeFocused();
  await page.getByLabel("首页标题", { exact: true }).fill("只在预览显示的标题");
  const original = await api("public/theme");
  const popup = page.waitForEvent("popup");
  await page.getByRole("link", { name: "预览主题", exact: true }).click();
  const preview = await popup;
  await expect(preview.getByRole("heading", { name: "只在预览显示的标题", exact: true })).toBeVisible();
  expect(await api("public/theme")).toEqual(original);
  const previewUrl = preview.url();
  const previewHtml = await (await page.request.get(previewUrl, { headers: { "User-Agent": "Googlebot" } })).text();
  expect(previewHtml).toContain('content="noindex, nofollow"');
  expect(previewHtml).not.toContain('rel="canonical"');
  await preview.getByRole("link", { name: titles[0], exact: true }).first().click();
  await expect(preview.locator(".public-site")).toHaveAttribute("data-theme", "paper");
  await expect(preview.getByRole("button", { name: "提交评论", exact: true })).toBeDisabled();
  await preview.getByRole("link", { name: "搜索", exact: true }).click();
  await preview.getByRole("textbox", { name: "搜索文章标题和摘要" }).fill("日常");
  await preview.getByRole("button", { name: "搜索", exact: true }).click();
  await expect(preview).toHaveURL(/\/admin\/themes\/preview\/search\?/);
  await expect(preview.locator(".public-site")).toHaveAttribute("data-theme", "paper");
  await preview.goto(previewUrl);
  await preview.getByRole("link", { name: "下一页", exact: true }).click();
  await expect(preview).toHaveURL(/page=2/);
  await expect(preview.locator(".public-site")).toHaveAttribute("data-theme", "paper");
  const privatePreview = new URL(previewUrl); privatePreview.pathname += "/posts/" + draft.slug;
  expect((await page.request.get(privatePreview.toString(), { headers: { "User-Agent": "Googlebot" } })).status()).toBe(404);
  expect((await request.get(previewUrl)).url()).toContain("/admin/login");
  const editor = { username: "themeeditor" + stamp, displayName: "主题权限验收", role: "Editor", enabled: true, password: credentials.password };
  await api("admin/users", editor);
  const guestToken = (await (await request.get("/api/v1/auth/csrf")).json()).data.token;
  expect((await request.post("/api/v1/auth/login", { data: { ...editor, ...await loginCaptcha(request) }, headers: { "X-CSRF-TOKEN": guestToken } })).ok()).toBeTruthy();
  const deniedPreview = await request.get(previewUrl, { maxRedirects: 0 });
  expect(deniedPreview.status()).toBe(307);
  expect(deniedPreview.headers().location).toBe("/admin");
  await preview.close();

  await page.route("**/api/v1/admin/themes/active", route => route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ code: "TEST", message: "主题应用暂时失败", traceId: "theme-proof" }) }), { times: 1 });
  await page.getByRole("button", { name: "保存并启用", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: "theme-proof" })).toBeVisible();
  page.once("dialog", d => d.dismiss());
  await page.getByRole("link", { name: "文章", exact: true }).click({ timeout: 3000 }).catch(() => null);
  await expect(page.getByLabel("首页标题", { exact: true })).toHaveValue("只在预览显示的标题");
  page.once("dialog", d => d.dismiss());
  await page.getByRole("button", { name: "配置 暗色科技", exact: true }).click();
  await expect(page.getByLabel("首页标题", { exact: true })).toHaveValue("只在预览显示的标题");
  await page.getByRole("button", { name: "保存并启用", exact: true }).click();
  await expect(page.getByText("已应用“极简阅读”，网站外观已更新。", { exact: true })).toBeVisible();
  expect((await api("public/theme")).options.heroTitle).toBe("只在预览显示的标题");
  const paperOptions = (await api("admin/themes")).themes.find((x: any) => x.id === "paper").options;

  let state = await api("admin/themes");
  expect(state.themes.map((x: any) => x.id)).toEqual([...themeIds]);
  for (const definition of state.themes) {
    state = await api("admin/themes/active", { themeId: definition.id, options: definition.defaults, version: state.version }, "PUT");
    for (const width of [375, 768, 1440]) {
      await page.setViewportSize({ width, height: 960 });
      for (const url of ["/", `/posts/${post.slug}`, `/pages/${independent.slug}`, `/category/${category.slug}`, `/tag/${tag.slug}`, "/search?q=日常", "/?page=2"]) {
        await page.goto(url);
        await expect(page.locator(".public-site")).toHaveAttribute("data-theme", definition.id);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
        if (definition.id === "midnight" && url.startsWith("/posts/")) expect(await page.locator(".prose th").first().evaluate(el => getComputedStyle(el).backgroundColor)).toBe("rgb(23, 43, 63)");
        if (url === "/" || url.startsWith("/posts/")) await page.screenshot({ path: `../artifacts/theme-${definition.id}-${url === "/" ? "home" : "article"}-${width}.png`, fullPage: true, animations: "disabled" });
        if (url === "/" && width === 1440) {
          await page.screenshot({ path: `../artifacts/theme-${definition.id}.png`, animations: "disabled" });
          if (process.env.CMS_CAPTURE_THEME_THUMBNAILS === "1") {
            fs.mkdirSync("public/themes", { recursive: true });
            await page.screenshot({ path: `public/themes/${definition.id}.png`, animations: "disabled" });
          }
        }
        if (definition.id === "magazine" && url === "/") await expect(page.locator(".featured-grid")).toHaveCount(1);
        if (url === "/?page=2") await expect(page.locator(".featured-grid")).toHaveCount(0);
      }
    }
    for (const url of ["/", `/posts/${post.slug}`, `/pages/${independent.slug}`, `/category/${category.slug}`, `/tag/${tag.slug}`, "/search?q=日常"]) {
      const response = await request.get(url, { headers: { "User-Agent": "Googlebot" } });
      expect(response.status()).toBe(200);
      const html = await response.text();
      expect(html).toContain(`data-theme="${definition.id}"`);
      expect(html.match(/<title>(.*?)<\/title>/s)?.[1]).toContain("留白 · 内容站");
      expect(html).toContain('name="description"');
      expect(html).toContain('name="keywords"');
      if (url.startsWith("/search")) expect(html).toContain('content="noindex"'); else expect(html).toContain('rel="canonical"');
      if (url.startsWith("/posts")) expect(html).toContain("主题展示正文，中文与 emoji");
    }
    for (const color of ["#FFFFFF", "#000000", "#FFFF00", "#777777", definition.defaults.accentColor]) {
      const styles = themeStyle({ themeId: definition.id, options: { ...definition.defaults, accentColor: color } }) as Record<string, string>;
      expect(contrast(color, styles["--theme-on-accent"])).toBeGreaterThanOrEqual(4.5);
      expect(contrast(styles["--blue"], styles["--surface"])).toBeGreaterThanOrEqual(4.5);
      expect(contrast(styles["--blue"], styles["--blue-soft"])).toBeGreaterThanOrEqual(4.5);
    }
    await page.goto("/search?q=theme-empty-" + stamp);
    await expect(page.getByRole("heading", { name: "这里还没有文章" })).toBeVisible();
  }
  state = await api("admin/themes/active", { themeId: "paper", options: paperOptions, version: state.version }, "PUT");
  await page.goto("/admin/themes");
  await page.getByRole("button", { name: "配置 极简阅读", exact: true }).click();
  await expect(page.getByLabel("首页标题", { exact: true })).toHaveValue("只在预览显示的标题");
  await page.getByRole("button", { name: "恢复默认", exact: true }).click();
  expect((await api("public/theme")).options.heroTitle).toBe("只在预览显示的标题");
  await page.getByRole("button", { name: "保存并应用", exact: true }).click();
  await expect(page.getByText("已应用“极简阅读”，网站外观已更新。", { exact: true })).toBeVisible();
  expect((await api("public/theme")).options.heroTitle).toBe("记录日常，认真阅读。");
  expect(await page.locator(".admin-layout").evaluate(el => getComputedStyle(el).backgroundColor)).toBe("rgb(246, 247, 250)");
  if (process.env.CMS_CAPTURE_THEME_THUMBNAILS !== "1") {
    for (const img of await page.locator(".theme-card > img").all()) expect(await img.evaluate((el: HTMLImageElement) => el.naturalWidth)).toBeGreaterThan(0);
    await page.evaluate(() => { (document.activeElement as HTMLElement)?.blur(); window.scrollTo(0, 0); });
    await page.screenshot({ path: "../artifacts/themes-admin.png", fullPage: true, animations: "disabled" });
  }
  for (const width of [375, 768]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await page.screenshot({ path: `../artifacts/themes-admin-${width}.png`, fullPage: true, animations: "disabled" });
  }
  await page.getByRole("heading", { name: "极简阅读 · 外观设置" }).focus();
  await page.keyboard.press("Tab");
  await expect(page.getByLabel("主色色值", { exact: true })).toBeFocused();
  await page.getByLabel("首页标题", { exact: true }).fill("并发冲突后保留的输入");
  state = await api("admin/themes");
  await api("admin/themes/active", { themeId: "classic", options: state.themes[0].defaults, version: state.version }, "PUT");
  await page.getByRole("button", { name: "保存并应用", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: "主题已被其他管理员修改" })).toBeVisible();
  await expect(page.getByLabel("首页标题", { exact: true })).toHaveValue("并发冲突后保留的输入");
  expect((await api("public/theme")).themeId).toBe("classic");
  const sitemap = await (await request.get("/sitemap.xml")).text();
  expect(sitemap).not.toContain("/admin/themes");
  expect(sitemap).toContain(`/posts/${post.slug}`);
  expect(await (await request.get("/robots.txt")).text()).toContain("Disallow: /admin");
  await api("admin/settings", { ...site, version: (await api("admin/settings")).version }, "PUT");
  expect(errors).toEqual([]);
});
