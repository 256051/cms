import { test, expect, type Page } from "@playwright/test";
import fs from "node:fs";
import { loginCaptcha } from "./login";

if (!process.env.CMS_TEST_BASE_URL || !process.env.CMS_TEST_CREDENTIALS_PATH) throw new Error("An isolated site is required.");
const credentials = JSON.parse(fs.readFileSync(process.env.CMS_TEST_CREDENTIALS_PATH, "utf8").replace(/^\uFEFF/, ""));
async function session(page: Page) {
  let csrf = (await (await page.request.get("/api/v1/auth/csrf")).json()).data.token;
  const login = await page.request.post("/api/v1/auth/login", { headers: { "X-CSRF-TOKEN": csrf }, data: { ...credentials, ...await loginCaptcha(page.request) } });
  expect(login.ok(), await login.text()).toBeTruthy();
  csrf = (await (await page.request.get("/api/v1/auth/csrf")).json()).data.token;
  return async (path: string, method = "GET", data?: unknown) => {
    const result = await page.request.fetch("/api/v1/" + path, { method, data, headers: { "X-CSRF-TOKEN": csrf } });
    expect(result.ok(), await result.text()).toBeTruthy(); return (await result.json()).data;
  };
}

test("bulk uploads retain failures, metadata groups filter pickers and cropping preserves originals", async ({ page, browser }) => {
  test.setTimeout(120000);
  const call = await session(page);
  await page.setViewportSize({ width: 1440, height: 1000 }); await page.goto("/admin/assets");
  const png = Buffer.from(await page.evaluate(() => {
    const c = document.createElement("canvas"); c.width = 120; c.height = 80;
    const ctx = c.getContext("2d")!; ctx.fillStyle = "red"; ctx.fillRect(0, 0, 60, 80); ctx.fillStyle = "blue"; ctx.fillRect(60, 0, 60, 80);
    return c.toDataURL("image/png").split(",")[1];
  }), "base64");
  await page.locator('input[type="file"]').setInputFiles([
    { name: "原图.png", mimeType: "image/png", buffer: png }, { name: "第二图.png", mimeType: "image/png", buffer: png },
    { name: "无效.pdf", mimeType: "application/pdf", buffer: Buffer.from("invalid") },
  ]);
  await expect(page.getByText("已上传 2 个，失败 1 个。", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "重试失败的 1 个文件" })).toBeVisible();
  await page.locator(".asset-card").filter({ has: page.locator('strong[title="原图.png"]') }).getByRole("button", { name: "名称与分组" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("文件名", { exact: true }).fill("产品主图.png");
  await dialog.getByLabel("分组", { exact: true }).fill("产品图库");
  await dialog.getByRole("button", { name: "保存附件信息" }).click(); await expect(dialog).toHaveCount(0);
  await page.getByLabel("附件分组").selectOption("产品图库"); await expect(page.locator(".asset-card")).toHaveCount(1);
  const original = (await call("admin/assets?group=" + encodeURIComponent("产品图库"))).items[0];
  await page.getByRole("button", { name: "裁剪图片", exact: true }).click();
  await expect(dialog.getByRole("button", { name: "另存为新附件" })).toBeEnabled();
  await dialog.getByLabel("主体左右位置").focus(); await dialog.getByLabel("主体左右位置").press("End");
  await dialog.getByLabel("主体放大").focus(); await dialog.getByLabel("主体放大").press("End");
  await expect.poll(() => dialog.locator("canvas").evaluate((el: HTMLCanvasElement) => el.width)).toBe(20);
  expect(await dialog.locator("canvas").evaluate((el: HTMLCanvasElement) => Array.from(el.getContext("2d")!.getImageData(10, 10, 1, 1).data))).toEqual([0, 0, 255, 255]);
  await dialog.getByRole("button", { name: "另存为新附件" }).click(); await expect(dialog).toHaveCount(0);
  await expect(page.locator(".asset-card")).toHaveCount(2);
  const assets = (await call("admin/assets?group=" + encodeURIComponent("产品图库"))).items;
  expect(assets.some((x: { name: string; id: string }) => x.name === "产品主图-crop.png" && x.id !== original.id)).toBeTruthy();
  expect(await (await page.request.get(original.url)).body()).toEqual(png);
  await page.goto("/admin/posts/new");
  await page.getByRole("button", { name: "从附件库选择", exact: true }).click();
  await page.getByRole("dialog").getByLabel("附件分组").selectOption("产品图库");
  await expect(page.locator(".editor-asset-card")).toHaveCount(2);
  await expect(page.locator(".editor-asset-card img").first()).toBeVisible();
  await page.screenshot({ path: `${process.env.CMS_TEST_ARTIFACTS}/grouped-image-picker.png`, fullPage: true });
  const guest = await browser.newContext({ baseURL: process.env.CMS_TEST_BASE_URL });
  expect((await guest.request.get(original.url)).status()).toBe(404); await guest.close();
});

test("products, configurable inquiry fields, private details and CSV", async ({ page, browser }) => {
  test.setTimeout(120000); const call = await session(page);
  await page.goto("/admin/products/new");
  await expect(page.getByLabel("产品型号", { exact: true })).toBeVisible();
  await page.getByLabel("标题", { exact: true }).fill("企业产品");
  await page.getByRole("button", { name: "保存草稿", exact: true }).click();
  await expect(page).toHaveURL(/\/admin\/products\/[a-f0-9]{32}$/);
  const id = page.url().split("/").pop()!;
  await page.getByLabel("产品型号", { exact: true }).fill("CMS-X");
  await page.getByLabel("产品参数", { exact: true }).fill("支持多种数据库");
  await page.getByRole("button", { name: /添加业务字段/ }).click();
  await page.getByLabel("字段名称 4", { exact: true }).fill("部署方式");
  await page.getByLabel("部署方式", { exact: true }).fill("Docker 部署");
  await page.getByRole("button", { name: "保存并发布", exact: true }).click();
  await expect.poll(async () => (await call(`admin/contents/${id}`)).published).toBeTruthy();
  const content = await call(`admin/contents/${id}`);
  await page.goto("/admin/inquiry-form");
  await page.getByRole("button", { name: "添加表单字段" }).click();
  await page.getByLabel("字段名称 4", { exact: true }).fill("服务范围");
  await page.getByLabel("填写方式 4", { exact: true }).selectOption("select");
  await page.getByLabel("可选内容（一行一个，最多 20 项）").fill("咨询\n实施");
  await page.getByLabel("此项必填").last().check();
  await page.getByRole("button", { name: "保存表单", exact: true }).click();
  await expect(page.getByText("表单已保存，访客填写时会使用这些字段。", { exact: true })).toBeVisible();
  const guest = await browser.newContext({ baseURL: process.env.CMS_TEST_BASE_URL }); const visitor = await guest.newPage();
  await visitor.goto(`/products/${content.slug}`);
  await expect(visitor.getByRole("link", { name: "← 返回产品列表", exact: true })).toHaveAttribute("href", "/products");
  await expect(visitor.locator(".business-details")).toContainText("CMS-X");
  await expect(visitor.locator(".business-details")).toContainText("Docker 部署");
  await visitor.getByRole("button", { name: "咨询 / 预约演示" }).click();
  const form = visitor.locator("#inquiry-form");
  await form.getByLabel("称呼", { exact: true }).fill("产品客户");
  await form.getByLabel("联系方式", { exact: true }).fill("test-contact");
  await form.getByLabel("需求描述", { exact: true }).fill("希望了解产品");
  await form.getByLabel("我同意将以上信息用于本次咨询及后续联系，信息不会公开展示。").check();
  await form.getByLabel("服务范围", { exact: true }).selectOption("实施");
  await form.getByRole("button", { name: "提交咨询", exact: true }).click();
  await expect(visitor.getByText("咨询已提交，我们会通过你留下的联系方式回复。", { exact: true })).toBeVisible();
  await page.goto("/admin/leads");
  await page.getByRole("row").filter({ hasText: "产品客户" }).getByRole("button", { name: "查看 / 跟进" }).click();
  await expect(page.locator(".lead-detail")).toContainText("服务范围"); await expect(page.locator(".lead-detail")).toContainText("实施");
  expect(await (await page.request.get("/api/v1/admin/leads/export")).text()).toContain("服务范围");
  await visitor.setViewportSize({ width: 375, height: 812 });
  await visitor.evaluate(() => scrollTo(0, 0));
  await visitor.screenshot({ path: `${process.env.CMS_TEST_ARTIFACTS}/product-inquiry-mobile.png`, fullPage: true });
  expect(await visitor.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
  await visitor.goto("/products"); await expect(visitor.getByRole("link", { name: "企业产品", exact: true }).first()).toBeVisible();
  await page.goto("/admin/cases/new"); await expect(page.getByLabel("所属行业", { exact: true })).toBeVisible();
  await page.goto("/admin/notifications"); await expect(page.getByRole("heading", { name: "通知记录", exact: true })).toBeVisible();
  await expect(page.getByText(/通知未启用/)).toBeVisible(); await guest.close();
});

test("SEO edits and renamed public URLs apply at publish time", async ({ page, browser }) => {
  test.setTimeout(120000); const call = await session(page);
  const doc = await call("admin/contents", "POST", { kind: "page", slug: "browser-seo-old", title: "公开标题", summary: "原摘要", html: "<p>页面正文</p>", coverId: "", categoryId: "", tagIds: [], version: 0 });
  await call(`admin/contents/${doc.id}/publish`, "POST", { version: doc.version });
  await page.goto(`/admin/pages/${doc.id}`);
  await page.getByLabel("访问地址", { exact: true }).fill("browser-seo-new");
  await page.getByLabel("SEO 标题", { exact: true }).fill("自定义搜索标题");
  await page.getByLabel("SEO 描述", { exact: true }).fill("单独的分享描述");
  await page.getByLabel("禁止搜索引擎收录此页").check();
  await page.getByRole("button", { name: "保存草稿", exact: true }).click();
  await expect.poll(async () => (await call(`admin/contents/${doc.id}`)).slug).toBe("browser-seo-new");
  expect((await call("public/contents/browser-seo-old")).slug).toBe("browser-seo-old");
  await page.getByRole("button", { name: "保存并发布", exact: true }).click();
  await expect.poll(async () => (await call("public/contents/browser-seo-old")).slug).toBe("browser-seo-new");
  const guest = await browser.newContext({ baseURL: process.env.CMS_TEST_BASE_URL }); const visitor = await guest.newPage();
  await visitor.goto("/pages/browser-seo-old"); await expect(visitor).toHaveURL(/\/pages\/browser-seo-new$/);
  await expect(visitor).toHaveTitle(/自定义搜索标题/);
  await expect(visitor.locator('meta[name="description"]')).toHaveAttribute("content", "单独的分享描述");
  await expect(visitor.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
  await expect(visitor.locator('link[rel="canonical"]')).toHaveAttribute("href", /\/pages\/browser-seo-new$/);
  const redirect = await guest.request.get("/pages/browser-seo-old", { maxRedirects: 0, headers: { "User-Agent": "Googlebot" } });
  expect(redirect.status()).toBe(308);
  expect(await (await guest.request.get("/sitemap.xml")).text()).not.toContain("browser-seo-new");
  await guest.close();
});
