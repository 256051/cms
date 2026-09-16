import { fillCaptcha } from "./login";
import { test, expect } from "@playwright/test";
import fs from "node:fs";

if (!process.env.CMS_TEST_BASE_URL || !process.env.CMS_TEST_CREDENTIALS_PATH)
  throw new Error("请通过 python tests/docker_smoke.py 在独立测试站点运行浏览器验收。");

const credentials = JSON.parse(
  fs
    .readFileSync(process.env.CMS_TEST_CREDENTIALS_PATH, "utf8")
    .replace(/^\uFEFF/, ""),
);

test("editorial lifecycle, server HTML, mobile layout and keyboard navigation", async ({
  page,
  request,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/admin/login");
  await page.getByLabel("账号", { exact: true }).fill(credentials.username);
  await page.getByLabel("密码", { exact: true }).fill(credentials.password);
  await fillCaptcha(page);
  await page.getByRole("button", { name: "登录工作台" }).click();
  await expect(page.getByRole("heading", { name: /你好/ })).toBeVisible();
  await page.setViewportSize({ width: 1440, height: 1080 });
  await page.screenshot({
    path: "../artifacts/admin-desktop.png",
    fullPage: true,
  });
  await page
    .getByRole("link", { name: "写文章", exact: false })
    .first()
    .click();
  const stamp = Date.now().toString(36);
  const title = `浏览器验收：让每个想法被看见 ${stamp}`;
  const slug = `browser-${stamp}`;
  await page.getByLabel("标题", { exact: true }).fill(title);
  await page
    .getByLabel("摘要", { exact: true })
    .fill("通过真实浏览器创建、上传图片、发布，并核对服务器直接返回的正文。");
  await page.getByLabel("访问地址").fill(slug);
  await page
    .locator(".tiptap")
    .fill(
      "这段正文通过真实浏览器编辑。保存草稿不会改变线上内容，发布后才对读者可见。",
    );
  await page.locator(".rich-editor input[type=file]").setInputFiles({
    name: "browser.png",
    mimeType: "image/png",
    buffer: Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a0foAAAAASUVORK5CYII=",
      "base64",
    ),
  });
  await expect(page.locator(".tiptap img")).toHaveCount(1);
  await page.locator(".tiptap").press("Control+End");
  await page.locator(".tiptap").press("Enter");
  await page
    .getByRole("button", { name: "从附件库插入图片", exact: true })
    .click();
  await page.getByRole("dialog", { name: "插入图片", exact: true }).getByRole("radio", { name: "browser.png", exact: true }).check();
  await page.getByRole("button", { name: /插入所选/ }).click();
  await expect(page.locator(".tiptap img")).toHaveCount(2);
  await page.getByRole("button", { name: "保存草稿", exact: true }).click();
  await expect(page).toHaveURL(/\/admin\/posts\/[a-f0-9]{32}$/);
  const editUrl = page.url();
  expect((await request.get("/posts/" + slug)).status()).toBe(404);
  await page.route(
    "**/api/v1/admin/contents/*/publish",
    (route) =>
      route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({
          code: "TEMPORARILY_UNAVAILABLE",
          message: "发布服务暂时不可用，请重试。",
          data: null,
          traceId: "browser-check",
        }),
      }),
    { times: 1 },
  );
  await page.getByRole("button", { name: "保存并发布", exact: true }).click();
  await expect(page.getByText("发布服务暂时不可用，请重试。")).toBeVisible();
  expect((await request.get("/posts/" + slug)).status()).toBe(404);
  await page.getByRole("button", { name: "保存并发布", exact: true }).click();
  await expect(page.getByText("已发布，网站内容已更新。")).toBeVisible();
  const response = await request.get("/posts/" + slug);
  expect(response.status()).toBe(200);
  const html = await response.text();
  expect(html).toContain("这段正文通过真实浏览器编辑");
  expect(html).toContain('rel="canonical"');
  expect(html).toContain('name="description"');
  expect((await request.get("/sitemap.xml")).status()).toBe(200);
  await page
    .locator(".tiptap")
    .fill("这是尚未发布的新正文，不应该泄漏给访客。");
  await page.getByRole("button", { name: "保存草稿", exact: true }).click();
  await expect(page.getByText("草稿已保存。", { exact: true })).toBeVisible();
  expect(await (await request.get("/posts/" + slug)).text()).not.toContain(
    "这是尚未发布的新正文",
  );
  await page.screenshot({
    path: "../artifacts/editor-desktop.png",
    fullPage: true,
  });
  for (const url of [
    "/admin/posts",
    "/admin/pages",
    "/admin/taxonomy",
    "/admin/assets",
    "/admin/comments",
    "/admin/menu",
    "/admin/settings",
    "/admin/users",
    "/admin/audit",
    "/admin/password",
  ]) {
    await page.goto(url);
    await expect(page.locator(".admin-main h1")).toBeVisible();
    await expect(page.locator(".admin-main .alert")).toHaveCount(0);
  }
  await page.goto("/");
  await page.screenshot({
    path: "../artifacts/public-desktop.png",
    fullPage: true,
  });
  for (const width of [375, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/posts/" + slug);
    await expect(
      page.getByRole("heading", { name: title, exact: true }),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth + 1,
      ),
    ).toBe(true);
    if (width === 375)
      await page.screenshot({
        path: "../artifacts/article-mobile.png",
        fullPage: true,
      });
  }
  await page.setViewportSize({ width: 375, height: 900 });
  await page.goto("/admin");
  await page.getByRole("button", { name: "打开导航" }).click();
  await page.getByRole("link", { name: "附件库", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "附件库", exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "../artifacts/admin-mobile.png",
    fullPage: true,
  });
  await page.goto(editUrl);
  await expect(page.locator(".tiptap")).toBeVisible();
  await page.locator(".tiptap").fill("移动端保存的草稿，等待下一次发布。");
  await page.getByRole("button", { name: "保存草稿", exact: true }).click();
  await expect(page.getByText("草稿已保存。", { exact: true })).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "../artifacts/editor-mobile.png",
    fullPage: true,
  });
  await page.goto("/");
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "跳到正文" })).toBeFocused();
  expect(errors).toEqual([]);
});
