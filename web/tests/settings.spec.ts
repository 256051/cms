import { fillCaptcha } from "./login";
import { test, expect } from "@playwright/test";
import fs from "node:fs";

if (!process.env.CMS_TEST_BASE_URL || !process.env.CMS_TEST_CREDENTIALS_PATH)
  throw new Error("请通过 tests/docker_smoke.py 在独立测试站点验收。");
const credentials = JSON.parse(fs.readFileSync(process.env.CMS_TEST_CREDENTIALS_PATH, "utf8").replace(/^\uFEFF/, ""));

test("site settings groups, protected saves, public metadata, pagination and comment policies", async ({ page, browser }) => {
  test.setTimeout(180_000);
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
  const before = await api("admin/settings"), themesBefore = await api("admin/themes");
  const save = async (patch: object) => api("admin/settings", { ...await api("admin/settings"), ...patch }, "PUT");
  const stamp = Date.now().toString(36);
  const category = await api("admin/taxonomy", { kind: "category", name: "设置验收分类", slug: "settings-cat-" + stamp });
  const tag = await api("admin/taxonomy", { kind: "tag", name: "设置验收标签", slug: "settings-tag-" + stamp });
  let post: any;
  for (let i = 0; i < 6; i++) {
    post = await api("admin/contents", { kind: "post", title: "设置验收文章 " + i, slug: "settings-" + stamp + "-" + i, summary: "设置验收摘要", html: "<p>设置生效后的正文。</p>", coverId: "", categoryId: category.id, tagIds: [tag.id], version: 0 });
    await api(`admin/contents/${post.id}/publish`, { version: post.version });
  }
  const csrf = (await api("auth/csrf")).token;
  const iconResponse = await page.request.post("/api/v1/admin/assets", { headers: { "X-CSRF-TOKEN": csrf }, multipart: { file: { name: "favicon-settings.png", mimeType: "image/png", buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a0foAAAAASUVORK5CYII=", "base64") } } });
  expect(iconResponse.ok()).toBeTruthy(); const icon = (await iconResponse.json()).data;
  await page.goto("/admin/settings");
  await page.getByLabel("站点名称", { exact: true }).fill("慢读 · 内容站");
  await page.getByLabel("站点副标题", { exact: true }).fill("记录思考，分享日常");
  await page.getByRole("textbox", { name: "站点介绍", exact: true }).fill("站点设置验收介绍。");
  await page.getByLabel("浏览器图标 Favicon", { exact: true }).selectOption(icon.id);
  await page.getByLabel("内容语言", { exact: true }).selectOption("en");
  for (const [label, size] of [["首页文章条数", 2], ["分类页文章条数", 3], ["标签页文章条数", 4], ["搜索结果条数", 5]] as const)
    await page.getByLabel(label, { exact: true }).fill(String(size));
  await page.getByLabel("屏蔽搜索引擎收录", { exact: true }).check();
  await page.getByRole("textbox", { name: "页脚文字", exact: true }).fill("© 2026 慢读内容站\n记录每一个值得分享的瞬间。");
  await page.route("**/api/v1/admin/settings", route => route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ code: "TEST", message: "保存暂不可用", traceId: "settings-proof" }) }), { times: 1 });
  await page.getByRole("button", { name: "保存设置", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: "settings-proof" })).toBeVisible();
  await expect(page.getByLabel("站点副标题", { exact: true })).toHaveValue("记录思考，分享日常");
  await page.getByRole("button", { name: "保存设置", exact: true }).click();
  await expect(page.getByText("站点设置已更新。", { exact: true })).toBeVisible();
  const firstVersion = (await api("admin/settings")).version;
  await page.getByLabel("关键词", { exact: true }).fill("阅读,生活");
  await page.getByRole("button", { name: "保存设置", exact: true }).click();
  await expect(page.getByText("站点设置已更新。", { exact: true })).toBeVisible();
  expect((await api("admin/settings")).version).toBe(firstVersion + 1);
  for (const width of [1440, 768, 375]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.evaluate(() => window.scrollTo(0, 0));
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await page.screenshot({ path: `../artifacts/settings-admin-${width}.png`, fullPage: true, animations: "disabled" });
  }
  const sectionLink = page.getByRole("navigation", { name: "设置分组" }).getByRole("link", { name: "评论设置" });
  await sectionLink.focus(); await page.keyboard.press("Enter");
  await expect(page.locator("#settings-comments")).toBeFocused();
  await page.getByLabel("站点副标题", { exact: true }).fill("冲突后保留的副标题");
  await save({ subtitle: "另一位管理员的修改" });
  await page.getByRole("button", { name: "保存设置", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: "已被其他管理员修改" })).toBeVisible();
  await expect(page.getByLabel("站点副标题", { exact: true })).toHaveValue("冲突后保留的副标题");
  page.once("dialog", d => d.dismiss());
  await page.reload({ timeout: 3_000 }).catch(() => {});
  await expect(page.getByLabel("站点副标题", { exact: true })).toHaveValue("冲突后保留的副标题");
  page.once("dialog", d => d.accept());
  await page.reload();
  await save({ subtitle: "记录思考，分享日常" });

  let themes = await api("admin/themes");
  for (const theme of themes.themes) {
    themes = await api("admin/themes/active", { themeId: theme.id, options: theme.options, version: themes.version }, "PUT");
    for (const width of [375, 768, 1440]) {
      await page.setViewportSize({ width, height: 960 }); await page.goto("/");
      await expect(page.locator("html")).toHaveAttribute("lang", "en");
      await expect(page.locator(".brand-copy")).toContainText("记录思考，分享日常");
      await expect(page.locator(".article-card")).toHaveCount(2);
      await expect(page.locator(".site-footer-text")).toContainText("© 2026 慢读内容站");
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
      await page.screenshot({ path: `../artifacts/settings-${theme.id}-${width}.png`, fullPage: true, animations: "disabled" });
    }
  }
  for (const [path, count] of [[`/category/${category.slug}`, 3], [`/tag/${tag.slug}`, 4], ["/search?q=设置验收", 5], ["/search", 5]] as const) {
    await page.goto(path); await expect(page.locator(".article-card")).toHaveCount(count);
  }
  await page.goto("/");
  await page.getByRole("navigation", { name: "分页", exact: true }).getByRole("link", { name: "下一页" }).click();
  await expect(page).toHaveURL(/page=2/); await expect(page.locator(".article-card")).toHaveCount(2);
  for (const path of ["/", `/posts/${post.slug}`, `/category/${category.slug}`, `/tag/${tag.slug}`, "/search"]) {
    const html = await (await page.request.get(path, { headers: { "User-Agent": "Googlebot" } })).text();
    expect(html).toContain('name="robots" content="noindex"');
    expect(html).toContain('href="/media/' + icon.id + '"');
    expect(html).toContain("© 2026 慢读内容站");
  }
  expect(await (await page.request.get("/robots.txt")).text()).toContain("Disallow: /");
  expect(await (await page.request.get("/sitemap.xml")).text()).not.toContain("<url>");
  await save({ blockSearchEngines: false });
  expect(await (await page.request.get("/sitemap.xml")).text()).toContain(`/posts/${post.slug}`);

  const guestContext = await browser.newContext({ baseURL: process.env.CMS_TEST_BASE_URL, ignoreHTTPSErrors: true });
  const guest = await guestContext.newPage();
  await guest.goto(`/posts/${post.slug}`);
  await guest.getByLabel("称呼", { exact: true }).fill("设置验收访客");
  await guest.getByLabel("你的想法", { exact: true }).fill("先审核的评论");
  await guest.getByRole("button", { name: "提交评论", exact: true }).click();
  await expect(guest.getByRole("status").filter({ hasText: "已提交，等待审核。" })).toBeVisible();
  await save({ requireCommentApproval: false });
  await guest.reload();
  await guest.getByLabel("称呼", { exact: true }).fill("设置验收访客");
  await guest.getByLabel("你的想法", { exact: true }).fill("直接公开的评论");
  await guest.getByRole("button", { name: "提交评论", exact: true }).click();
  await expect(guest.locator(".comment").filter({ hasText: "直接公开的评论" })).toBeVisible();
  await expect(guest.locator(".comment").filter({ hasText: "先审核的评论" })).toHaveCount(0);
  await save({ commentsRequireLogin: true }); await guest.reload();
  await expect(guest.getByRole("link", { name: "登录已有账号" })).toBeVisible();
  await expect(guest.getByRole("button", { name: "提交评论", exact: true })).toBeDisabled();
  await page.goto(`/posts/${post.slug}`);
  await expect(page.getByText("评论署名：管理员", { exact: true })).toBeVisible();
  await page.getByLabel("你的想法", { exact: true }).fill("登录账号的评论");
  await page.getByRole("button", { name: "提交评论", exact: true }).click();
  await expect(page.locator(".comment").filter({ hasText: "登录账号的评论" })).toBeVisible();
  await save({ commentsEnabled: false }); await guest.reload();
  await expect(guest.locator(".comments")).toHaveCount(0);
  await guestContext.close();
  const { version: _version, ...originalOptions } = before;
  await save(originalOptions);
  themes = await api("admin/themes");
  const originalTheme = themesBefore.themes.find((x: any) => x.id === themesBefore.activeThemeId);
  await api("admin/themes/active", { themeId: originalTheme.id, options: originalTheme.options, version: themes.version }, "PUT");
  expect(errors).toEqual([]);
});
