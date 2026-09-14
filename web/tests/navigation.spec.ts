import { fillCaptcha } from "./login";
import { test, expect } from "@playwright/test";
import fs from "node:fs";

if (!process.env.CMS_TEST_BASE_URL || !process.env.CMS_TEST_CREDENTIALS_PATH)
  throw new Error("请通过 python tests/docker_smoke.py 在独立测试站点运行浏览器验收。");
const credentials = JSON.parse(fs.readFileSync(process.env.CMS_TEST_CREDENTIALS_PATH, "utf8").replace(/^\uFEFF/, ""));

test("typed multilevel navigation, keyboard disclosure, previews and protected editing", async ({ page }) => {
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
  const stamp = Date.now().toString(36);
  const doc = { kind: "post", slug: "nav-post-" + stamp, title: "导航验收文章", summary: "多级导航内容", html: "<p>导航资源正文</p>", coverId: "", categoryId: "", tagIds: [], version: 0 };
  const post = await api("admin/contents", doc);
  await api(`admin/contents/${post.id}/publish`, { version: post.version });
  const single = await api("admin/contents", { ...doc, kind: "page", slug: "nav-page-" + stamp, title: "导航验收页面" });
  await api(`admin/contents/${single.id}/publish`, { version: single.version });
  const category = await api("admin/taxonomy", { kind: "category", name: "导航验收分类", slug: "nav-category-" + stamp });
  const tag = await api("admin/taxonomy", { kind: "tag", name: "导航验收标签", slug: "nav-tag-" + stamp });
  const originalTheme = await api("admin/themes");
  await page.goto("/admin/menu");
  await page.getByLabel("名称", { exact: true }).fill("内容导航");
  await page.getByLabel("链接", { exact: true }).fill("#");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "菜单项已保存" })).toBeVisible();
  const root = (await api("admin/menu")).find((x: any) => x.label === "内容导航");
  const created: any[] = [root];
  for (const [type, target, parent, order] of [["post", post, root, 1], ["page", single, root, 2], ["tag", tag, root, 3]] as const) {
    await page.getByRole("button", { name: "新增子菜单 " + parent.label, exact: true }).click();
    await expect(page.getByLabel("上级菜单项", { exact: true })).toHaveValue(parent.id);
    await page.getByLabel("类型", { exact: true }).selectOption(type);
    const typeName = type === "post" ? "文章" : type === "page" ? "自定义页面" : "标签";
    await page.getByLabel("搜索" + typeName, { exact: true }).fill("导航验收");
    await page.getByLabel("选择" + typeName, { exact: true }).selectOption(target.id);
    await expect(page.getByLabel("名称", { exact: true })).toHaveValue(target.title || target.name);
    await expect(page.getByLabel("名称", { exact: true })).toHaveAttribute("readonly", "");
    await page.getByLabel("排序", { exact: true }).fill(String(order));
    if (type === "tag") await page.getByLabel("打开方式", { exact: true }).selectOption("new");
    if (type === "post") {
      await page.route("**/api/v1/admin/menu", route => route.request().method() === "POST" ? route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ code: "TEST", message: "菜单暂时无法保存", traceId: "menu-proof" }) }) : route.continue(), { times: 1 });
      await page.getByRole("button", { name: "保存", exact: true }).click();
      await expect(page.getByRole("alert").filter({ hasText: "menu-proof" })).toBeVisible();
      await expect(page.getByLabel("选择文章", { exact: true })).toHaveValue(post.id);
    }
    await page.getByRole("button", { name: "保存", exact: true }).click();
    await expect(page.getByRole("status").filter({ hasText: "菜单项已保存" })).toBeVisible();
    created.push((await api("admin/menu")).find((x: any) => x.targetId === target.id));
  }
  await page.getByRole("button", { name: "新增子菜单 " + post.title, exact: true }).click();
  await page.getByLabel("类型", { exact: true }).selectOption("category");
  await page.getByLabel("选择分类", { exact: true }).selectOption(category.id);
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "菜单项已保存" })).toBeVisible();
  created.push((await api("admin/menu")).find((x: any) => x.targetId === category.id));
  await page.getByRole("button", { name: "编辑 内容导航", exact: true }).click();
  expect(await page.getByLabel("上级菜单项", { exact: true }).locator("option").count()).toBe(1 + (await api("admin/menu")).length - created.length);
  await page.getByLabel("名称", { exact: true }).fill("冲突后保留的菜单输入");
  await api("admin/menu/" + root.id, { ...root, sort: 8 }, "PUT");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: "菜单已被其他管理员修改" })).toBeVisible();
  await expect(page.getByLabel("名称", { exact: true })).toHaveValue("冲突后保留的菜单输入");
  page.once("dialog", d => d.dismiss());
  await page.getByRole("button", { name: "新增菜单项", exact: true }).click();
  await expect(page.getByLabel("名称", { exact: true })).toHaveValue("冲突后保留的菜单输入");
  page.once("dialog", d => d.accept());
  await page.getByRole("button", { name: "取消", exact: true }).click();
  await page.reload();
  for (const width of [1440, 768, 375]) {
    await page.setViewportSize({ width, height: 960 });
    await expect(page.getByRole("button", { name: "编辑 内容导航", exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await page.screenshot({ path: `../artifacts/navigation-admin-${width}.png`, fullPage: true, animations: "disabled" });
    if (width === 375) expect(await page.locator(".sidebar").evaluate(el => el.getBoundingClientRect().right)).toBeLessThanOrEqual(0);
  }
  let state = await api("admin/themes");
  for (const theme of state.themes) {
    state = await api("admin/themes/active", { themeId: theme.id, options: theme.defaults, version: state.version }, "PUT");
    for (const width of [1440, 768, 375]) {
      await page.setViewportSize({ width, height: 960 });
      await page.goto("/");
      const nav = page.getByRole("navigation", { name: "网站导航", exact: true });
      const parent = nav.getByLabel("内容导航的子菜单", { exact: true });
      await expect(nav.getByRole("link", { name: post.title, exact: true })).not.toBeVisible();
      await parent.focus(); await page.keyboard.press("Enter");
      await expect(nav.getByRole("link", { name: post.title, exact: true })).toBeVisible();
      const firstChildBox = await nav.getByRole("link", { name: post.title, exact: true }).boundingBox();
      expect(firstChildBox!.x).toBeGreaterThanOrEqual(0);
      expect(firstChildBox!.x + firstChildBox!.width).toBeLessThanOrEqual(width);
      const nested = nav.getByLabel(post.title + "的子菜单", { exact: true });
      await nested.focus(); await page.keyboard.press("Space");
      await expect(nav.getByRole("link", { name: category.name, exact: true })).toBeVisible();
      const childBox = await nav.getByRole("link", { name: category.name, exact: true }).boundingBox();
      const controlBox = await nested.boundingBox();
      expect(childBox!.y).toBeGreaterThanOrEqual(controlBox!.y + controlBox!.height);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
      await page.screenshot({ path: `../artifacts/navigation-${theme.id}-${width}.png`, animations: "disabled" });
      await page.keyboard.press("Escape");
      await expect(nested).toBeFocused();
      await expect(nav.getByRole("link", { name: category.name, exact: true })).not.toBeVisible();
      await expect(nav.getByRole("link", { name: post.title, exact: true })).toBeVisible();
      // A dropdown may cover the headline; the footer provides a visible outside target in every layout.
      await page.locator(".site-footer").click({ position: { x: 4, y: 4 } });
      await expect(nav.getByRole("link", { name: post.title, exact: true })).not.toBeVisible();
    }
  }
  const html = await (await page.request.get("/", { headers: { "User-Agent": "Googlebot" } })).text();
  expect(html).toContain('href="/posts/' + post.slug + '"');
  expect(html).toContain('href="/category/' + category.slug + '"');
  await page.goto("/admin/themes/preview?themeId=paper");
  const previewNav = page.getByRole("navigation", { name: "网站导航", exact: true });
  await previewNav.getByLabel("内容导航的子菜单", { exact: true }).click();
  await expect(previewNav.getByRole("link", { name: single.title, exact: true })).toHaveAttribute("href", /\/admin\/themes\/preview\/pages\//);
  const popup = page.waitForEvent("popup");
  await previewNav.getByRole("link", { name: new RegExp(tag.name) }).click();
  const tab = await popup;
  await expect(tab).toHaveURL(/\/admin\/themes\/preview\/tag\//);
  await expect(tab.locator(".public-site")).toHaveAttribute("data-theme", "paper");
  await tab.close();
  await page.goto("/admin/menu");
  await page.getByRole("button", { name: "删除 内容导航", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: "请先移动或删除子菜单" })).toBeVisible();
  for (const item of created.slice().reverse()) await api("admin/menu/" + item.id, undefined, "DELETE");
  state = await api("admin/themes");
  const original = originalTheme.themes.find((x: any) => x.id === originalTheme.activeThemeId);
  await api("admin/themes/active", { themeId: original.id, options: original.options, version: state.version }, "PUT");
  expect(errors).toEqual([]);
});
