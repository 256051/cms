import { test, expect } from "@playwright/test";
import fs from "node:fs";
import { loginCaptcha } from "./login";

if (!process.env.CMS_TEST_BASE_URL || !process.env.CMS_TEST_CREDENTIALS_PATH)
  throw new Error("An isolated site is required.");
const credentials = JSON.parse(
  fs
    .readFileSync(process.env.CMS_TEST_CREDENTIALS_PATH, "utf8")
    .replace(/^\uFEFF/, ""),
);

test("shared attachment previews preserve choices, search all pages and work across editing surfaces", async ({
  page,
}) => {
  test.setTimeout(180000);
  let csrf = (await (await page.request.get("/api/v1/auth/csrf")).json()).data
    .token;
  const login = await page.request.post("/api/v1/auth/login", {
    headers: { "X-CSRF-TOKEN": csrf },
    data: { ...credentials, ...(await loginCaptcha(page.request)) },
  });
  expect(login.ok(), await login.text()).toBeTruthy();
  csrf = (await (await page.request.get("/api/v1/auth/csrf")).json()).data
    .token;
  async function read(path: string) {
    return (await (await page.request.get("/api/v1/" + path)).json()).data;
  }
  async function upload(name: string, mimeType: string, buffer: Buffer) {
    const response = await page.request.post("/api/v1/admin/assets", {
      headers: { "X-CSRF-TOKEN": csrf },
      multipart: { file: { name, mimeType, buffer } },
    });
    expect(response.ok(), await response.text()).toBeTruthy();
    return (await response.json()).data;
  }
  const png = fs.readFileSync("../tests/fixtures/editor.png");
  const images = [];
  for (let i = 0; i < 42; i++)
    images.push(
      await upload(`封面-${String(i).padStart(2, "0")}.png`, "image/png", png),
    );
  const video = await upload(
    "演示视频.mp4",
    "video/mp4",
    fs.readFileSync("../tests/fixtures/editor.mp4"),
  );
  const audio = await upload(
    "演示音频.wav",
    "audio/wav",
    fs.readFileSync("../tests/fixtures/editor.wav"),
  );
  await upload(
    "产品说明.pdf",
    "application/pdf",
    Buffer.from("%PDF-1.4\n1 0 obj\n<<>>\nendobj\n%%EOF"),
  );
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/admin/posts/new");
  await page.getByLabel("标题", { exact: true }).fill("附件预览验收");
  await page.getByRole("button", { name: "保存草稿", exact: true }).click();
  await expect(page).toHaveURL(/\/admin\/posts\/[a-f0-9]{32}$/);
  const contentId = page.url().split("/").pop()!;
  const coverButton = page.getByRole("button", {
    name: "从附件库选择",
    exact: true,
  });
  await coverButton.click();
  const cover = page.getByRole("dialog", { name: "从附件库选择", exact: true });
  await expect(cover.locator(".editor-asset-option")).toHaveCount(40);
  expect(await cover.getByRole("button", { name: /使用所选图片/ }).evaluate(el => { const box = el.getBoundingClientRect(); return box.top >= 0 && box.bottom <= innerHeight; })).toBeTruthy();
  await page.screenshot({ path: `${process.env.CMS_TEST_ARTIFACTS}/asset-picker-library.png` });
  await cover.getByRole("button", { name: "下一页", exact: true }).click();
  await expect(cover.locator(".editor-asset-option")).toHaveCount(2);
  await cover.getByLabel("搜索附件库", { exact: true }).fill(images[0].name);
  await expect(cover.locator(".editor-asset-option")).toHaveCount(1);
  await cover
    .getByRole("button", { name: `预览 ${images[0].name}`, exact: true })
    .click();
  const detail = page.getByRole("dialog", {
    name: `预览 ${images[0].name}`,
    exact: true,
  });
  await expect(detail.getByRole("img")).toBeVisible();
  await expect
    .poll(() =>
      detail
        .getByRole("img")
        .evaluate((img: HTMLImageElement) => img.naturalWidth),
    )
    .toBeGreaterThan(1);
  await detail.getByRole("button", { name: "选择此附件", exact: true }).click();
  await expect(
    cover.getByRole("radio", { name: images[0].name, exact: true }),
  ).toBeChecked();
  await cover.getByRole("button", { name: /使用所选图片/ }).click();
  await expect(page.locator(".cover-preview")).toHaveAttribute(
    "src",
    images[0].url,
  );
  await coverButton.click();
  await cover
    .getByRole("radio", { name: images[41].name, exact: true })
    .check();
  await page.keyboard.press("Escape");
  await expect(cover).toHaveCount(0);
  await expect(coverButton).toBeFocused();
  await expect(page.locator(".cover-preview")).toHaveAttribute(
    "src",
    images[0].url,
  );
  await coverButton.click();
  await cover.getByLabel("搜索附件库", { exact: true }).fill("不存在的文件");
  await expect(
    cover.getByText("没有找到匹配的附件，请调整关键词。"),
  ).toBeVisible();
  await page.route("**/api/v1/admin/assets?**", (route) => route.abort(), {
    times: 1,
  });
  await cover.getByLabel("搜索附件库", { exact: true }).fill(images[0].name);
  await cover.getByRole("button", { name: "重新加载", exact: true }).click();
  await expect(
    cover.getByRole("radio", { name: images[0].name, exact: true }),
  ).toBeChecked();
  await page.setViewportSize({ width: 375, height: 812 });
  await expect(cover).toBeVisible();
  expect(
    await cover.evaluate((el) => el.scrollWidth <= el.clientWidth),
  ).toBeTruthy();
  await page.screenshot({
    path: `${process.env.CMS_TEST_ARTIFACTS}/asset-picker-mobile.png`,
  });
  await page.keyboard.press("Escape");
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page
    .getByRole("button", { name: "从附件库插入图片", exact: true })
    .click();
  const imageDialog = page.getByRole("dialog", {
    name: "插入图片",
    exact: true,
  });
  await imageDialog
    .getByRole("radio", { name: images[41].name, exact: true })
    .check();
  await imageDialog.getByRole("button", { name: /插入所选/ }).click();
  await expect(page.locator(".tiptap")).toBeFocused();
  await expect(
    page.locator(`.tiptap img[src="${images[41].url}"]`),
  ).toHaveCount(1);
  async function insert(kind: string) {
    await page.locator(".tiptap").press("Control+End");
    await page.locator(".tiptap").press("Enter");
    await page.getByRole("button", { name: "插入", exact: true }).click();
    await page.getByRole("menuitem", { name: kind === "附件" ? "选择附件" : kind, exact: true }).click();
    return page.getByRole("dialog", { name: `插入${kind}`, exact: true });
  }
  const gallery = await insert("图片集");
  await gallery
    .getByRole("checkbox", { name: images[41].name, exact: true })
    .check();
  await gallery.getByRole("button", { name: "下一页", exact: true }).click();
  await gallery
    .getByRole("checkbox", { name: images[0].name, exact: true })
    .check();
  await gallery
    .getByRole("button", { name: "插入所选（2）", exact: true })
    .click();
  await expect(page.locator('.tiptap [data-type="gallery"] img')).toHaveCount(
    2,
  );
  expect(
    await page
      .locator('.tiptap [data-type="gallery"] img')
      .evaluateAll((imgs) => imgs.map((img) => img.getAttribute("src"))),
  ).toEqual([images[41].url, images[0].url]);
  for (const [kind, asset, tag] of [
    ["视频", video, "video"],
    ["音频", audio, "audio"],
  ] as const) {
    const dialog = await insert(kind);
    await dialog
      .getByRole("button", { name: `预览 ${asset.name}`, exact: true })
      .click();
    const preview = page.getByRole("dialog", {
      name: `预览 ${asset.name}`,
      exact: true,
    });
    await expect(preview.locator(tag)).toHaveAttribute("controls", "");
    await expect
      .poll(() =>
        preview.locator(tag).evaluate((el: HTMLMediaElement) => el.readyState),
      )
      .toBeGreaterThan(0);
    await page.keyboard.press("Escape");
    await expect(
      dialog.getByRole("button", { name: `预览 ${asset.name}`, exact: true }),
    ).toBeFocused();
    await page.keyboard.press("Escape");
  }
  const files = await insert("附件");
  await files
    .getByLabel("文件类型", { exact: true })
    .selectOption("application");
  await files
    .getByRole("button", { name: "预览 产品说明.pdf", exact: true })
    .click();
  await expect(
    page
      .getByRole("dialog", { name: "预览 产品说明.pdf", exact: true })
      .getByRole("link"),
  ).toHaveAttribute("href", /\/media\//);
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "保存草稿", exact: true }).click();
  await expect
    .poll(async () => (await read(`admin/contents/${contentId}`)).coverId)
    .toBe(images[0].id);
  await page.goto("/admin/settings");
  const initialSettings = await read("admin/settings");
  for (const label of ["Logo", "浏览器图标 Favicon"]) {
    await page.getByRole("button", { name: label, exact: true }).click();
    const picker = page.getByRole("dialog", { name: label, exact: true });
    await picker.getByRole("button", { name: "下一页", exact: true }).click();
    await expect(picker.locator(".editor-asset-option")).toHaveCount(2);
    await picker.getByLabel("搜索附件库", { exact: true }).fill(images[0].name);
    await picker.getByLabel("搜索附件库", { exact: true }).press("Enter");
    await picker
      .getByRole("radio", { name: images[0].name, exact: true })
      .check();
    await picker.getByRole("button", { name: /使用所选图片/ }).click();
  }
  expect((await read("admin/settings")).version).toBe(initialSettings.version);
  await page.getByRole("button", { name: "保存设置", exact: true }).click();
  await expect
    .poll(async () => (await read("admin/settings")).faviconId)
    .toBe(images[0].id);
  expect((await read("admin/settings")).logoId).toBe(images[0].id);
  await page.goto("/admin/templates/new");
  await page.getByLabel("标题", { exact: true }).fill("模板图片选择验收");
  await page.getByRole("button", { name: "保存草稿", exact: true }).click();
  await expect(page).toHaveURL(/\/admin\/templates\/[a-f0-9]{32}$/);
  await page
    .locator(".block-inserter")
    .getByRole("button", { name: "图片展示", exact: true })
    .click();
  await page.getByRole("button", { name: "模块图片", exact: true }).click();
  const block = page.getByRole("dialog", { name: "模块图片", exact: true });
  await block.getByLabel("搜索附件库", { exact: true }).fill(images[0].name);
  await expect(block.locator(".editor-asset-option img")).toHaveCount(1);
  await expect.poll(() => block.locator(".editor-asset-option img").evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(1);
  await page.screenshot({
    path: `${process.env.CMS_TEST_ARTIFACTS}/asset-picker-desktop.png`,
  });
  await block.getByRole("radio", { name: images[0].name, exact: true }).check();
  await block.getByRole("button", { name: /使用所选图片/ }).click();
  await expect(page.locator(".builder-image-fields > img")).toHaveAttribute(
    "src",
    images[0].url,
  );
  await page
    .locator(".builder-image-fields")
    .getByRole("button", { name: "移除图片", exact: true })
    .click();
  await expect(page.locator(".builder-image-fields > img")).toHaveCount(0);
  expect((await page.request.get(images[0].url)).status()).toBe(200);
  expect(errors).toEqual([]);
});
