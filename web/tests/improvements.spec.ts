import { fillCaptcha } from "./login";
import { test, expect, type Page } from "@playwright/test";
import fs from "node:fs";

if (!process.env.CMS_TEST_BASE_URL || !process.env.CMS_TEST_CREDENTIALS_PATH)
  throw new Error("请通过 python tests/docker_smoke.py 在独立测试站点运行浏览器验收。");

const credentials = JSON.parse(fs.readFileSync(process.env.CMS_TEST_CREDENTIALS_PATH, "utf8").replace(/^\uFEFF/, ""));

async function confirm(page: Page, action: () => Promise<unknown>, accept = false) {
  const dialog = page.waitForEvent("dialog");
  const pending = action().catch(() => null);
  const popup = await dialog;
  if (accept) await popup.accept(); else await popup.dismiss();
  await pending;
}

test("unsaved forms, live SEO, loading recovery, keyboard navigation and audit objects", async ({ page, request }) => {
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
    expect(response.ok()).toBeTruthy();
    return (await response.json()).data;
  }
  const stamp = Date.now().toString(36);
  const category = await api("admin/taxonomy", { kind: "category", name: "验收分类", slug: "category-" + stamp });
  const tag = await api("admin/taxonomy", { kind: "tag", name: "验收标签", slug: "tag-" + stamp });
  const input = { kind: "post", title: "保护与 SEO 验收", slug: "improvement-" + stamp, summary: "", html: "<p>已保存的正文</p>", coverId: "", categoryId: category.id, tagIds: [tag.id], version: 0 };
  const post = await api("admin/contents", input);
  await api(`admin/contents/${post.id}/publish`, { version: post.version });
  const standalone = await api("admin/contents", { ...input, kind: "page", title: "独立页面验收", slug: "page-" + stamp });
  await api(`admin/contents/${standalone.id}/publish`, { version: standalone.version });
  const editUrl = `/admin/posts/${post.id}`;

  // Native page history, navigation links, refresh and tab close must preserve canceled edits.
  await page.goto("/admin/posts");
  await page.getByRole("link", { name: new RegExp(input.title) }).first().click();
  await page.getByLabel("标题", { exact: true }).fill("未保存的改动");
  await confirm(page, () => page.goBack({ timeout: 3_000 }));
  await expect(page).toHaveURL(new RegExp(editUrl + "$"));
  await expect(page.getByLabel("标题", { exact: true })).toHaveValue("未保存的改动");
  await confirm(page, () => page.getByRole("link", { name: "评论", exact: true }).click({ timeout: 3_000 }));
  await confirm(page, () => page.reload({ timeout: 3_000 }));
  await confirm(page, () => page.close({ runBeforeUnload: true }));
  expect(page.isClosed()).toBe(false);
  await confirm(page, () => page.goBack(), true);
  await expect(page).toHaveURL(/\/admin\/posts$/);
  await page.goForward();
  await expect(page.getByLabel("标题", { exact: true })).toHaveValue(input.title);
  await page.getByRole("link", { name: "站点设置", exact: true }).click();
  await page.goBack();
  await page.getByLabel("标题", { exact: true }).fill("前进保护");
  await confirm(page, () => page.goForward({ timeout: 3_000 }));
  await expect(page.getByLabel("标题", { exact: true })).toHaveValue("前进保护");
  await confirm(page, () => page.goForward(), true);

  // All administrative edit forms register dirty state, including fields outside content editing.
  const forms: [string, string, string?][] = [
    ["settings", "站点名称"], ["taxonomy", "名称"], ["menu", "名称"],
    ["users", "姓名", "添加成员"], ["password", "当前密码"],
  ];
  for (const [section, label, open] of forms) {
    await page.goto("/admin/" + section);
    if (open) await page.getByRole("button", { name: open, exact: true }).click();
    await page.getByLabel(label, { exact: true }).fill("尚未保存");
    await confirm(page, () => page.getByRole("link", { name: "文章", exact: true }).click({ timeout: 3_000 }));
    await expect(page).toHaveURL(new RegExp(`/admin/${section}$`));
    await confirm(page, () => page.getByRole("link", { name: "文章", exact: true }).click(), true);
    await expect(page).toHaveURL(/\/admin\/posts$/);
  }

  await page.goto("/admin/taxonomy");
  await page.getByRole("button", { name: "编辑 " + category.name, exact: true }).click();
  await page.getByLabel("名称", { exact: true }).fill("分类未保存");
  await expect(page.getByRole("button", { name: "编辑 " + category.name, exact: true })).toBeDisabled();
  await confirm(page, () => page.getByRole("button", { name: "编辑 " + tag.name, exact: true }).click());
  await expect(page.getByLabel("名称", { exact: true })).toHaveValue("分类未保存");
  await confirm(page, () => page.getByRole("button", { name: "编辑 " + tag.name, exact: true }).click(), true);
  await expect(page.getByLabel("名称", { exact: true })).toHaveValue(tag.name);
  await page.getByLabel("名称", { exact: true }).fill("标签未保存");
  await confirm(page, () => page.getByRole("button", { name: "取消", exact: true }).click());
  await expect(page.getByLabel("名称", { exact: true })).toHaveValue("标签未保存");
  await confirm(page, () => page.getByRole("button", { name: "取消", exact: true }).click(), true);
  await expect(page.getByLabel("名称", { exact: true })).toHaveValue("");

  // Settings are saved through the UI, then checked in server HTML without client rendering.
  const before = await api("admin/settings");
  await page.goto("/admin/settings");
  const siteTitle = "全站 SEO 验收站 " + stamp;
  await page.getByLabel("站点名称", { exact: true }).fill(siteTitle);
  await page.getByRole("textbox", { name: "站点介绍", exact: true }).fill("统一站点介绍，用于没有摘要的页面。");
  await page.getByLabel("关键词", { exact: true }).fill("测试,站点,统一配置");
  await page.route("**/api/v1/admin/settings", route => route.fulfill({
    status: 503, contentType: "application/json",
    body: JSON.stringify({ code: "UNAVAILABLE", message: "模拟保存失败", data: null, traceId: "trace-save-proof" }),
  }), { times: 1 });
  await page.getByRole("button", { name: "保存设置", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: "trace-save-proof" })).toBeVisible();
  await confirm(page, () => page.getByRole("link", { name: "文章", exact: true }).click({ timeout: 3_000 }));
  await expect(page.getByLabel("站点名称", { exact: true })).toHaveValue(siteTitle);
  await page.getByRole("button", { name: "保存设置", exact: true }).click();
  await expect(page.getByText("站点设置已更新。", { exact: true })).toBeVisible();
  await page.getByRole("link", { name: "文章", exact: true }).click(); // no dialog after successful save
  for (const url of ["/", `/posts/${post.slug}`, `/pages/${standalone.slug}`, `/category/${category.slug}`, `/tag/${tag.slug}`, "/search?q=验收"]) {
    const response = await request.get(url, { headers: { "User-Agent": "Googlebot" } });
    expect(response.status()).toBe(200);
    const html = await response.text();
    expect(html.match(/<title>(.*?)<\/title>/s)?.[1]).toContain(siteTitle);
    expect(html.match(/<meta name="description" content="([^"]*)"/s)?.[1]).toContain("统一站点介绍");
    expect(html.match(/<meta name="keywords" content="([^"]*)"/s)?.[1]).toBe("测试,站点,统一配置");
    if (!url.startsWith("/search")) expect(html).toContain('rel="canonical"');
    else expect(html).toContain('name="robots" content="noindex"');
  }
  const sitemap = await (await request.get("/sitemap.xml")).text();
  expect(sitemap).toContain(`/category/${category.slug}`);
  expect(sitemap).toContain(`/tag/${tag.slug}`);
  await api("admin/settings", { ...before, version: (await api("admin/settings")).version }, "PUT");

  await page.route("**/api/v1/auth/me", route => route.fulfill({
    status: 503, contentType: "application/json",
    body: JSON.stringify({ code: "UNAVAILABLE", message: "账号暂时读取失败", data: null, traceId: "trace-auth-proof" }),
  }), { times: 1 });
  await page.goto("/admin");
  await expect(page.getByRole("alert").filter({ hasText: "trace-auth-proof" })).toBeVisible();
  await page.getByRole("button", { name: "重新加载", exact: true }).click();
  await expect(page.getByRole("heading", { name: /你好/ })).toBeVisible();

  // A failed load must show a trace ID and retry, never a false empty state.
  const screens: [string, string][] = [["posts", "contents?kind=post**"], ["assets", "assets?page=1"], ["taxonomy", "taxonomy"], ["menu", "menu"], ["comments", "comments?**"], ["settings", "settings"], ["users", "users"], ["audit", "audit?page=1"]];
  for (const [section, endpoint] of screens) {
    const pattern = "**/api/v1/admin/" + endpoint;
    let release: (() => void) | undefined;
    await page.route(pattern, async route => {
      await new Promise<void>(resolve => { release = resolve; });
      await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ code: "UNAVAILABLE", message: "模拟读取失败", data: null, traceId: "trace-loading-proof" }) });
    }, { times: 1 });
    await page.goto("/admin/" + section);
    await expect.poll(() => !!release).toBe(true);
    await expect(page.getByRole("status").filter({ hasText: "正在加载" })).toBeVisible();
    release!();
    await expect(page.getByRole("alert").filter({ hasText: "trace-loading-proof" })).toBeVisible();
    await expect(page.locator(".empty-state")).toHaveCount(0);
    await page.getByRole("button", { name: "重新加载", exact: true }).click();
    await expect(page.locator(".admin-main").getByRole("alert")).toHaveCount(0);
    await page.unroute(pattern);
  }

  // The navigation dialog traps focus, closes with Escape, and restores its trigger.
  await page.setViewportSize({ width: 375, height: 667 });
  await page.goto("/admin");
  const trigger = page.getByRole("button", { name: "打开导航", exact: true });
  await trigger.click();
  const dialog = page.getByRole("dialog", { name: "管理导航" });
  await expect(dialog).toBeVisible();
  const close = dialog.getByRole("button", { name: "关闭导航" });
  await expect(close).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(dialog.getByRole("link", { name: "修改密码" })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(close).toBeFocused();
  await page.screenshot({ path: "../artifacts/improvements-navigation.png", animations: "disabled" });
  await page.keyboard.press("Escape");
  await expect(trigger).toBeFocused();
  await expect(page.locator("#admin-navigation")).toHaveAttribute("inert", "");
  await page.screenshot({ path: "../artifacts/improvements-mobile.png", fullPage: true });
  await page.setViewportSize({ width: 1440, height: 1000 });

  await page.goto("/admin/audit");
  const row = page.getByRole("row").filter({ hasText: siteTitle });
  await expect(row.first()).toContainText("站点设置");
  await expect(row.first()).toContainText("site");
  await page.screenshot({ path: "../artifacts/improvements-audit.png", fullPage: true });
  await page.goto(editUrl);
  await page.getByLabel("标题", { exact: true }).fill("退出前未保存");
  await confirm(page, () => page.getByRole("button", { name: "退出登录", exact: true }).click());
  expect((await page.request.get("/api/v1/auth/me")).status()).toBe(200);
  await confirm(page, () => page.getByRole("button", { name: "退出登录", exact: true }).click(), true);
  await expect(page).toHaveURL(/\/admin\/login$/);
  expect((await page.request.get("/api/v1/auth/me")).status()).toBe(401);
  expect(errors).toEqual([]);
});
