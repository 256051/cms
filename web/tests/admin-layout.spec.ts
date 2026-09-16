import { test, expect } from "@playwright/test";
import fs from "node:fs";
import { loginCaptcha } from "./login";

if (!process.env.CMS_TEST_BASE_URL || !process.env.CMS_TEST_CREDENTIALS_PATH || !process.env.CMS_TEST_ARTIFACTS)
  throw new Error("Layout checks require an isolated test site and artifact directory.");

test("admin pages keep controls aligned and contained at desktop, tablet and phone widths", async ({ page }) => {
  test.setTimeout(240000);
  const credentials = JSON.parse(fs.readFileSync(process.env.CMS_TEST_CREDENTIALS_PATH!, "utf8").replace(/^\uFEFF/, ""));
  let csrf = (await (await page.request.get("/api/v1/auth/csrf")).json()).data.token;
  const login = await page.request.post("/api/v1/auth/login", { headers: { "X-CSRF-TOKEN": csrf }, data: { ...credentials, ...await loginCaptcha(page.request) } });
  expect(login.ok(), await login.text()).toBeTruthy();
  csrf = (await (await page.request.get("/api/v1/auth/csrf")).json()).data.token;
  const created = await page.request.post("/api/v1/admin/contents", { headers: { "X-CSRF-TOKEN": csrf }, data: {
    kind: "post", title: "布局检查：一篇有较长标题、摘要与正文的文章", slug: "layout-check", summary: "用于检查真实内容下的表格排版。", html: "<p>用于检查编辑器布局的正文。</p>", coverId: "", categoryId: "", tagIds: [], version: 0,
  } });
  expect(created.ok(), await created.text()).toBeTruthy();
  const content = (await created.json()).data;
  const routes = ["", "posts", "pages", "templates", "blocks", "products", "cases", "taxonomy", "assets", "comments", "maintenance", "notifications", "traffic", "visitors", "leads", "inquiry-form", "menu", "settings", "themes", "users", "access-tokens", "audit", "password", ...["posts", "pages", "templates", "blocks", "products", "cases"].map(x => x + "/new"), "posts/" + content.id, "preview/" + content.id, "login"];
  const errors: string[] = [];
  const results: unknown[] = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("dialog", dialog => void dialog.accept());
  async function viewport(width: number) {
    await page.setViewportSize({ width, height: 1000 });
    if (width < 700 && await page.locator("#admin-navigation").count()) await expect.poll(async () => {
      const box = await page.locator("#admin-navigation").boundingBox(); return box!.x + box!.width;
    }).toBeLessThanOrEqual(1);
  }
  for (const route of routes) {
    await page.goto("/admin" + (route ? "/" + route : ""));
    await page.waitForLoadState("networkidle");
    await expect(page.locator(".loading")).toHaveCount(0);
    for (const width of [1920, 1440, 768, 375]) {
      await viewport(width);
      await page.evaluate(() => window.scrollTo(0, 0));
      const metrics = await page.evaluate(() => ({
        pageWidth: document.documentElement.scrollWidth,
        toolbars: [...document.querySelectorAll<HTMLElement>(".editorial-filters")].map(bar => ({
          justify: getComputedStyle(bar).justifyContent,
          height: bar.getBoundingClientRect().height,
          controls: [...bar.querySelectorAll<HTMLElement>("select, input:not([type=checkbox]), button")].map(el => {
            const box = el.getBoundingClientRect(); return { text: el.getAttribute("aria-label") || el.textContent?.slice(0, 35), x: box.x, bottom: box.bottom, width: box.width, border: getComputedStyle(el).borderWidth };
          }),
          labelMargins: [...bar.querySelectorAll("label")].map(el => getComputedStyle(el).marginBottom),
        })),
        panels: [...document.querySelectorAll<HTMLElement>(".admin-main .panel")].map(el => ({ className: el.className, padding: getComputedStyle(el).padding, width: el.clientWidth })),
        outside: [...document.querySelectorAll<HTMLElement>(".admin-main input, .admin-main select, .admin-main button, .admin-main textarea")].filter(el => {
          const r = el.getBoundingClientRect(); return r.width > 0 && !el.closest(".table-scroll, dialog:not([open])") && (r.left < -1 || r.right > innerWidth + 1);
        }).map(el => ({ tag: el.tagName, text: el.getAttribute("aria-label") || el.textContent?.slice(0, 50), className: el.className })),
      }));
      const name = (route || "overview").replaceAll("/", "-").replace(content.id, "existing");
      results.push({ route, width, ...metrics });
      await page.screenshot({ path: `${process.env.CMS_TEST_ARTIFACTS}/${name}-${width}.png`, animations: "disabled" });
      fs.writeFileSync(`${process.env.CMS_TEST_ARTIFACTS}/layout.json`, JSON.stringify({ errors, results }, null, 2));
      if (process.env.CMS_LAYOUT_BASELINE !== "1") {
        expect.soft(metrics.pageWidth, `${route} at ${width}: page overflow`).toBeLessThanOrEqual(width + 1);
        expect.soft(metrics.outside, `${route} at ${width}: clipped controls`).toEqual([]);
        if (width >= 1440) for (const toolbar of metrics.toolbars) {
          const bottoms = toolbar.controls.map(control => control.bottom);
          expect.soft(Math.max(...bottoms) - Math.min(...bottoms), `${route}: filter controls share a baseline`).toBeLessThanOrEqual(1);
          const [first, second] = toolbar.controls;
          expect.soft(second.x - first.x - first.width, `${route}: related controls remain grouped`).toBeLessThanOrEqual(16);
        }
      }
    }
  }
  await page.goto("/admin/posts/" + content.id);
  await expect(page.getByRole("heading", { name: "历史版本", exact: true })).toBeVisible();
  for (const width of [1440, 768, 375]) {
    await viewport(width);
    await page.locator(".editor-extras").screenshot({ path: `${process.env.CMS_TEST_ARTIFACTS}/history-${width}.png` });
  }
  await page.goto("/admin/assets");
  const png = Buffer.from(await page.evaluate(() => {
    const canvas = document.createElement("canvas"); canvas.width = 240; canvas.height = 160;
    const brush = canvas.getContext("2d")!; brush.fillStyle = "#dbeafe"; brush.fillRect(0, 0, 240, 160);
    brush.fillStyle = "#2563eb"; brush.fillRect(60, 40, 120, 80); return canvas.toDataURL("image/png").split(",")[1];
  }), "base64");
  await page.locator('input[type="file"]').setInputFiles({ name: "布局检查图片.png", mimeType: "image/png", buffer: png });
  await expect(page.locator(".asset-card")).toHaveCount(1);
  for (const width of [1440, 768, 375]) {
    await viewport(width);
    await page.screenshot({ path: `${process.env.CMS_TEST_ARTIFACTS}/assets-populated-${width}.png` });
  }
  await page.goto("/admin/posts/new");
  await page.getByRole("button", { name: "从附件库选择", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.locator(".editor-asset-card")).toHaveCount(1);
  for (const width of [1440, 768, 375]) {
    await viewport(width);
    expect(await dialog.evaluate(el => el.scrollWidth <= el.clientWidth + 1), `picker overflow at ${width}`).toBeTruthy();
    await page.screenshot({ path: `${process.env.CMS_TEST_ARTIFACTS}/picker-${width}.png` });
  }
  for (const [route, button, name] of [
    ["leads", "查看 / 跟进", "lead-detail"],
    ["visitors", "查看轨迹", "visitor-history"],
    ["users", "添加成员", "member-form"],
    ["templates/new", "首屏横幅", "builder-module"],
  ]) {
    await page.goto("/admin/" + route);
    await page.getByRole("button", { name: button, exact: true }).first().click();
    await page.waitForLoadState("networkidle");
    for (const width of [1440, 768, 375]) {
      await viewport(width);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${name} at ${width}`).toBeTruthy();
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.screenshot({ path: `${process.env.CMS_TEST_ARTIFACTS}/${name}-${width}.png` });
      if (name === "builder-module") await page.locator(".builder-workspace").screenshot({ path: `${process.env.CMS_TEST_ARTIFACTS}/builder-workspace-${width}.png` });
    }
  }
  await viewport(1440);
  await page.goto("/admin/templates");
  const nav = page.getByRole("navigation", { name: "内容管理导航" });
  await expect(nav.locator("summary")).toHaveText(["内容管理", "设计与素材", "客户运营", "数据统计", "系统管理"]);
  await expect(nav.locator("a")).toHaveCount(22);
  await expect(nav.getByRole("link", { name: "页面模板", exact: true })).toHaveAttribute("aria-current", "page");
  await expect(nav.getByRole("link", { name: "文章", exact: true })).not.toBeVisible();
  const contentGroup = nav.locator("summary").filter({ hasText: "内容管理" });
  await contentGroup.focus(); await page.keyboard.press("Enter");
  await expect(nav.getByRole("link", { name: "文章", exact: true })).toBeVisible();
  await page.keyboard.press("Space"); await page.keyboard.press("Tab");
  await expect(nav.locator("summary").filter({ hasText: "设计与素材" })).toBeFocused();
  await page.screenshot({ path: `${process.env.CMS_TEST_ARTIFACTS}/navigation-desktop.png` });
  await viewport(375);
  const menu = page.getByRole("button", { name: "打开导航", exact: true });
  await menu.click();
  const sidebar = page.getByRole("dialog", { name: "管理导航" });
  const close = sidebar.getByRole("button", { name: "关闭导航", exact: true });
  await expect(close).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(sidebar.getByRole("link", { name: "修改密码", exact: true })).toBeFocused();
  await page.keyboard.press("Tab"); await expect(close).toBeFocused();
  await expect.poll(async () => (await sidebar.boundingBox())!.x).toBeGreaterThanOrEqual(0);
  await page.locator(".nav-scrim").hover({ position: { x: 300, y: 120 } });
  await expect(page.locator(".nav-scrim")).toHaveCSS("background-color", /rgba\(.*,[\s]*0\.\d+\)/);
  await page.screenshot({ path: `${process.env.CMS_TEST_ARTIFACTS}/navigation-mobile.png` });
  await page.keyboard.press("Escape"); await expect(menu).toBeFocused();
  await expect(page.locator("#admin-navigation")).toHaveAttribute("inert", "");
  // Check the editor role's menu projection without changing server-side permissions.
  await page.route("**/api/v1/auth/me", async route => {
    const response = await route.fetch(), body = await response.json();
    await route.fulfill({ response, json: { ...body, data: { ...body.data, role: "Editor" } } });
  });
  await viewport(1440); await page.goto("/admin/posts");
  await expect(nav.locator("summary")).toHaveText(["内容管理", "设计与素材", "客户运营"]);
  await expect(nav.locator("a")).toHaveCount(10);
  await expect(nav.locator('a[href="/admin/settings"], a[href="/admin/themes"], a[href="/admin/leads"]')).toHaveCount(0);
  expect(errors).toEqual([]);
});
