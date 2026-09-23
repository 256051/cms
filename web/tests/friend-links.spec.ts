import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { fillCaptcha } from "./login";

if (!process.env.CMS_TEST_BASE_URL || !process.env.CMS_TEST_CREDENTIALS_PATH)
  throw new Error("请通过 tests/friend_links_browser.py 在独立测试站点验收。");
const credentials = JSON.parse(fs.readFileSync(process.env.CMS_TEST_CREDENTIALS_PATH, "utf8").replace(/^\uFEFF/, ""));

test("friend links CRUD, isolation, validation, permissions and responsive theme footers", async ({ page, browser }) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  page.on("pageerror", e => errors.push(e.message));
  await page.goto("/admin/login");
  await page.getByLabel("账号", { exact: true }).fill(credentials.username);
  await page.getByLabel("密码", { exact: true }).fill(credentials.password);
  await fillCaptcha(page);
  await page.getByRole("button", { name: "登录工作台" }).click();
  await expect(page.getByRole("heading", { name: /你好/ })).toBeVisible();
  const csrf = (await (await page.request.get("/api/v1/auth/csrf")).json()).data.token;
  async function api(route: string, method = "GET", data?: unknown, status = 200) {
    const response = await page.request.fetch("/api/v1/" + route, { method, data, headers: { "X-CSRF-TOKEN": csrf } });
    expect(response.status(), await response.text()).toBe(status);
    return (await response.json()).data;
  }
  const guest = await browser.newContext({ baseURL: process.env.CMS_TEST_BASE_URL });
  try {
    expect((await guest.request.get("/api/v1/admin/friend-links")).status()).toBe(401);
    await page.goto("/");
    await expect(page.getByRole("navigation", { name: "友情链接", exact: true })).toHaveCount(0);
    const navigation = await api("admin/menu", "POST", { label: "原有导航", url: "/", sort: 0 });
    await page.goto("/admin/friend-links");
    await expect(page.getByRole("heading", { name: "友情链接", exact: true })).toBeVisible();
    await expect(page.getByLabel("上级菜单项")).toHaveCount(0);
    await page.getByLabel("名称", { exact: true }).fill("示例伙伴");
    await page.getByLabel("链接", { exact: true }).fill("https://example.com/partner");
    await page.getByLabel("排序", { exact: true }).fill("10");
    await page.getByRole("button", { name: "保存", exact: true }).click();
    await expect(page.getByRole("status")).toContainText("友情链接已保存");
    const first = (await api("admin/friend-links"))[0];
    expect(first.openInNewTab).toBe(true);
    const second = await api("admin/friend-links", "POST", { label: "另一位伙伴", url: "http://example.org/", sort: -1 });
    expect((await api("public/friend-links")).map((x: { id: string }) => x.id)).toEqual([second.id, first.id]);
    expect((await api("admin/menu")).map((x: { id: string }) => x.id)).toContain(navigation.id);
    expect((await api("public/menu")).map((x: { id: string }) => x.id)).not.toContain(first.id);
    for (const url of ["javascript:alert(1)", "data:text/html,bad", "//example.com", "/local", "https://user:secret@example.com", "https://example.com\\bad", "https://example.com/\n"]) {
      // Embedded control characters must be rejected; surrounding whitespace is trimmed intentionally.
      const unsafe = url.includes("\n") ? "https://exam\nple.com/" : url;
      await api("admin/friend-links", "POST", { label: "非法地址", url: unsafe, sort: 0 }, 400);
    }
    await api("admin/friend-links", "POST", { label: " ", url: "https://example.com", sort: 0 }, 400);
    await api("admin/friend-links", "POST", { label: "错误层级", url: "https://example.com", sort: 0, parentId: navigation.id }, 400);
    await api(`admin/menu/${first.id}`, "PUT", { ...first, type: "custom" }, 404);
    await api(`admin/menu/${first.id}`, "DELETE", undefined, 404);
    await api(`admin/friend-links/${navigation.id}`, "PUT", navigation, 404);
    await api(`admin/friend-links/${navigation.id}`, "DELETE", undefined, 404);
    await api("admin/menu", "POST", { label: "错误父级", url: "/", sort: 0, parentId: first.id }, 400);
    await page.getByRole("button", { name: "编辑 示例伙伴", exact: true }).click();
    await page.getByLabel("名称", { exact: true }).fill("更新后的伙伴");
    await page.getByLabel("链接", { exact: true }).fill("https://example.com/updated");
    await page.getByLabel("排序", { exact: true }).fill("-10");
    await page.getByRole("button", { name: "保存", exact: true }).click();
    await expect(page.getByRole("status")).toContainText("友情链接已保存");
    await api(`admin/friend-links/${first.id}`, "PUT", first, 409);
    await api(`admin/friend-links/${first.id}?version=0`, "DELETE", undefined, 409);
    const saved = (await api("admin/friend-links"))[0];
    expect(saved.version).toBe(first.version + 1);
    expect(saved.label).toBe("更新后的伙伴");
    for (const width of [375, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    }
    await page.screenshot({ path: path.join(process.env.CMS_TEST_ARTIFACTS!, "friend-links-admin.png"), fullPage: true });
    let themes = await api("admin/themes");
    for (const theme of themes.themes) {
      themes = await api("admin/themes/active", "PUT", { themeId: theme.id, options: theme.options, version: themes.version });
      for (const width of [375, 1440]) {
        await page.setViewportSize({ width, height: 900 });
        await page.goto("/");
        const footer = page.getByRole("navigation", { name: "友情链接", exact: true });
        await expect(footer).toBeVisible();
        await expect(footer.getByRole("link").first()).toContainText("更新后的伙伴");
        await expect(footer.getByRole("link").first()).toHaveAttribute("href", "https://example.com/updated");
        await expect(footer.getByRole("link").first()).toHaveAttribute("target", "_blank");
        await expect(footer.getByRole("link").first()).toHaveAttribute("rel", "noopener noreferrer");
        await expect(footer.getByRole("link").nth(1)).not.toHaveAttribute("target", "_blank");
        await expect(page.locator(".site-header")).not.toContainText("更新后的伙伴");
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
        if (theme.id === "classic") {
          await footer.scrollIntoViewIfNeeded();
          await page.screenshot({ path: path.join(process.env.CMS_TEST_ARTIFACTS!, `friend-links-footer-${width}.png`) });
        }
      }
    }
    const html = await (await guest.request.get("/")).text();
    expect(html).toContain("https://example.com/updated");
    await page.goto("/admin/friend-links");
    page.once("dialog", dialog => dialog.accept());
    await page.getByRole("button", { name: "删除 更新后的伙伴", exact: true }).click();
    await expect(page.getByRole("status")).toContainText("友情链接已删除");
    await api(`admin/friend-links/${second.id}?version=${second.version}`, "DELETE");
    await page.goto("/");
    await expect(page.getByRole("navigation", { name: "友情链接", exact: true })).toHaveCount(0);
    expect((await api("public/menu")).map((x: { id: string }) => x.id)).toContain(navigation.id);
    expect(errors).toEqual([]);
  } finally {
    await guest.close();
  }
});
