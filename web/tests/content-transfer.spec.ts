import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { loginCaptcha } from "./login";

if (!process.env.CMS_TEST_BASE_URL || !process.env.CMS_TEST_CREDENTIALS_PATH || !process.env.CMS_TEST_ARTIFACTS)
  throw new Error("Content transfer checks require an explicitly configured isolated test site.");

test("three content lists export and import ZIPs through the web proxy, including packages above 10 MiB", async ({ page, context }) => {
  test.setTimeout(180_000);
  const credentials = JSON.parse(fs.readFileSync(process.env.CMS_TEST_CREDENTIALS_PATH!, "utf8").replace(/^\uFEFF/, ""));
  let token = (await (await context.request.get("/api/v1/auth/csrf")).json()).data.token;
  const login = await context.request.post("/api/v1/auth/login", { headers: { "X-CSRF-TOKEN": token }, data: { ...credentials, ...await loginCaptcha(context.request) } });
  expect(login.ok()).toBeTruthy();
  token = (await (await context.request.get("/api/v1/auth/csrf")).json()).data.token;
  async function api(endpoint: string, method = "GET", data?: unknown) {
    const response = await context.request.fetch("/api/v1/" + endpoint, { method, data, headers: { "X-CSRF-TOKEN": token } });
    expect(response.ok(), await response.text()).toBeTruthy();
    return (await response.json()).data;
  }
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  const image = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a0foAAAAASUVORK5CYII=", "base64");
  const assets: { id: string; url: string }[] = [];
  for (let i = 0; i < 3; i++) {
    const response = await context.request.post("/api/v1/admin/assets", { headers: { "X-CSRF-TOKEN": token }, multipart: {
      file: { name: `transfer-${i}.png`, mimeType: "image/png", buffer: Buffer.concat([image, randomBytes(4 * 1024 * 1024)]) },
    } });
    expect(response.ok()).toBeTruthy(); assets.push((await response.json()).data);
  }
  for (const [kind, section, label] of [["product", "products", "产品"], ["case", "cases", "案例"], ["page", "pages", "独立页面"]]) {
    const title = `ZIP ${label}浏览器验收`;
    const row = await api("admin/contents", "POST", { kind, slug: "zip-browser-" + kind, title, summary: "导入导出", version: 0,
      html: `<p>完整正文</p>${assets.map(x => `<img src="${x.url}">`).join("")}`, coverId: assets[0].id, categoryId: "", tagIds: [],
      fields: kind === "page" ? [] : [{ key: "model", label: "型号", value: "ZIP-100" }] });
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto("/admin/" + section);
    await expect(page.getByRole("heading", { name: label, exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "导出筛选结果", exact: true })).toBeEnabled();
    if (kind === "product") {
      await page.getByRole("checkbox", { name: "选择 " + title, exact: true }).check();
      await expect(page.getByRole("button", { name: "导出所选（1）", exact: true })).toBeVisible();
    }
    const pending = page.waitForEvent("download");
    await page.getByRole("button", { name: /^导出(所选|筛选结果)/ }).click();
    const download = await pending;
    const zip = path.join(process.env.CMS_TEST_ARTIFACTS!, kind + ".zip");
    await download.saveAs(zip);
    expect(fs.statSync(zip).size).toBeGreaterThan(10 * 1024 * 1024);
    await expect(page.getByRole("button", { name: "导入", exact: true })).toBeEnabled();
    await page.getByRole("button", { name: "导入", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "导入" + label, exact: true });
    await dialog.getByLabel("ZIP 内容包", { exact: true }).setInputFiles(zip);
    await page.setViewportSize({ width: 375, height: 812 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBeTruthy();
    await dialog.screenshot({ path: path.join(process.env.CMS_TEST_ARTIFACTS!, kind + "-import-mobile.png") });
    await dialog.getByRole("button", { name: "导入为新草稿", exact: true }).click();
    await expect(dialog.getByRole("status")).toContainText("已导入 1 条草稿、3 个附件", { timeout: 30_000 });
    await expect(dialog.getByRole("status")).toContainText("1 条地址重复");
    const href = await dialog.getByRole("link", { name: title, exact: true }).getAttribute("href");
    const imported = await api("admin/contents/" + href!.split("/").pop());
    expect(imported.published).toBe(false);
    expect(imported.coverId).not.toBe(row.coverId);
    expect(imported.html).not.toContain(row.coverId);
    expect(imported.fields).toEqual(row.fields);
    await dialog.getByRole("button", { name: "完成", exact: true }).click();
    await expect(page.getByRole("link", { name: title, exact: true })).toHaveCount(2);
    for (const width of [375, 768, 1440]) {
      await page.setViewportSize({ width, height: 1000 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBeTruthy();
      await page.screenshot({ path: path.join(process.env.CMS_TEST_ARTIFACTS!, `${kind}-${width}.png`) });
    }
  }
  await page.getByRole("button", { name: "导入", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("ZIP 内容包", { exact: true }).setInputFiles({ name: "broken.zip", mimeType: "application/zip", buffer: Buffer.from("invalid zip") });
  await dialog.getByRole("button", { name: "导入为新草稿", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText("无法读取 ZIP 内容包");
  await expect(dialog.getByLabel("ZIP 内容包", { exact: true })).toHaveValue(/broken\.zip$/);
  await dialog.getByRole("button", { name: "取消", exact: true }).click();
  expect(errors).toEqual([]);
});
