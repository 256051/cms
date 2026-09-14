import { test, expect } from "@playwright/test";
import { fillCaptcha } from "./login";
import fs from "node:fs";
import path from "node:path";
const credentials = JSON.parse(
  fs
    .readFileSync(process.env.CMS_TEST_CREDENTIALS_PATH!, "utf8")
    .replace(/^\uFEFF/, ""),
);
const png = fs.readFileSync(path.resolve("../tests/fixtures/editor.png"));

test("rich editor: formatting, insertion, media, safe round trip and seven theme layouts", async ({
  page,
  request,
}) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.route("https://example.com/**", (route) =>
    route.fulfill({ contentType: "text/html", body: "<p>Sandbox preview</p>" }),
  );
  await page.goto("/admin/login");
  await page.getByLabel("账号", { exact: true }).fill(credentials.username);
  await page.getByLabel("密码", { exact: true }).fill(credentials.password);
  await fillCaptcha(page);
  await page.getByRole("button", { name: "登录工作台" }).click();
  await expect(page.getByRole("heading", { name: /你好/ })).toBeVisible();
  await page.setViewportSize({ width: 1440, height: 1080 });
  await page.goto("/admin/posts/new");
  const slug = "rich-browser-" + Date.now().toString(36);
  await page.getByLabel("标题", { exact: true }).fill("丰富编辑器浏览器验收");
  await page.getByLabel("访问地址").fill(slug);
  const body = page.locator(".tiptap");
  await body.fill("排版正文");
  await body.press("Control+A");
  await page.getByRole("button", { name: "粗体", exact: true }).click();
  await page.getByRole("button", { name: "下划线", exact: true }).click();
  await page.getByRole("button", { name: "高亮", exact: true }).click();
  await page.getByLabel("字号", { exact: true }).selectOption("24px");
  await page.getByLabel("字体", { exact: true }).selectOption("serif");
  await page.getByLabel("行距", { exact: true }).selectOption("1.5");
  await page.getByRole("button", { name: "居中", exact: true }).click();
  await page
    .getByLabel("文字颜色", { exact: true })
    .evaluate((input: HTMLInputElement) => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )!.set!.call(input, "#c026d3");
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
  await expect(page.getByLabel("文字颜色", { exact: true })).toHaveValue(
    "#c026d3",
  );
  await expect(body.locator("strong u, u strong")).toContainText("排版正文");
  await expect(body.locator("mark")).toContainText("排版正文");
  async function end() {
    await body.press("Control+End");
    await body.press("Enter");
  }
  async function insert(name: string) {
    await page.getByRole("button", { name: "插入", exact: true }).click();
    await page.getByRole("menuitem", { name, exact: true }).click();
  }
  await end();
  await page.getByRole("button", { name: "清除格式", exact: true }).click();
  // Paste an actual clipboard image, then drop a second image at the editor position.
  await body.evaluate((el, base64) => {
    const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
    const d = new DataTransfer();
    d.items.add(new File([bytes], "pasted.png", { type: "image/png" }));
    el.dispatchEvent(
      new ClipboardEvent("paste", {
        clipboardData: d,
        bubbles: true,
        cancelable: true,
      }),
    );
  }, png.toString("base64"));
  await expect(body.locator("img")).toHaveCount(1);
  await end();
  await body.evaluate((el, base64) => {
    const r = el.getBoundingClientRect();
    const d = new DataTransfer();
    d.items.add(
      new File(
        [Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))],
        "dropped.png",
        { type: "image/png" },
      ),
    );
    el.dispatchEvent(
      new DragEvent("drop", {
        dataTransfer: d,
        clientX: r.x + 20,
        clientY: r.y + 20,
        bubbles: true,
        cancelable: true,
      }),
    );
  }, png.toString("base64"));
  await expect(body.locator("img")).toHaveCount(2);
  await body.locator("img").first().click();
  await page.getByRole("button", { name: "图片设置", exact: true }).click();
  await page.getByLabel("图片说明", { exact: true }).fill("可访问的图片说明");
  await page.getByLabel("图片宽度").selectOption("50");
  await page.getByLabel("图片对齐").selectOption("right");
  await page.getByRole("button", { name: "确定", exact: true }).click();
  await expect(body.locator('img[data-width="50"]')).toHaveAttribute(
    "data-align",
    "right",
  );
  await end();
  await insert("图片集");
  const options = page.locator(".editor-asset-option");
  await options.nth(0).locator("input").check();
  await options.nth(1).locator("input").check();
  await page.getByRole("button", { name: /插入所选/ }).click();
  await expect(body.locator('[data-type="gallery"] img')).toHaveCount(2);
  // Native history groups edits within 500 ms; let the next structural action start its own event.
  await page.waitForTimeout(600);
  await body.locator('[data-type="gallery"] img').first().click();
  await page.getByRole("button", { name: "解散图片集", exact: true }).click();
  await expect(body.locator('[data-type="gallery"]')).toHaveCount(0);
  await page.getByRole("button", { name: "撤销", exact: true }).click();
  await expect(body.locator('[data-type="gallery"] img')).toHaveCount(2);
  await body.locator('[data-type="gallery"] img').first().click();
  await page.getByRole("button", { name: "移除选中媒体", exact: true }).click();
  await body.locator('[data-type="gallery"] img').first().click();
  await page.getByRole("button", { name: "移除选中媒体", exact: true }).click();
  await expect(body.locator('[data-type="gallery"]')).toHaveCount(0);
  await expect(body.locator("img")).toHaveCount(2);
  await end();
  await insert("图片集");
  await page.locator(".editor-asset-option input").nth(0).check();
  await page.locator(".editor-asset-option input").nth(1).check();
  await page.getByRole("button", { name: /插入所选/ }).click();
  await end();
  await insert("分栏卡片");
  await page.getByLabel("分栏数量").selectOption("2");
  await page.getByRole("button", { name: "确定", exact: true }).click();
  const columns = body.locator('[data-type="column"]');
  await columns.nth(0).locator("p").click();
  await page.keyboard.insertText("左栏正文");
  await columns.nth(1).locator("p").click();
  await page.keyboard.insertText("右栏正文");
  await end();
  await insert("插入表格");
  await page.getByLabel("行数", { exact: true }).fill("2");
  await page.getByLabel("列数", { exact: true }).fill("2");
  await page.getByRole("button", { name: "确定", exact: true }).click();
  await body.locator("th").first().click();
  await page.keyboard.insertText("表头");
  await page.getByRole("button", { name: "下方插入行", exact: true }).click();
  await expect(body.locator("tr")).toHaveCount(3);
  const cells = body.locator("tr").nth(1).locator("td");
  await cells.first().scrollIntoViewIfNeeded();
  const a = await cells.nth(0).boundingBox(),
    b = await cells.nth(1).boundingBox();
  await page.mouse.move(a!.x + 10, a!.y + 10);
  await page.mouse.down();
  await page.mouse.move(b!.x + 10, b!.y + 10, { steps: 6 });
  await page.mouse.up();
  await expect(
    page.getByRole("button", { name: "合并单元格", exact: true }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "合并单元格", exact: true }).click();
  await expect(body.locator('td[colspan="2"]')).toHaveCount(1);
  await page.getByRole("button", { name: "拆分单元格", exact: true }).click();
  await expect(body.locator('td[colspan="2"]')).toHaveCount(0);
  await end();
  await insert("代码块");
  await page.getByLabel("代码语言").selectOption("csharp");
  await page.keyboard.insertText('Console.WriteLine("Hello");');
  await body.press("ArrowDown");
  await body.press("ArrowDown");
  await end();
  for (const [kind, ext] of [
    ["视频", "mp4"],
    ["音频", "wav"],
  ] as const) {
    await insert(kind);
    const chooser = page.waitForEvent("filechooser");
    await page.getByRole("button", { name: "上传并插入", exact: true }).click();
    await (
      await chooser
    ).setFiles(path.resolve("../tests/fixtures/editor." + ext));
    await expect(body.locator(ext === "mp4" ? "video" : "audio")).toHaveCount(
      1,
    );
    await end();
  }
  await insert("嵌入网页");
  await page.getByLabel("网页地址").fill("http://localhost");
  await page.getByRole("button", { name: "确定", exact: true }).click();
  await expect(page.locator(".editor-dialog [role=alert]")).toContainText(
    "HTTPS",
  );
  await page.getByLabel("网页地址").fill("https://example.com/");
  await page.getByLabel("网页标题").fill("示例框架");
  await page.getByRole("button", { name: "确定", exact: true }).click();
  await expect(body.locator("iframe")).toHaveAttribute(
    "sandbox",
    "allow-scripts",
  );
  // Slash menu is fully operable from the keyboard.
  await end();
  await page.keyboard.insertText("/");
  await expect(page.getByRole("menu", { name: "插入内容" })).toBeVisible();
  await body.press("ArrowDown");
  await body.press("Enter");
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(body).toBeFocused();
  await page.getByRole("button", { name: "收起发布设置" }).click();
  await expect(page.locator(".editor-aside")).toBeHidden();
  await page.getByRole("button", { name: "显示发布设置" }).click();
  await page.screenshot({
    path: "../artifacts/rich-editor-desktop.png",
    fullPage: true,
    animations: "disabled",
  });
  await body.press("Control+s");
  await expect(page).toHaveURL(/\/admin\/posts\/[a-f0-9]{32}$/);
  await expect(body.locator('[data-type="gallery"] img')).toHaveCount(2);
  await expect(body.locator('[data-type="column"]')).toHaveCount(2);
  await expect(body.locator("audio")).toHaveCount(1);
  await expect(body.locator("video")).toHaveCount(1);
  await expect(body.locator("mark")).toContainText("排版正文");
  await body.locator("mark").first().click();
  await expect(page.getByLabel("文字颜色", { exact: true })).toHaveValue(
    "#c026d3",
  );
  await expect(body.locator("code.language-csharp")).toContainText(
    "Console.WriteLine",
  );
  await page.getByRole("button", { name: "保存并发布", exact: true }).click();
  await expect(page.getByText("已发布，网站内容已更新。")).toBeVisible();
  const editUrl = page.url();
  const html = await (await request.get("/posts/" + slug)).text();
  for (const value of [
    "左栏正文",
    "右栏正文",
    'data-type="gallery"',
    'data-type="columns"',
    "<video",
    "<audio",
    'sandbox="allow-scripts"',
    "language-csharp",
    "font-size: 24px",
  ])
    expect(html).toContain(value);
  const csrf = (await (await page.request.get("/api/v1/auth/csrf")).json()).data
    .token;
  const themes = (await (await page.request.get("/api/v1/admin/themes")).json())
    .data;
  let state = themes;
  try {
    for (const theme of themes.themes) {
      const response = await page.request.put("/api/v1/admin/themes/active", {
        headers: { "X-CSRF-TOKEN": csrf },
        data: {
          themeId: theme.id,
          options: theme.options,
          version: state.version,
        },
      });
      expect(response.ok()).toBe(true);
      state = (await response.json()).data;
      for (const width of [375, 768, 1440]) {
        await page.setViewportSize({ width, height: 1000 });
        await page.goto("/posts/" + slug);
        await expect(page.locator('.prose [data-type="column"]')).toHaveCount(
          2,
        );
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth + 1,
          ),
        ).toBe(true);
        if (width === 375)
          await page.screenshot({
            path: `../artifacts/rich-${theme.id}-mobile.png`,
            fullPage: true,
            animations: "disabled",
          });
      }
      await expect
        .poll(() =>
          page
            .locator(".prose video")
            .evaluate((v: HTMLVideoElement) => v.readyState),
        )
        .toBeGreaterThanOrEqual(1);
      await expect
        .poll(() =>
          page
            .locator(".prose audio")
            .evaluate((v: HTMLAudioElement) => v.readyState),
        )
        .toBeGreaterThanOrEqual(1);
      await page.locator(".prose video").evaluate((v: HTMLVideoElement) => {
        v.muted = true;
        return v.play();
      });
      await expect
        .poll(() =>
          page
            .locator(".prose video")
            .evaluate((v: HTMLVideoElement) => v.currentTime),
        )
        .toBeGreaterThan(0);
    }
  } finally {
    await page.request.put("/api/v1/admin/themes/active", {
      headers: { "X-CSRF-TOKEN": csrf },
      data: {
        themeId: themes.activeThemeId,
        options: themes.themes.find(
          (t: { id: string }) => t.id === themes.activeThemeId,
        ).options,
        version: state.version,
      },
    });
  }
  await page.setViewportSize({ width: 375, height: 900 });
  await page.goto(editUrl);
  await body.press("Control+End");
  await page.keyboard.insertText("未发布的新文字");
  await page.route(
    "**/api/v1/admin/contents/*",
    (route) =>
      route.request().method() === "PUT"
        ? route.fulfill({
            status: 503,
            contentType: "application/json",
            body: JSON.stringify({
              code: "TEST_FAILURE",
              message: "保存测试失败",
              data: null,
              traceId: "editor-test",
            }),
          })
        : route.continue(),
    { times: 1 },
  );
  await page.getByRole("button", { name: "保存草稿", exact: true }).click();
  await expect(page.locator(".admin-main .alert").first()).toContainText(
    "保存测试失败",
  );
  await expect(body).toContainText("未发布的新文字");
  expect(await (await request.get("/posts/" + slug)).text()).not.toContain(
    "未发布的新文字",
  );
  await page.getByRole("button", { name: "保存草稿", exact: true }).click();
  await expect(page.getByText("草稿已保存。", { exact: true })).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "../artifacts/rich-editor-mobile.png",
    fullPage: true,
    animations: "disabled",
  });
  expect(errors).toEqual([]);
});
