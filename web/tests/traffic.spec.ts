import { test, expect } from "@playwright/test";
import fs from "node:fs";
import { loginCaptcha } from "./login";

if (!process.env.CMS_TEST_BASE_URL || !process.env.CMS_TEST_CREDENTIALS_PATH)
  throw new Error("Traffic browser acceptance requires an explicitly configured isolated test site.");
const credentials = JSON.parse(fs.readFileSync(process.env.CMS_TEST_CREDENTIALS_PATH, "utf8").replace(/^\uFEFF/, ""));

test("traffic collection, customer follow-up and responsive reporting through real browser navigation", async ({ browser }) => {
  test.setTimeout(180000);
  const admin = await browser.newContext({ baseURL: process.env.CMS_TEST_BASE_URL, ignoreHTTPSErrors: process.env.CMS_TEST_SELF_SIGNED === "1" }), visitor = await browser.newContext({ baseURL: process.env.CMS_TEST_BASE_URL, ignoreHTTPSErrors: process.env.CMS_TEST_SELF_SIGNED === "1" }), other = await browser.newContext({ baseURL: process.env.CMS_TEST_BASE_URL, ignoreHTTPSErrors: process.env.CMS_TEST_SELF_SIGNED === "1" });
  const errors: string[] = [];
  const csrf = (await (await admin.request.get("/api/v1/auth/csrf")).json()).data.token;
  const logged = await admin.request.post("/api/v1/auth/login", { headers: { "X-CSRF-TOKEN": csrf }, data: { ...credentials, ...await loginCaptcha(admin.request) } });
  expect(logged.ok()).toBeTruthy();
  const token = (await (await admin.request.get("/api/v1/auth/csrf")).json()).data.token;
  async function api(path: string, method = "GET", data?: unknown) {
    const response = await admin.request.fetch("/api/v1/" + path, { method, data, headers: { "X-CSRF-TOKEN": token } });
    expect(response.status(), await response.text()).toBeLessThan(400);
    return (await response.json()).data;
  }
  const stamp = Date.now().toString(36);
  const uploaded = await admin.request.post("/api/v1/admin/assets", { headers: { "X-CSRF-TOKEN": token }, multipart: {
    file: { name: "traffic-browser.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4\n% traffic download\n%%EOF") }
  } });
  expect(uploaded.ok(), await uploaded.text()).toBeTruthy();
  const asset = (await uploaded.json()).data;
  let article = await api("admin/contents", "POST", { kind: "post", slug: "traffic-browser-" + stamp, title: "浏览与客户咨询验收 " + stamp,
    summary: "用于验证阅读、下载和客户咨询记录。", html: Array.from({ length: 45 }, (_, i) => `<p>第 ${i + 1} 段：访问数据帮助了解读者需求，客户主动提交的联系信息仅在管理后台展示。</p>`).join("") + `<p><a href="/media/${asset.id}">下载验收资料</a></p>`,
    coverId: "", categoryId: "", tagIds: [], version: 0 });
  article = await api(`admin/contents/${article.id}/publish`, "POST", { version: article.version });
  const path = "/posts/" + article.slug;
  const adminPage = await admin.newPage(), page = await visitor.newPage();
  for (const p of [adminPage, page]) p.on("pageerror", error => errors.push(error.message));
  await adminPage.goto(path);
  await adminPage.waitForLoadState("networkidle");
  expect((await api("public/contents/" + article.slug)).views).toBe(0);
  const recorded = page.waitForResponse(r => r.url().endsWith("/api/v1/public/visits") && r.request().method() === "POST");
  await page.goto(path + "?utm_source=browser-check&utm_campaign=consultation");
  const receipt = (await (await recorded).json()).data;
  expect(receipt.views).toBe(1);
  await expect(page.getByText("1 次阅读", { exact: true })).toBeVisible();
  const visitorCookie = (await visitor.cookies()).find(c => c.name === "cms.visitor")!;
  expect(visitorCookie.httpOnly).toBeTruthy();
  expect(visitorCookie.secure).toBeTruthy();
  await page.waitForTimeout(2200);
  await page.getByRole("link", { name: "下载验收资料" }).scrollIntoViewIfNeeded();
  await Promise.all([page.waitForEvent("download"), page.getByRole("link", { name: "下载验收资料" }).click()]);
  await page.getByRole("button", { name: "咨询 / 预约演示" }).click();
  await page.locator("#inquiry-form").getByLabel("称呼", { exact: true }).fill("浏览器客户 " + stamp);
  await page.getByLabel("联系方式", { exact: true }).fill("visitor-" + stamp + "@example.test");
  await page.getByLabel("公司或学校（选填）").fill("浏览器验收学校");
  await page.getByLabel("需求描述").fill("希望安排产品演示并了解部署方式。");
  await page.getByRole("checkbox", { name: /我同意将以上信息/ }).check();
  await page.setViewportSize({ width: 375, height: 812 });
  await expect(page.locator("#inquiry-form")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBeTruthy();
  await page.locator(".inquiry-section").screenshot({ path: "../artifacts/traffic-form-mobile.png", animations: "disabled" });
  await page.getByRole("button", { name: "提交咨询", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "咨询已提交" })).toBeVisible();
  const leads = await api("admin/leads?q=" + encodeURIComponent("visitor-" + stamp));
  expect(leads.total).toBe(1);
  const lead = leads.items[0];
  expect(lead.contentId).toBe(article.id);
  expect(lead.source).toBe("推广：browser-check / consultation");
  await page.reload();
  await expect(page.getByText("2 次阅读", { exact: true })).toBeVisible();
  await expect.poll(async () => {
    const history = await api(`admin/visitors/${lead.visitorId}/visits`);
    return history.items.find((v: { id: string }) => v.id === receipt.id)?.activeSeconds;
  }).toBeGreaterThanOrEqual(2);
  const history = await api(`admin/visitors/${lead.visitorId}/visits`);
  expect(history.items.find((v: { id: string }) => v.id === receipt.id).depth).toBeGreaterThanOrEqual(80);
  const secondPage = await other.newPage();
  await secondPage.goto(path);
  await expect(secondPage.getByText("3 次阅读", { exact: true })).toBeVisible();
  const metrics = await api("admin/contents/" + article.id);
  expect([metrics.views, metrics.todayViews, metrics.visitors]).toEqual([3, 3, 2]);
  await adminPage.goto("/admin/traffic");
  await expect(adminPage.getByRole("heading", { name: "访问统计", exact: true })).toBeVisible();
  await adminPage.getByRole("button", { name: "最近 30 天" }).click();
  await expect(adminPage.locator(".traffic-chart")).toBeVisible();
  await expect(adminPage.getByText(article.title, { exact: true })).toBeVisible();
  for (const width of [1440, 768, 375]) {
    await adminPage.setViewportSize({ width, height: 1000 });
    expect(await adminPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBeTruthy();
    await adminPage.screenshot({ path: `../artifacts/traffic-dashboard-${width}.png`, fullPage: true, animations: "disabled" });
  }
  await adminPage.goto("/admin/leads");
  await adminPage.getByRole("textbox", { name: "搜索客户" }).fill("visitor-" + stamp);
  await adminPage.getByRole("button", { name: "搜索", exact: true }).click();
  await expect(adminPage.getByRole("button", { name: "查看 / 跟进" })).toHaveCount(1);
  await adminPage.getByRole("button", { name: "查看 / 跟进" }).click();
  await adminPage.locator(".lead-detail").getByLabel("跟进状态").selectOption("following");
  await adminPage.getByLabel("本次跟进记录").fill("已联系，周五演示。");
  await adminPage.getByRole("button", { name: "保存跟进" }).click();
  await expect(adminPage.locator(".lead-detail")).toHaveCount(0);
  await expect(adminPage.getByText("跟进中", { exact: true }).last()).toBeVisible();
  await adminPage.reload();
  await adminPage.getByRole("textbox", { name: "搜索客户" }).fill("visitor-" + stamp);
  await adminPage.getByRole("button", { name: "搜索", exact: true }).click();
  await expect(adminPage.getByRole("button", { name: "查看 / 跟进" })).toHaveCount(1);
  await adminPage.getByRole("button", { name: "查看 / 跟进" }).click();
  await expect(adminPage.getByLabel("本次跟进记录")).toHaveValue("");
  await expect(adminPage.locator(".history-list")).toContainText("已联系，周五演示。");
  await adminPage.getByRole("link", { name: /查看此浏览器的访问轨迹/ }).click();
  await expect(adminPage.getByText(article.title, { exact: true }).first()).toBeVisible();
  expect((await visitor.request.get("/api/v1/admin/leads")).status()).toBe(401);
  const beforePreview = (await api("public/contents/" + article.slug)).views;
  await adminPage.goto("/admin/themes/preview" + path + "?themeId=midnight");
  await adminPage.waitForLoadState("networkidle");
  await expect(adminPage.getByRole("button", { name: "咨询 / 预约演示" })).toHaveCount(0);
  expect((await api("public/contents/" + article.slug)).views).toBe(beforePreview);
  const privateVisitor = await browser.newContext({ baseURL: process.env.CMS_TEST_BASE_URL, ignoreHTTPSErrors: process.env.CMS_TEST_SELF_SIGNED === "1" });
  await privateVisitor.addInitScript(() => Object.defineProperty(navigator, "doNotTrack", { get: () => "1" }));
  const privatePage = await privateVisitor.newPage();
  await privatePage.goto(path); await privatePage.waitForLoadState("networkidle");
  expect((await api("public/contents/" + article.slug)).views).toBe(beforePreview);
  expect(errors).toEqual([]);
  await privateVisitor.close(); await other.close(); await visitor.close(); await admin.close();
});
