import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { fillCaptcha } from "./login";

if (!process.env.CMS_TEST_BASE_URL || !process.env.CMS_TEST_CREDENTIALS_PATH)
  throw new Error("Run tests/operations_browser.py against a disposable site.");
const credentials = JSON.parse(fs.readFileSync(process.env.CMS_TEST_CREDENTIALS_PATH, "utf8").replace(/^\uFEFF/, ""));
test.use({ channel: undefined });

test("operational tools: articles, replies, backups, audit, test notification and scoped inquiry work", async ({ page, browser }) => {
  test.setTimeout(240_000);
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  // Keep the real server response; Node transport avoids local IDM interception of ZIP responses.
  for (const pattern of ["**/api/v1/admin/contents/export", "**/api/v1/admin/maintenance/download*"])
    await page.route(pattern, async route => {
      const response = await route.fetch();
      expect(response.status()).toBe(200);
      expect((await response.body()).length).toBeGreaterThan(0);
      await route.fulfill({ response });
    });
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
  const post = await api("admin/contents", "POST", { kind: "post", slug: "ops-ui", title: "运营测试文章", summary: "浏览器检查",
    html: "<p>这是一篇测试文章。</p>", coverId: "", categoryId: "", tagIds: [], version: 0 });
  await api(`admin/contents/${post.id}/publish`, "POST", { version: post.version });
  await page.goto("/admin/posts");
  await expect(page.getByRole("button", { name: "导入", exact: true })).toBeVisible();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出筛选结果" }).click();
  const download = await downloadPromise;
  const archivePath = path.join(process.env.CMS_TEST_ARTIFACTS!, "articles.zip");
  await download.saveAs(archivePath);
  await page.getByRole("button", { name: "导入", exact: true }).click();
  await page.locator('input[type="file"]').setInputFiles(archivePath);
  await page.getByRole("button", { name: "导入为新草稿" }).click();
  await expect(page.getByRole("dialog")).toContainText("已导入");
  await page.getByRole("button", { name: "完成", exact: true }).click();

  await api("public/comments", "POST", { contentId: post.id, author: "读者", body: "请介绍一下使用方法" });
  await page.goto("/admin/comments");
  await expect(page.locator(".moderation-comment").filter({ hasText: "请介绍一下" })).toContainText("运营测试文章");
  await page.getByRole("button", { name: "只看此内容" }).click();
  await page.getByRole("button", { name: "回复", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "管理员回复" });
  await dialog.getByLabel("回复内容").fill("管理员答复 <script>alert(1)</script>");
  await dialog.getByRole("button", { name: "保存回复" }).click();
  await expect(dialog).toHaveCount(0);
  await page.getByLabel("选择本页评论").check();
  await page.getByRole("button", { name: "批量通过" }).click();
  await expect(page.getByRole("status")).toContainText("评论处理完成");
  await page.goto("/posts/ops-ui");
  await expect(page.locator(".comments blockquote")).toContainText("管理员答复 <script>alert(1)</script>");
  await expect(page.locator(".comments script")).toHaveCount(0);

  await page.goto("/admin/users");
  await page.getByRole("button", { name: "添加成员" }).click();
  await page.getByLabel("账号", { exact: true }).fill("support-ui");
  await page.getByLabel("姓名", { exact: true }).fill("咨询同事");
  await page.getByRole("combobox", { name: /角色/ }).selectOption("Support");
  await page.getByLabel("通知邮箱（选填）").fill("support-ui@local.invalid");
  await page.getByLabel("初始密码").fill(credentials.password);
  await page.getByRole("button", { name: "保存成员" }).click();
  await expect(page.getByRole("status")).toContainText("成员信息已保存");
  const staff = (await api("admin/users")).find((x: { username: string }) => x.username === "support-ui");
  const id = (await api("public/leads", "POST", { id: "b".repeat(32), path: "/", name: "浏览器客户", contact: "browser@example.test",
    organization: "测试单位", need: "希望了解产品", consent: true })).id;
  await api("public/leads", "POST", { id: "d".repeat(32), path: "/", name: "其他客户", contact: "hidden@example.test",
    organization: "测试单位", need: "不应向专员展示", consent: true });
  await page.goto("/admin/leads");
  const leadRow = page.getByRole("row").filter({ hasText: "浏览器客户" });
  await leadRow.getByRole("button").click();
  await page.locator(".lead-detail").getByLabel("负责人").selectOption(staff.id);
  await page.getByRole("button", { name: "保存跟进" }).click();
  await expect(leadRow).toContainText("咨询同事");

  await page.goto("/admin/maintenance");
  for (let i = 0; i < 3; i++) {
    await page.getByRole("button", { name: "立即备份" }).click();
    await expect(page.getByRole("status")).toContainText("备份已完成");
    await expect(page.getByRole("button", { name: "立即备份" })).toBeEnabled();
  }
  await expect(page.locator("tbody tr")).toHaveCount(2);
  await expect(page.getByText(/磁盘可用/)).toBeVisible();
  const backupDownload = page.waitForEvent("download");
  await page.locator("tbody tr").last().getByRole("link", { name: "下载", exact: true }).click();
  expect((await backupDownload).suggestedFilename()).toMatch(/^cms-.*\.zip$/);
  await page.goto("/admin/audit");
  await page.getByLabel("操作类型").selectOption("comment.reply");
  await page.getByRole("button", { name: "筛选记录" }).click();
  await expect(page.locator("tbody tr")).toHaveCount(1);
  await expect(page.locator("tbody tr")).toContainText("回复评论");
  await expect(page.locator("tbody tr")).toContainText("管理员");

  await page.goto("/admin/notifications");
  await page.getByRole("button", { name: "发送测试邮件" }).click();
  await expect(page.getByRole("status")).toContainText("测试通知已排队");
  await expect(page.getByRole("row").filter({ hasText: "通知渠道测试" })).toContainText("已发送", { timeout: 45_000 });
  for (const route of ["comments", "users", "leads", "maintenance", "audit", "notifications"]) {
    for (const width of [375, 768, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/admin/" + route);
      await expect(page.getByRole("heading").first()).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    }
  }
  await page.setViewportSize({ width: 375, height: 900 });
  await page.goto("/admin/comments");
  await page.getByRole("button", { name: "全部评论", exact: true }).click();
  await expect(page.locator(".moderation-comment")).toHaveCount(1);
  await page.screenshot({ path: path.join(process.env.CMS_TEST_ARTIFACTS!, "comments-375.png"), fullPage: true });
  const context = await browser.newContext({ baseURL: process.env.CMS_TEST_BASE_URL });
  try {
    const supportPage = await context.newPage();
    await supportPage.goto("/admin/login");
    await supportPage.getByLabel("账号", { exact: true }).fill("support-ui");
    await supportPage.getByLabel("密码", { exact: true }).fill(credentials.password);
    await fillCaptcha(supportPage);
    await supportPage.getByRole("button", { name: "登录工作台" }).click();
    await expect(supportPage.getByRole("heading", { name: "我的咨询" })).toBeVisible();
    await expect(supportPage.locator("tbody tr")).toHaveCount(1);
    await expect(supportPage.locator("tbody")).not.toContainText("其他客户");
    await supportPage.getByRole("row").filter({ hasText: "浏览器客户" }).getByRole("button").click();
    await expect(supportPage.locator(".lead-detail").getByLabel("负责人")).toBeDisabled();
    await expect(supportPage.getByRole("button", { name: "删除咨询" })).toHaveCount(0);
    await supportPage.getByLabel("本次跟进记录").fill("专员已联系客户");
    await supportPage.locator(".lead-detail").getByLabel("跟进状态").selectOption("completed");
    await supportPage.getByRole("button", { name: "保存跟进" }).click();
    await expect(supportPage.locator("tbody tr")).toHaveCount(0);
    await supportPage.getByLabel("我的待办（未完成）").uncheck();
    await expect(supportPage.locator("tbody tr")).toHaveCount(1);
    await supportPage.screenshot({ path: path.join(process.env.CMS_TEST_ARTIFACTS!, "support-inquiries.png"), fullPage: true });
    expect((await supportPage.request.get("/api/v1/admin/contents")).status()).toBe(403);
    await supportPage.goto("/admin/posts");
    await expect(supportPage.getByRole("alert").filter({ hasText: "仅可处理分配给自己的咨询" })).toBeVisible();
  } finally { await context.close(); }
  expect(errors).toEqual([]);
});
