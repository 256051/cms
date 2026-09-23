import { test, expect } from "@playwright/test";
import fs from "node:fs";
import { loginCaptcha } from "./login";

if (!process.env.CMS_TEST_BASE_URL || !process.env.CMS_TEST_CREDENTIALS_PATH) throw new Error("An isolated site is required.");
const credentials = JSON.parse(fs.readFileSync(process.env.CMS_TEST_CREDENTIALS_PATH, "utf8").replace(/^\uFEFF/, ""));

test("GrapesJS edits legacy layouts, drags modules, saves, restores and publishes", async ({ browser }) => {
  test.setTimeout(180000);
  const context = await browser.newContext({ baseURL: process.env.CMS_TEST_BASE_URL });
  let csrf = (await (await context.request.get("/api/v1/auth/csrf")).json()).data.token;
  const login = await context.request.post("/api/v1/auth/login", { headers: { "X-CSRF-TOKEN": csrf }, data: { ...credentials, ...await loginCaptcha(context.request) } });
  expect(login.ok(), await login.text()).toBeTruthy();
  csrf = (await (await context.request.get("/api/v1/auth/csrf")).json()).data.token;
  async function call(path: string, method = "GET", data?: unknown) {
    const response = await context.request.fetch("/api/v1/" + path, { method, data, headers: { "X-CSRF-TOKEN": csrf } });
    expect(response.ok(), await response.text()).toBeTruthy(); return (await response.json()).data;
  }
  const block = (type: string, title: string) => ({ id: crypto.randomUUID().replaceAll("-", ""), type, title, text: "原有内容保持可编辑",
    imageId: "", imageAlt: "", linkText: "", linkUrl: "", items: [], categoryId: "", limit: 6, columns: 3,
    tone: "soft", align: "left", spacing: "normal", hidden: false, html: "", sharedId: "", contentKind: "post",
    mobile: { align: "center", spacing: "small", columns: 1, textSize: "", hidden: false } });
  const original = await call("admin/contents", "POST", { kind: "page", slug: "grapes-acceptance", title: "拖拽页面验收",
    html: "", summary: "", coverId: "", categoryId: "", tagIds: [], version: 0,
    layout: { version: 1, width: "wide", showTitle: false, showHeader: true, showFooter: true,
      blocks: [block("hero", "旧版首屏"), block("text", "旧版介绍"), block("posts", "动态内容"), block("contact", "联系我们")] } });
  await call(`admin/contents/${original.id}/publish`, "POST", { version: original.version });
  const page = await context.newPage(), errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("dialog", dialog => void dialog.accept());
  await page.setViewportSize({ width: 1600, height: 1100 });
  await page.goto(`/admin/pages/${original.id}`);
  await page.getByRole("button", { name: "展开设计器", exact: true }).click();
  const frame = page.frameLocator('iframe[title="拖拽设计画布"]');
  await expect(frame.getByRole("heading", { name: "旧版首屏" })).toBeVisible();
  await frame.getByRole("heading", { name: "旧版首屏" }).dblclick();
  await frame.getByRole("textbox", { name: "画布标题" }).fill("画布直接修改标题");
  await page.getByLabel("模块标题", { exact: true }).click();
  await expect(frame.getByRole("heading", { name: "画布直接修改标题" })).toBeVisible();
  await expect(page.getByLabel("模块标题", { exact: true })).toHaveValue("画布直接修改标题");
  await page.getByRole("button", { name: "撤销操作", exact: true }).click();
  await expect(frame.getByRole("heading", { name: "旧版首屏" })).toBeVisible();
  await page.getByRole("button", { name: "重做操作", exact: true }).click();
  await expect(frame.getByRole("heading", { name: "画布直接修改标题" })).toBeVisible();
  // Exercise a real drag from the palette into the GrapesJS iframe.
  const source = page.locator(".block-inserter").getByRole("button", { name: "图片展示", exact: true });
  const target = await frame.locator('[data-gjs-type="wrapper"]').boundingBox();
  await source.hover(); await page.mouse.down();
  await page.mouse.move(target!.x + 20, target!.y + 16, { steps: 15 });
  await page.mouse.move(target!.x + 40, target!.y + 20, { steps: 5 });
  await page.mouse.up();
  await expect(frame.locator('[data-cms-id]')).toHaveCount(5);
  await expect(page.getByLabel("模块标题", { exact: true })).toHaveValue("图片展示");
  await page.getByLabel("上传模块图片", { exact: true }).setInputFiles({ name: "grapes.png", mimeType: "image/png",
    buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a0foAAAAASUVORK5CYII=", "base64") });
  await expect(frame.locator("img.page-block-image")).toBeVisible();
  await page.getByLabel("图片说明", { exact: true }).fill("拖拽图片说明");
  // Keyboard-accessible movement uses the same saved order as a canvas gesture.
  await page.getByRole("button", { name: "下移", exact: true }).click();
  await page.getByRole("button", { name: "复制模块", exact: true }).click();
  await expect(frame.locator('[data-cms-id]')).toHaveCount(6);
  await page.getByRole("button", { name: "撤销操作", exact: true }).click();
  await expect(frame.locator('[data-cms-id]')).toHaveCount(5);
  // Move an existing module using GrapesJS's actual canvas toolbar, then undo it.
  await frame.getByRole("heading", { name: "图片展示", exact: true }).click();
  const order = await frame.locator('[data-cms-id]').evaluateAll(nodes => nodes.map(node => node.getAttribute("data-cms-id")));
  const moveHandle = page.locator('.gjs-toolbar-item[draggable="true"]');
  await moveHandle.hover(); await page.mouse.down();
  await page.mouse.move(target!.x + 60, target!.y + 16, { steps: 15 });
  await page.mouse.move(target!.x + 80, target!.y + 20, { steps: 5 });
  await page.mouse.up();
  await expect(frame.locator('[data-cms-id]').first().locator('[data-block]')).toHaveAttribute("data-block", "image");
  await page.getByRole("button", { name: "撤销操作", exact: true }).click();
  await expect.poll(() => frame.locator('[data-cms-id]').evaluateAll(nodes => nodes.map(node => node.getAttribute("data-cms-id")))).toEqual(order);
  await expect(page.locator(".block-inserter").getByRole("button", { name: "客户咨询", exact: true })).toBeDisabled();
  await page.getByRole("group", { name: "画布设备", exact: true }).getByRole("button", { name: "手机" }).click();
  await expect.poll(() => frame.locator("body").evaluate(() => innerWidth)).toBe(375);
  await page.getByRole("group", { name: "画布设备", exact: true }).getByRole("button", { name: "电脑" }).click();
  await page.screenshot({ path: `${process.env.CMS_TEST_ARTIFACTS}/grapes-editor.png`, fullPage: true });
  await page.getByRole("button", { name: "退出全屏", exact: true }).click();
  await page.getByRole("button", { name: "保存草稿", exact: true }).click();
  await expect(page.getByText("草稿已保存。", { exact: true })).toBeVisible();
  const saved = await call(`admin/contents/${original.id}`);
  expect(saved.layout.blocks).toHaveLength(5);
  expect(saved.layout.blocks.find((b: { type: string }) => b.type === "hero").mobile).toEqual(original.layout.blocks[0].mobile);
  expect((await call("public/contents/grapes-acceptance")).layout.blocks[0].title).toBe("旧版首屏");
  await page.reload();
  await expect(frame.getByRole("heading", { name: "画布直接修改标题" })).toBeVisible();
  await expect(frame.locator("img.page-block-image")).toHaveCount(1);
  await page.getByRole("button", { name: "保存并发布", exact: true }).click();
  await expect(page.getByText("已发布，网站内容已更新。", { exact: true })).toBeVisible();
  const guest = await browser.newContext({ baseURL: process.env.CMS_TEST_BASE_URL });
  const publicPage = await guest.newPage();
  await publicPage.goto("/pages/grapes-acceptance");
  await expect(publicPage.getByRole("heading", { name: "画布直接修改标题" })).toBeVisible();
  await expect(publicPage.getByAltText("拖拽图片说明")).toBeVisible();
  await expect(publicPage.locator('[data-inquiry-slot] .inquiry-section')).toHaveCount(1);
  expect(await publicPage.locator('script[src*="grapes"]').count()).toBe(0);
  await frame.getByRole("heading", { name: "画布直接修改标题" }).dblclick();
  await frame.getByRole("textbox", { name: "画布标题" }).fill("字".repeat(201));
  await expect(frame.getByRole("textbox", { name: "画布标题" })).toHaveText("字".repeat(200));
  await expect(page.getByText("标题最多 200 个字符。", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "撤销操作", exact: true }).click();
  await expect(frame.getByRole("heading", { name: "画布直接修改标题" })).toBeVisible();
  expect(errors).toEqual([]);
  await guest.close(); await context.close();
});
