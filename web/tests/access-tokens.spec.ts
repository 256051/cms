import { test, expect } from "@playwright/test";
import fs from "node:fs";
import { fillCaptcha } from "./login";

if (!process.env.CMS_TEST_BASE_URL || !process.env.CMS_TEST_CREDENTIALS_PATH)
  throw new Error("请通过 tests/docker_smoke.py 在独立测试站点验收访问令牌。");
const credentials = JSON.parse(fs.readFileSync(process.env.CMS_TEST_CREDENTIALS_PATH, "utf8"));

test("token form, one-time secret, failure recovery, scoped publication and revocation", async ({ page, playwright }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto("/admin/login");
  await page.getByLabel("账号", { exact: true }).fill(credentials.username);
  await page.getByLabel("密码", { exact: true }).fill(credentials.password);
  await fillCaptcha(page);
  await page.getByRole("button", { name: "登录工作台" }).click();
  await expect(page.getByRole("heading", { name: /你好/ })).toBeVisible();
  await page.getByRole("link", { name: "API 访问令牌" }).click();
  const name = "浏览器 Agent " + Date.now();
  await page.getByLabel("令牌名称").fill(name);
  await expect(page.getByLabel("直接发布文章和页面")).not.toBeChecked();
  await page.getByLabel("直接发布文章和页面").check();
  page.once("dialog", dialog => dialog.dismiss());
  await page.getByRole("link", { name: "成员与权限" }).click();
  await expect(page).toHaveURL(/access-tokens/);
  await page.route("**/api/v1/admin/access-tokens", route => route.request().method() === "POST" ? route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ code: "TEST", message: "测试保存失败，请重试" }) }) : route.continue(), { times: 1 });
  await page.getByRole("button", { name: "创建令牌", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: "测试保存失败" })).toBeVisible();
  await expect(page.getByLabel("令牌名称")).toHaveValue(name);
  await page.getByRole("button", { name: "创建令牌", exact: true }).click();
  const secretBox = page.getByLabel("完整访问令牌");
  await expect(secretBox).toBeVisible();
  await expect(secretBox).toBeFocused();
  const secret = await secretBox.inputValue();
  expect(secret).toMatch(/^cms_[0-9a-f]{32}\.[0-9a-f]{64}$/);
  page.once("dialog", dialog => dialog.dismiss());
  await page.getByRole("link", { name: "成员与权限" }).click();
  await expect(secretBox).toHaveValue(secret);
  await page.getByRole("button", { name: "已保存，关闭" }).click();
  await expect(secretBox).toHaveCount(0);

  const agent = await playwright.request.newContext({ baseURL: process.env.CMS_TEST_BASE_URL, ignoreHTTPSErrors: process.env.CMS_TEST_SELF_SIGNED === "1", extraHTTPHeaders: { Authorization: "Bearer " + secret } });
  try {
    const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a0foAAAAASUVORK5CYII=", "base64");
    const upload = await agent.post("/api/v1/integration/assets", { headers: { "Idempotency-Key": "browser-upload-" + name.replaceAll(" ", "-").replace("浏览器", "ui") }, multipart: { file: { name: "agent.png", mimeType: "image/png", buffer: png } } });
    expect(upload.ok()).toBeTruthy(); const asset = (await upload.json()).data;
    const slug = "agent-browser-" + Date.now();
    const input = { kind: "post", title: "Agent 浏览器发布", slug, summary: "远程发布验收", html: `<p>Agent 远程发布正文</p><img src="/media/${asset.id}">`, coverId: asset.id, categoryId: "", tagIds: [], version: 0 };
    const saved = await agent.post("/api/v1/integration/contents", { headers: { "Idempotency-Key": "create-" + slug }, data: input });
    expect(saved.ok()).toBeTruthy(); const content = (await saved.json()).data;
    const published = await agent.post(`/api/v1/integration/contents/${content.id}/publish`, { headers: { "Idempotency-Key": "publish-" + slug }, data: { version: content.version } });
    expect(published.ok()).toBeTruthy();
    const publicPath = (await published.json()).data.path;
    const html = await (await agent.get(publicPath)).text();
    expect(html).toContain("Agent 远程发布正文");
    await page.reload();
    await expect(secretBox).toHaveCount(0);
    const card = page.getByRole("article").filter({ has: page.getByRole("heading", { name, exact: true }) });
    await expect(card).toContainText("最近使用");
    for (const width of [375, 768, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await expect(card.getByRole("button", { name: "撤销 " + name })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
      await page.screenshot({ path: `../artifacts/access-tokens-${width}.png`, fullPage: true, animations: "disabled" });
    }
    const revoke = card.getByRole("button", { name: "撤销 " + name });
    await revoke.focus();
    page.once("dialog", dialog => dialog.accept());
    await revoke.press("Enter");
    await expect(card).toContainText("已撤销");
    expect((await agent.get("/api/v1/integration/taxonomy")).status()).toBe(401);
    expect(errors).toEqual([]);
  } finally { await agent.dispose(); }
});
