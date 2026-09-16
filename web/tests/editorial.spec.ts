import { test, expect } from "@playwright/test";
import fs from "node:fs";
import { randomUUID } from "node:crypto";
import { loginCaptcha } from "./login";

if (!process.env.CMS_TEST_BASE_URL || !process.env.CMS_TEST_CREDENTIALS_PATH) throw new Error("An isolated site is required.");
const credentials = JSON.parse(fs.readFileSync(process.env.CMS_TEST_CREDENTIALS_PATH, "utf8").replace(/^\uFEFF/, ""));

test("autosave, recovery, conflict copy, revision and trash controls", async ({ browser }) => {
  test.setTimeout(150000);
  const context = await browser.newContext({ baseURL: process.env.CMS_TEST_BASE_URL });
  let csrf = (await (await context.request.get("/api/v1/auth/csrf")).json()).data.token;
  const login = await context.request.post("/api/v1/auth/login", { headers: { "X-CSRF-TOKEN": csrf }, data: { ...credentials, ...await loginCaptcha(context.request) } });
  expect(login.ok(), await login.text()).toBeTruthy();
  csrf = (await (await context.request.get("/api/v1/auth/csrf")).json()).data.token;
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("dialog", dialog => void dialog.accept());
  await page.goto("/admin/posts/new");
  await page.getByLabel("标题", { exact: true }).fill("自动保存验收");
  await expect(page).toHaveURL(/\/admin\/posts\/[a-f0-9]{32}$/, { timeout: 15000 });
  await expect(page.getByRole("status").filter({ hasText: "最后保存" })).toBeVisible();
  const id = page.url().split("/").pop()!;
  const original = (await (await context.request.get(`/api/v1/admin/contents/${id}`)).json()).data;
  await page.route(`**/api/v1/admin/contents/${id}`, async route => {
    if (route.request().method() === "PUT") await route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ code: "TEST_FAILURE", message: "模拟保存失败", traceId: "test" }) });
    else await route.continue();
  });
  await page.getByLabel("标题", { exact: true }).fill("断网保留的草稿");
  await page.getByRole("button", { name: "保存草稿", exact: true }).click();
  await expect(page.getByText("模拟保存失败", { exact: false }).first()).toBeVisible();
  await expect(page.getByLabel("标题", { exact: true })).toHaveValue("断网保留的草稿");
  await page.reload();
  await expect(page.getByRole("heading", { name: "发现未提交的本机恢复副本" })).toBeVisible();
  await page.unroute(`**/api/v1/admin/contents/${id}`);
  await page.getByRole("button", { name: "恢复输入", exact: true }).click();
  await expect(page.getByLabel("标题", { exact: true })).toHaveValue("断网保留的草稿");
  await page.getByRole("button", { name: "保存草稿", exact: true }).click();
  await expect.poll(async () => (await (await context.request.get(`/api/v1/admin/contents/${id}`)).json()).data.title).toBe("断网保留的草稿");
  let latest = (await (await context.request.get(`/api/v1/admin/contents/${id}`)).json()).data;
  const other = await context.request.put(`/api/v1/admin/contents/${id}`, { headers: { "X-CSRF-TOKEN": csrf }, data: { ...latest, title: "另一编辑保存的版本" } });
  expect(other.ok(), await other.text()).toBeTruthy();
  await page.getByLabel("标题", { exact: true }).fill("冲突时的本地输入");
  await page.getByRole("button", { name: "保存草稿", exact: true }).click();
  await expect(page.getByRole("heading", { name: "版本冲突，当前输入已保留" })).toBeVisible();
  await expect(page.getByLabel("标题", { exact: true })).toHaveValue("冲突时的本地输入");
  await page.getByRole("button", { name: "将当前输入另存为新草稿" }).click();
  await page.getByRole("button", { name: "保存草稿", exact: true }).click();
  await expect.poll(() => page.url().split("/").pop()).not.toBe(id);
  await expect(page.getByLabel("标题", { exact: true })).toHaveValue("冲突时的本地输入");
  await page.goto(`/admin/posts/${id}`);
  await expect(page.getByRole("heading", { name: "历史版本", exact: true })).toBeVisible();
  const revisions = (await (await context.request.get(`/api/v1/admin/contents/${id}/revisions`)).json()).data.items;
  const first = revisions.find((r: { version: number }) => r.version === original.version);
  const row = page.locator(".history-list li").filter({ hasText: `版本 ${first.version} ·` });
  await row.getByRole("button", { name: "查看", exact: true }).click();
  await expect(page.getByRole("heading", { name: "自动保存验收", exact: true })).toBeVisible();
  await row.getByRole("button", { name: "恢复为草稿" }).click();
  await expect(page.getByLabel("标题", { exact: true })).toHaveValue("自动保存验收");
  for (const width of [1440, 375]) {
    await page.setViewportSize({ width, height: 1000 });
    if (width < 700) await expect.poll(async () => { const box = await page.locator("#admin-navigation").boundingBox(); return box!.x + box!.width; }).toBeLessThanOrEqual(1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBeTruthy();
    await page.screenshot({ path: `${process.env.CMS_TEST_ARTIFACTS}/editor-history-${width}.png`, fullPage: true, animations: "disabled" });
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole("button", { name: "移入回收站" }).click();
  await expect(page).toHaveURL(/\/admin\/posts$/);
  await page.getByRole("combobox", { name: "状态", exact: true }).selectOption("trash");
  const trash = page.getByRole("row").filter({ hasText: "自动保存验收" });
  await expect(trash).toBeVisible();
  await trash.getByRole("button", { name: "恢复为草稿" }).click();
  await expect(trash).toHaveCount(0);
  await page.getByRole("combobox", { name: "状态", exact: true }).selectOption("draft");
  await expect(page.getByRole("row").filter({ hasText: "自动保存验收" })).toBeVisible();
  for (const width of [1440, 768, 375]) {
    await page.setViewportSize({ width, height: 1000 });
    if (width < 700) await expect.poll(async () => { const box = await page.locator("#admin-navigation").boundingBox(); return box!.x + box!.width; }).toBeLessThanOrEqual(1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBeTruthy();
    await page.screenshot({ path: `${process.env.CMS_TEST_ARTIFACTS}/editorial-${width}.png`, fullPage: true, animations: "disabled" });
  }
  await page.goto("/admin/maintenance");
  await page.getByRole("button", { name: "立即备份" }).click();
  await expect(page.getByRole("link", { name: "下载最近备份" })).toBeVisible({ timeout: 15000 });
  await page.screenshot({ path: `${process.env.CMS_TEST_ARTIFACTS}/maintenance-mobile.png`, fullPage: true });
  await page.setViewportSize({ width: 1440, height: 1000 });
  const guest = await browser.newContext({ baseURL: process.env.CMS_TEST_BASE_URL });
  const guestCsrf = (await (await guest.request.get("/api/v1/auth/csrf")).json()).data.token;
  const inquiry = await guest.request.post("/api/v1/public/leads", { headers: { "X-CSRF-TOKEN": guestCsrf }, data: {
    id: randomUUID().replaceAll("-", ""), path: "/", name: "界面验收客户", contact: "ui@example.test", organization: "验收单位", need: "产品咨询", consent: true,
  } });
  expect(inquiry.ok(), await inquiry.text()).toBeTruthy();
  await page.goto("/admin/leads");
  await page.getByRole("row").filter({ hasText: "界面验收客户" }).getByRole("button", { name: "查看 / 跟进" }).click();
  const detail = page.locator(".lead-detail");
  const owner = (await login.json()).data;
  await detail.getByRole("combobox", { name: "负责人", exact: true }).selectOption(owner.id);
  await detail.getByLabel("本次跟进记录").fill("已沟通，明日继续跟进");
  await detail.getByLabel("下次联系时间").fill("2030-10-01T09:30");
  await detail.getByRole("button", { name: "保存跟进", exact: true }).click();
  await expect(detail).toHaveCount(0);
  await page.getByRole("row").filter({ hasText: "界面验收客户" }).getByRole("button", { name: "查看 / 跟进" }).click();
  await expect(detail.locator(".history-list")).toContainText("已沟通，明日继续跟进");
  await expect(detail.getByRole("combobox", { name: "负责人", exact: true })).toHaveValue(owner.id);
  await page.setViewportSize({ width: 375, height: 1000 });
  await expect.poll(async () => { const box = await page.locator("#admin-navigation").boundingBox(); return box!.x + box!.width; }).toBeLessThanOrEqual(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBeTruthy();
  await page.screenshot({ path: `${process.env.CMS_TEST_ARTIFACTS}/lead-followup-375.png`, fullPage: true, animations: "disabled" });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await detail.getByRole("button", { name: "关闭详情" }).click();
  const csvResponse = await context.request.get("/api/v1/admin/leads/export");
  expect(await csvResponse.text()).toContain("已沟通，明日继续跟进");
  const upload = await context.request.post("/api/v1/admin/assets", { headers: { "X-CSRF-TOKEN": csrf }, multipart: {
    file: { name: "界面引用.png", mimeType: "image/png", buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a0foAAAAASUVORK5CYII=", "base64") },
  } });
  expect(upload.ok(), await upload.text()).toBeTruthy();
  const asset = (await upload.json()).data;
  let article = (await (await context.request.post("/api/v1/admin/contents", { headers: { "X-CSRF-TOKEN": csrf }, data: {
    kind: "post", slug: "browser-discovery", title: "搜索与订阅验收", summary: "摘要", html: `<p>正文独有验收关键词</p><img src="/media/${asset.id}">`,
    coverId: "", categoryId: "", tagIds: [], version: 0,
  } })).json()).data;
  const published = await context.request.post(`/api/v1/admin/contents/${article.id}/publish`, { headers: { "X-CSRF-TOKEN": csrf }, data: { version: article.version } });
  expect(published.ok(), await published.text()).toBeTruthy();
  await page.goto("/admin/assets");
  await page.getByRole("textbox", { name: "搜索文件名" }).fill("界面引用");
  await page.getByRole("button", { name: "搜索", exact: true }).click();
  await page.getByRole("button", { name: "引用位置" }).click();
  await expect(page.locator(".reference-list")).toContainText("搜索与订阅验收");
  await page.goto("/search?q=" + encodeURIComponent("正文独有验收关键词"));
  await expect(page.getByRole("link", { name: "搜索与订阅验收", exact: true })).toBeVisible();
  const rss = await guest.request.get("/rss.xml");
  expect(rss.ok()).toBeTruthy();
  const rssText = await rss.text();
  expect(rssText).toContain("搜索与订阅验收");
  expect(rssText).not.toContain("冲突时的本地输入");
  expect(await page.evaluate(xml => new DOMParser().parseFromString(xml, "application/xml").querySelector("parsererror") === null, rssText)).toBeTruthy();
  expect(errors).toEqual([]);
  await guest.close();
  await context.close();
});
