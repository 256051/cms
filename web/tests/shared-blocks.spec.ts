import { test, expect } from "@playwright/test";
import fs from "node:fs";
import { loginCaptcha } from "./login";

if (!process.env.CMS_TEST_BASE_URL || !process.env.CMS_TEST_CREDENTIALS_PATH) throw new Error("An isolated site is required.");
const credentials = JSON.parse(fs.readFileSync(process.env.CMS_TEST_CREDENTIALS_PATH, "utf8").replace(/^\uFEFF/, ""));

test("reuse a published block, preview it and detach a copy", async ({ page }) => {
  test.setTimeout(120000);
  let csrf = (await (await page.request.get("/api/v1/auth/csrf")).json()).data.token;
  const login = await page.request.post("/api/v1/auth/login", { headers: { "X-CSRF-TOKEN": csrf }, data: { ...credentials, ...await loginCaptcha(page.request) } });
  expect(login.ok(), await login.text()).toBeTruthy();
  csrf = (await (await page.request.get("/api/v1/auth/csrf")).json()).data.token;
  async function call(path: string, method = "GET", data?: unknown) {
    const result = await page.request.fetch("/api/v1/" + path, { method, data, headers: { "X-CSRF-TOKEN": csrf } });
    expect(result.ok(), await result.text()).toBeTruthy(); return (await result.json()).data;
  }
  const defaults = { html: "", summary: "", coverId: "", categoryId: "", tagIds: [], version: 0 };
  const shared = await call("admin/contents", "POST", { ...defaults, kind: "block", slug: "browser-shared", title: "服务承诺", layout: { blocks: [{ id: "4".repeat(32), type: "text", title: "全天支持", text: "已发布说明" }] } });
  await call(`admin/contents/${shared.id}/publish`, "POST", { version: shared.version });
  const content = await call("admin/contents", "POST", { ...defaults, kind: "page", slug: "browser-shared-page", title: "区块页面", layout: { blocks: [] } });
  const errors: string[] = []; page.on("pageerror", e => errors.push(e.message));
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`/admin/pages/${content.id}`);
  await page.getByText("模板、公共区块与页面设置", { exact: true }).click();
  await page.getByText("从公共区块库插入", { exact: true }).click();
  await page.getByRole("button", { name: "同步引用", exact: true }).click();
  await expect(page.locator(".block-outline-list li")).toHaveCount(1);
  await page.getByText("整页预览（含页头、页脚与动态内容）", { exact: true }).click();
  const frame = page.frameLocator('iframe[title="页面实时预览"]').first();
  await expect(frame.locator(".page-block")).toContainText("全天支持");
  await expect(frame.locator(".page-block")).toContainText("已发布说明");
  await page.getByRole("button", { name: "保存并发布", exact: true }).click();
  await expect.poll(async () => (await call(`admin/contents/${content.id}`)).published).toBeTruthy();
  await page.goto(`/admin/blocks/${shared.id}`);
  await expect(page.getByRole("heading", { name: "区块引用位置" })).toBeVisible();
  await expect(page.locator(".reference-list")).toContainText("区块页面");
  await page.getByLabel("模块说明", { exact: true }).fill("新发布说明");
  await page.getByRole("button", { name: "发布公共区块", exact: true }).click();
  await expect.poll(async () => (await call("public/contents/browser-shared-page")).html).toContain("新发布说明");
  await page.goto(`/admin/pages/${content.id}`);
  await page.getByText("整页预览（含页头、页脚与动态内容）", { exact: true }).click();
  await expect(frame.locator(".page-block")).toContainText("新发布说明");
  await page.getByRole("button", { name: "转为独立副本", exact: true }).click();
  await expect(page.getByLabel("模块说明", { exact: true })).toHaveValue("新发布说明");
  await page.getByLabel("模块说明", { exact: true }).fill("独立编辑内容");
  await page.getByRole("button", { name: "保存草稿", exact: true }).click();
  await expect.poll(async () => (await call(`admin/contents/${content.id}`)).layout.blocks[0].type).toBe("text");
  expect((await call(`admin/blocks/${shared.id}`)).layout.blocks[0].text).toBe("新发布说明");
  expect((await call("public/contents/browser-shared-page")).html).toContain("新发布说明");
  await page.screenshot({ path: `${process.env.CMS_TEST_ARTIFACTS}/shared-blocks.png`, fullPage: true });
  expect(errors).toEqual([]);
});
