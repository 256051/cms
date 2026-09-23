import { test, expect } from "@playwright/test";
import fs from "node:fs";
import { loginCaptcha } from "./login";

test("taxonomy deletion exposes failures beside the action and confirms success", async ({ browser }) => {
  test.setTimeout(180000);
  const credentials = JSON.parse(fs.readFileSync(process.env.CMS_TEST_CREDENTIALS_PATH!, "utf8"));
  const context = await browser.newContext({ baseURL: process.env.CMS_TEST_BASE_URL });
  let csrf = (await (await context.request.get("/api/v1/auth/csrf")).json()).data.token;
  const login = await context.request.post("/api/v1/auth/login", { headers: { "X-CSRF-TOKEN": csrf }, data: { ...credentials, ...await loginCaptcha(context.request) } });
  expect(login.ok()).toBeTruthy();
  csrf = (await (await context.request.get("/api/v1/auth/csrf")).json()).data.token;
  async function call(path: string, method = "GET", data?: unknown) {
    const response = await context.request.fetch("/api/v1/" + path, { method, data, headers: { "X-CSRF-TOKEN": csrf } });
    expect(response.ok(), await response.text()).toBeTruthy();
    return (await response.json()).data;
  }
  for (let index = 0; index < 25; index++) await call("admin/taxonomy", "POST", { kind: "category", name: `列表占位 ${index}`, slug: `delete-filler-${index}` });
  const used = await call("admin/taxonomy", "POST", { kind: "category", name: "被文章引用的分类", slug: "delete-used" });
  const unused = await call("admin/taxonomy", "POST", { kind: "tag", name: "可删除的标签", slug: "delete-unused" });
  await call("admin/contents", "POST", { kind: "post", slug: "delete-reference", title: "分类删除验收文章", summary: "", html: "<p>正文</p>", coverId: "", categoryId: used.id, tagIds: [], version: 0 });
  const page = await context.newPage();
  page.on("dialog", dialog => void dialog.accept());
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto("/admin/taxonomy");
  const rejected = page.waitForResponse(r => r.url().endsWith(`/taxonomy/${used.id}`) && r.request().method() === "DELETE");
  await page.getByRole("button", { name: "删除 " + used.name, exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "删除分类 / 标签" });
  if (await dialog.isVisible()) await dialog.getByRole("button", { name: "确认删除", exact: true }).click();
  expect((await rejected).status()).toBe(409);
  await expect(page.locator('.alert[role="alert"]')).toBeInViewport();
  await expect(page.locator('.alert[role="alert"]')).toContainText("分类删除验收文章");
  await dialog.getByRole("button", { name: "取消", exact: true }).click();
  await expect(page.getByRole("button", { name: "删除 " + used.name, exact: true })).toBeVisible();
  await page.getByRole("button", { name: "删除 " + unused.name, exact: true }).click();
  await dialog.getByRole("button", { name: "取消", exact: true }).click();
  expect((await call("admin/taxonomy")).some((t: { id: string }) => t.id === unused.id)).toBeTruthy();
  await page.getByRole("button", { name: "编辑 " + unused.name, exact: true }).click();
  await page.getByRole("button", { name: "删除 " + unused.name, exact: true }).click();
  await dialog.getByRole("button", { name: "确认删除", exact: true }).click();
  await expect(dialog.getByRole("status")).toHaveText(`已删除“${unused.name}”。`);
  await dialog.getByRole("button", { name: "完成", exact: true }).click();
  await expect(page.getByRole("button", { name: "删除 " + unused.name, exact: true })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "添加分类 / 标签" })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("button", { name: "删除 " + unused.name, exact: true })).toHaveCount(0);
  // A failed request leaves the item intact and can be retried in the same dialog.
  const retry = (await call("admin/taxonomy")).find((t: { slug: string }) => t.slug === "delete-filler-0");
  await page.route(`**/api/v1/admin/taxonomy/${retry.id}`, route => route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ code: "UNAVAILABLE", message: "测试服务暂时不可用" }) }), { times: 1 });
  await page.getByRole("button", { name: "删除 " + retry.name, exact: true }).click();
  await dialog.getByRole("button", { name: "确认删除", exact: true }).click();
  await expect(dialog.getByRole("alert")).toHaveText("测试服务暂时不可用");
  expect((await call("admin/taxonomy")).some((t: { id: string }) => t.id === retry.id)).toBeTruthy();
  await dialog.getByRole("button", { name: "确认删除", exact: true }).click();
  await expect(dialog.getByRole("status")).toHaveText(`已删除“${retry.name}”。`);
  await dialog.getByRole("button", { name: "完成", exact: true }).click();
  // Existing reference protection stays in place, with an actionable source name.
  const category = await call("admin/taxonomy", "POST", { kind: "category", name: "历史分类", slug: "delete-history" });
  let article = await call("admin/contents", "POST", { kind: "post", slug: "delete-history-post", title: "历史引用文章", summary: "", html: "<p>历史正文</p>", coverId: "", categoryId: category.id, tagIds: [], version: 0 });
  article = await call(`admin/contents/${article.id}`, "PUT", { ...article, categoryId: "" });
  async function blocked(id: string, message: string) {
    const response = await context.request.delete(`/api/v1/admin/taxonomy/${id}`, { headers: { "X-CSRF-TOKEN": csrf } });
    expect(response.status()).toBe(409);
    expect((await response.json()).message).toContain(message);
  }
  await blocked(category.id, "“历史引用文章”的历史版本");
  const menu = await call("admin/menu", "POST", { type: "category", targetId: category.id, parentId: "", label: "", url: "", sort: 0, version: 0, openInNewTab: false });
  await blocked(category.id, "导航菜单“历史分类”");
  await call(`admin/menu/${menu.id}`, "DELETE", { version: menu.version });
  article = await call(`admin/contents/${article.id}`, "PUT", { ...article, categoryId: category.id });
  await call(`admin/contents/${article.id}`, "DELETE", { version: article.version });
  await blocked(category.id, "回收站中的“历史引用文章”");
  await context.close();
});
