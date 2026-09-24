import { test, expect } from "@playwright/test";
import fs from "node:fs";
import { loginCaptcha } from "./login";

if (!process.env.CMS_TEST_BASE_URL || !process.env.CMS_TEST_CREDENTIALS_PATH) throw new Error("An isolated site is required.");
const credentials = JSON.parse(fs.readFileSync(process.env.CMS_TEST_CREDENTIALS_PATH, "utf8").replace(/^\uFEFF/, ""));

test("AI settings and preview/apply use real draft persistence with simulated generation", async ({ browser }) => {
  test.setTimeout(120_000);
  const context = await browser.newContext({ baseURL: process.env.CMS_TEST_BASE_URL });
  let csrf = (await (await context.request.get("/api/v1/auth/csrf")).json()).data.token;
  const login = await context.request.post("/api/v1/auth/login", { headers: { "X-CSRF-TOKEN": csrf }, data: { ...credentials, ...await loginCaptcha(context.request) } });
  expect(login.ok(), await login.text()).toBeTruthy();
  csrf = (await (await context.request.get("/api/v1/auth/csrf")).json()).data.token;
  const headers = { "X-CSRF-TOKEN": csrf };
  const tag = await context.request.post("/api/v1/admin/taxonomy", { headers, data: { kind: "tag", name: "人工智能", slug: "ai" } });
  expect(tag.ok(), await tag.text()).toBeTruthy();
  const tagId = (await tag.json()).data.id;
  const created = await context.request.post("/api/v1/admin/contents", { headers, data: {
    kind: "post", slug: "ai-writing-check", title: "原始标题", html: "<p>原始正文</p>", summary: "原始摘要", coverId: "", categoryId: "", tagIds: [], version: 0,
  } });
  expect(created.ok(), await created.text()).toBeTruthy();
  const doc = (await created.json()).data;
  const publication = await context.request.post(`/api/v1/admin/contents/${doc.id}/publish`, { headers, data: { version: doc.version } });
  expect(publication.ok(), await publication.text()).toBeTruthy();
  const page = await context.newPage();
  const pageErrors: string[] = [];
  page.on("pageerror", e => pageErrors.push(e.message));
  await page.goto(`/admin/posts/${doc.id}`);
  await page.getByRole("button", { name: "AI 写作助手", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "AI 写作助手" });
  await expect(dialog.getByText("AI 写作尚未就绪", { exact: false })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "生成预览" })).toBeDisabled();
  await dialog.getByRole("button", { name: "关闭窗口" }).click();
  await page.goto("/admin/ai");
  await page.getByRole("checkbox", { name: "启用 AI 写作助手" }).check();
  await page.getByLabel("API 地址", { exact: true }).fill("https://provider.example.com/v1");
  await page.getByLabel("API Key", { exact: true }).fill("ai-browser-fixture-secret");
  await page.getByLabel("模型名称", { exact: true }).fill("fixture-model");
  await expect(page.getByRole("button", { name: "测试连接", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "保存 AI 设置" }).click();
  await expect(page.getByText("AI 设置已加密保存到数据库", { exact: false })).toBeVisible();
  await expect(page.getByLabel("API Key", { exact: true })).toHaveValue("");
  await page.reload();
  await expect(page.getByLabel("模型名称", { exact: true })).toHaveValue("fixture-model");
  await expect(page.getByLabel("API Key", { exact: true })).toHaveAttribute("placeholder", "已保存，留空保留原密钥");
  // Only provider-facing calls are simulated. Configuration, authentication and draft save use the real API.
  await page.route("**/api/v1/admin/ai/test", route => route.fulfill({ json: { code: "OK", data: { text: "模拟连接成功", html: "", tagIds: [] } } }));
  await page.getByRole("button", { name: "测试连接", exact: true }).click();
  await expect(page.getByText("连接测试通过，模型已返回文字：模拟连接成功")).toBeVisible();
  for (const width of [1440, 375]) {
    await page.setViewportSize({ width, height: 1000 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBeTruthy();
    await page.screenshot({ path: `${process.env.CMS_TEST_ARTIFACTS}/ai-settings-${width}.png`, fullPage: true, animations: "disabled" });
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`/admin/posts/${doc.id}`);
  let fail = false;
  const requests: { action: string; html: string }[] = [];
  await page.route("**/api/v1/admin/ai/generate", async route => {
    const input = route.request().postDataJSON(); requests.push(input);
    if (fail) { await route.fulfill({ status: 502, json: { code: "AI_ERROR", message: "模拟模型服务失败" } }); return; }
    const text = input.action === "title" ? "AI 优化标题" : input.action === "summary" ? "AI 生成摘要" : "AI 生成正文";
    await route.fulfill({ json: { code: "OK", data: { text: input.action === "tags" ? "人工智能" : text,
      html: ["write", "polish", "translate"].includes(input.action) ? "<h2>生成小标题</h2><p>AI 生成正文</p>" : "", tagIds: input.action === "tags" ? [tagId] : [] } } });
  });
  const readDraft = async () => (await (await context.request.get(`/api/v1/admin/contents/${doc.id}`)).json()).data;
  const before = await readDraft();
  await page.getByRole("button", { name: "AI 写作助手", exact: true }).click();
  await dialog.getByLabel("写作操作", { exact: true }).selectOption("polish");
  await dialog.getByRole("button", { name: "生成预览" }).click();
  await expect(dialog.getByRole("heading", { name: "生成结果 · 尚未应用" })).toBeVisible();
  expect((await readDraft()).version).toBe(before.version);
  await page.setViewportSize({ width: 375, height: 900 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBeTruthy();
  await page.screenshot({ path: `${process.env.CMS_TEST_ARTIFACTS}/ai-preview-375.png`, animations: "disabled" });
  await dialog.getByRole("button", { name: "放弃结果" }).click();
  expect((await readDraft()).html).toBe(before.html);
  await page.setViewportSize({ width: 1440, height: 1000 });
  for (const action of ["summary", "title", "tags", "translate", "polish"]) {
    await page.getByRole("button", { name: "AI 写作助手", exact: true }).click();
    await dialog.getByLabel("写作操作", { exact: true }).selectOption(action);
    await dialog.getByRole("button", { name: "生成预览" }).click();
    await expect(dialog.getByRole("heading", { name: "生成结果 · 尚未应用" })).toBeVisible();
    await dialog.getByRole("button", { name: /^应用到/ }).click();
    await page.getByRole("button", { name: "保存草稿", exact: true }).click();
    await expect(page.getByText("草稿已同步。", { exact: false })).toBeVisible();
  }
  const after = await readDraft();
  expect(after.title).toBe("AI 优化标题"); expect(after.summary).toBe("AI 生成摘要");
  expect(after.tagIds).toContain(tagId); expect(after.html).toContain("AI 生成正文");
  const publicDoc = (await (await context.request.get("/api/v1/public/contents/ai-writing-check")).json()).data;
  expect(publicDoc.title).toBe("原始标题"); expect(publicDoc.html).toContain("原始正文"); expect(publicDoc.summary).toBe("原始摘要");
  fail = true;
  await page.getByRole("button", { name: "AI 写作助手", exact: true }).click();
  await dialog.getByRole("button", { name: "生成预览" }).click();
  await expect(dialog.getByRole("alert")).toContainText("模拟模型服务失败");
  await expect(dialog.getByRole("button", { name: /^应用到/ })).toHaveCount(0);
  await dialog.getByRole("button", { name: "关闭窗口" }).click();
  expect((await readDraft()).version).toBe(after.version);
  fail = false;
  await page.goto("/admin/posts/new");
  await page.getByRole("button", { name: "AI 写作助手", exact: true }).click();
  await dialog.getByLabel("写作主题与要求", { exact: true }).fill("网站备份入门");
  await dialog.getByRole("button", { name: "生成预览" }).click();
  await dialog.getByRole("button", { name: "应用到正文" }).click();
  await expect(page.locator(".title-input")).toHaveValue("网站备份入门");
  await expect(page).toHaveURL(/\/admin\/posts\/[a-f0-9]{32}$/, { timeout: 20_000 });
  const newId = new URL(page.url()).pathname.split("/").at(-1);
  const newDoc = (await (await context.request.get(`/api/v1/admin/contents/${newId}`)).json()).data;
  expect(newDoc.published).toBe(false); expect(newDoc.html).toContain("AI 生成正文");
  expect(requests[0].html).toContain("原始正文"); expect(pageErrors).toEqual([]);
  await context.close();
});
