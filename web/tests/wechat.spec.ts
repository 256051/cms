import { test, expect } from "@playwright/test";
import fs from "node:fs";
import { loginCaptcha } from "./login";

if (!process.env.CMS_TEST_BASE_URL || !process.env.CMS_TEST_CREDENTIALS_PATH) throw new Error("An isolated site is required.");
const credentials = JSON.parse(fs.readFileSync(process.env.CMS_TEST_CREDENTIALS_PATH, "utf8").replace(/^\uFEFF/, ""));

test("WeChat access controls, configuration and responsive delivery states", async ({ browser }) => {
  const context = await browser.newContext({ baseURL: process.env.CMS_TEST_BASE_URL });
  const guest = await context.request.get("/api/v1/admin/wechat/settings");
  expect(guest.status()).toBe(401);
  let csrf = (await (await context.request.get("/api/v1/auth/csrf")).json()).data.token;
  const login = await context.request.post("/api/v1/auth/login", { headers: { "X-CSRF-TOKEN": csrf }, data: { ...credentials, ...await loginCaptcha(context.request) } });
  expect(login.ok(), await login.text()).toBeTruthy();
  csrf = (await (await context.request.get("/api/v1/auth/csrf")).json()).data.token;
  const settings = (await (await context.request.get("/api/v1/admin/wechat/settings")).json()).data;
  expect(settings.enabled).toBe(false);
  expect(settings).not.toHaveProperty("appSecret");
  const input = { kind: "post", slug: "wechat-ui-check", title: "公众号同步验收", html: "<p>正文内容</p>", summary: "同步说明", coverId: "", categoryId: "", tagIds: [], version: 0 };
  const created = await context.request.post("/api/v1/admin/contents", { headers: { "X-CSRF-TOKEN": csrf }, data: input });
  expect(created.ok(), await created.text()).toBeTruthy();
  let doc = (await created.json()).data;
  const rejectedChoice = await context.request.post(`/api/v1/admin/contents/${doc.id}/publish`, { headers: { "X-CSRF-TOKEN": csrf }, data: { version: doc.version, syncToWeChat: true } });
  expect(rejectedChoice.status()).toBe(400);
  expect((await rejectedChoice.json()).code).toBe("WECHAT_INVALID");
  const publication = await context.request.post(`/api/v1/admin/contents/${doc.id}/publish`, { headers: { "X-CSRF-TOKEN": csrf }, data: { version: doc.version } });
  expect(publication.ok(), await publication.text()).toBeTruthy();
  doc = (await publication.json()).data;
  const path = `/api/v1/admin/wechat/contents/${doc.id}`;
  expect((await context.request.post(path, { data: { version: doc.version } })).status()).toBe(400);
  const disabled = await context.request.post(path, { headers: { "X-CSRF-TOKEN": csrf }, data: { version: doc.version } });
  expect(disabled.status()).toBe(400);
  expect((await disabled.json()).code).toBe("WECHAT_INVALID");
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  const checkbox = page.getByRole("checkbox", { name: "同步到微信公众号（草稿箱）", exact: true });
  await page.goto("/admin/posts/new");
  await expect(checkbox).toBeDisabled();
  await expect(checkbox).not.toBeChecked();
  await page.goto(`/admin/posts/${doc.id}`);
  await expect(checkbox).toBeDisabled();
  const panel = page.getByRole("region", { name: "微信公众号同步" });
  await expect(panel.getByText("尚未启用。", { exact: false })).toBeVisible();
  await expect(panel.getByRole("button", { name: "同步已发布版本" })).toBeDisabled();
  await page.goto("/admin/wechat");
  await expect(page.getByRole("heading", { name: "公众号设置", exact: true })).toBeVisible();
  await page.getByRole("checkbox", { name: "启用公众号同步", exact: true }).check();
  await page.getByLabel("公众号 AppID", { exact: true }).fill("wx1234567890123456");
  await page.getByLabel("公众号 AppSecret", { exact: true }).fill("isolated-browser-secret");
  await page.getByLabel("默认作者", { exact: true }).fill("后台配置作者");
  await page.getByLabel("网站 HTTPS 地址", { exact: true }).fill("https://example.com");
  const autoPublishOption = page.getByRole("checkbox", { name: "同步草稿后自动发布", exact: true });
  await expect(autoPublishOption).not.toBeChecked();
  await autoPublishOption.check();
  await expect(page.getByText("当前模式：新建同步任务将自动发布。", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: "保存公众号设置", exact: true }).click();
  await expect(page.getByText("公众号设置已保存到数据库，无需重启。", { exact: false })).toBeVisible();
  await expect(page.getByLabel("公众号 AppSecret", { exact: true })).toHaveValue("");
  const account = (await (await context.request.get("/api/v1/admin/wechat/configuration")).json()).data;
  expect(account.hasSecret).toBe(true);
  expect(account.values.appSecret).toBe("");
  expect(account.deploymentManaged).toBe(false);
  expect(account.values.autoPublish).toBe(true);
  expect(JSON.stringify(account)).not.toContain("isolated-browser-secret");
  await page.reload();
  await expect(autoPublishOption).toBeChecked();
  await expect(page.getByLabel("公众号 AppID", { exact: true })).toHaveValue("wx1234567890123456");
  await expect(page.getByLabel("公众号 AppSecret", { exact: true })).toHaveAttribute("placeholder", "已保存，留空保留原密钥");
  await page.getByLabel("默认作者", { exact: true }).fill("修改后作者");
  await page.getByRole("button", { name: "保存公众号设置", exact: true }).click();
  await expect(page.getByText("公众号设置已保存到数据库，无需重启。", { exact: false })).toBeVisible();
  const conflict = await context.request.put("/api/v1/admin/wechat/configuration", { headers: { "X-CSRF-TOKEN": csrf }, data: account.values });
  expect(conflict.status()).toBe(409);
  for (const width of [1440, 375]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.getByRole("heading", { name: "公众号设置", exact: true }).scrollIntoViewIfNeeded();
    if (width < 700) await expect.poll(async () => { const box = await page.locator("#admin-navigation").boundingBox(); return box!.x + box!.width; }).toBeLessThanOrEqual(1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBeTruthy();
    await page.screenshot({ path: `${process.env.CMS_TEST_ARTIFACTS}/wechat-settings-${width}.png`, fullPage: true, animations: "disabled" });
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  const editorInput = { username: "wechat-editor", displayName: "公众号编辑", role: "Editor", enabled: true, password: "WechatEditor!StrongPass123" };
  const createdEditor = await context.request.post("/api/v1/admin/users", { headers: { "X-CSRF-TOKEN": csrf }, data: editorInput });
  expect(createdEditor.ok(), await createdEditor.text()).toBeTruthy();
  const editor = await browser.newContext({ baseURL: process.env.CMS_TEST_BASE_URL });
  let editorCsrf = (await (await editor.request.get("/api/v1/auth/csrf")).json()).data.token;
  const editorLogin = await editor.request.post("/api/v1/auth/login", { headers: { "X-CSRF-TOKEN": editorCsrf }, data: { ...editorInput, ...await loginCaptcha(editor.request) } });
  expect(editorLogin.ok(), await editorLogin.text()).toBeTruthy();
  editorCsrf = (await (await editor.request.get("/api/v1/auth/csrf")).json()).data.token;
  expect((await editor.request.get("/api/v1/admin/wechat/settings")).status()).toBe(200);
  expect((await editor.request.get("/api/v1/admin/wechat/configuration")).status()).toBe(403);
  expect((await editor.request.put("/api/v1/admin/wechat/configuration", { headers: { "X-CSRF-TOKEN": editorCsrf }, data: account.values })).status()).toBe(403);
  await editor.close();
  await page.goto(`/admin/posts/${doc.id}`);
  const automaticCheckbox = page.getByRole("checkbox", { name: "同步到微信公众号（自动发布）", exact: true });
  await expect(automaticCheckbox).toBeEnabled();
  await expect(page.locator("#wechat-publish-help")).toContainText("创建草稿并自动发布");
  const currentAccount = (await (await context.request.get("/api/v1/admin/wechat/configuration")).json()).data;
  const stopped = await context.request.put("/api/v1/admin/wechat/configuration", { headers: { "X-CSRF-TOKEN": csrf }, data: { ...currentAccount.values, autoPublish: false } });
  expect(stopped.ok(), await stopped.text()).toBeTruthy();
  await page.reload();
  await expect(checkbox).toBeEnabled();
  // The browser states below are simulated; the service checks exercise delivery separately.
  const reply = (data: unknown) => ({ status: 200, contentType: "application/json", body: JSON.stringify({ code: "OK", data, message: "", traceId: "ui-check" }) });
  const jobs = [{ id: "draft-check", status: "draft", mediaId: "draft-id", error: "", updatedAt: new Date().toISOString(), publicationStatus: "", publishId: "", publicationError: "", canRetryPublication: false },
    { id: "unknown-check", status: "unknown", mediaId: "", error: "提交结果未知，请在公众号草稿箱核实；系统不会自动重发。", updatedAt: new Date().toISOString(), publicationStatus: "", publishId: "", publicationError: "", canRetryPublication: false }];
  let configurationErrors = ["请配置公众号 AppSecret。"];
  let automaticMode = false;
  await page.route("**/api/v1/admin/wechat/settings", route => route.fulfill(reply({ enabled: true, autoSync: true, autoPublish: automaticMode, appId: "wx1234567890123456", errors: configurationErrors })));
  await page.reload();
  await expect(checkbox).toBeDisabled();
  await expect(page.locator("#wechat-publish-help")).toContainText("配置不完整");
  configurationErrors = [];
  let queueCalls = 0;
  await page.route(`**${path}`, route => {
    if (route.request().method() === "POST") { queueCalls++; return route.fulfill(reply(jobs[0])); }
    return route.fulfill(reply(jobs));
  });
  await page.reload();
  await expect(checkbox).toBeEnabled();
  await expect(checkbox).not.toBeChecked();
  const choices: boolean[] = [];
  await page.route(`**/api/v1/admin/contents/${doc.id}/publish`, async route => {
    const payload = route.request().postDataJSON();
    choices.push(payload.syncToWeChat);
    // Capture the user's choice but keep this isolated site's real WeChat integration disabled.
    const response = await route.fetch({ postData: { ...payload, syncToWeChat: false } });
    await route.fulfill({ response });
  });
  await checkbox.check();
  await page.getByRole("button", { name: "保存并发布", exact: true }).click();
  await expect(page.getByText("网站已发布，已安排公众号草稿同步，请查看同步结果。", { exact: true })).toBeVisible();
  await checkbox.uncheck();
  await page.getByRole("button", { name: "保存并发布", exact: true }).click();
  await expect(page.getByText("已发布，网站内容已更新。", { exact: true })).toBeVisible();
  expect(choices).toEqual([true, false]);
  await expect(panel.getByText("已同步草稿", { exact: true })).toBeVisible();
  await expect(panel.getByText("结果待核实", { exact: true })).toBeVisible();
  await expect(panel.getByRole("button", { name: "重试此版本" })).toHaveCount(0);
  await panel.getByRole("button", { name: "同步已发布版本" }).click();
  await expect(panel.getByText("这个发布版本已同步过，没有重复创建草稿。")).toBeVisible();
  expect(queueCalls).toBe(1);
  for (const width of [1440, 375]) {
    await page.setViewportSize({ width, height: 1000 });
    await panel.scrollIntoViewIfNeeded();
    if (width < 700) await expect.poll(async () => { const box = await page.locator("#admin-navigation").boundingBox(); return box!.x + box!.width; }).toBeLessThanOrEqual(1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBeTruthy();
    await page.screenshot({ path: `${process.env.CMS_TEST_ARTIFACTS}/wechat-${width}.png`, animations: "disabled" });
    await checkbox.scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${process.env.CMS_TEST_ARTIFACTS}/wechat-checkbox-${width}.png`, animations: "disabled" });
  }
  automaticMode = true;
  const completed = { ...jobs[0], id: "published-check", publicationStatus: "published", publishId: "publish-check" };
  jobs.splice(0, jobs.length, completed,
    { ...completed, id: "publishing-check", publicationStatus: "publishing" },
    { ...completed, id: "publish-unknown-check", publicationStatus: "unknown", publishId: "", publicationError: "发布提交结果未知，请在微信后台核实；系统不会自动重发。" },
    { ...completed, id: "publish-rejected-check", publicationStatus: "failed", publishId: "", publicationError: "账号没有发布接口权限。", canRetryPublication: true });
  await page.reload();
  await expect(automaticCheckbox).toBeEnabled();
  await expect(panel.getByText("微信已发布", { exact: true })).toBeVisible();
  await expect(panel.getByText("微信发布中", { exact: true })).toBeVisible();
  await expect(panel.getByText("发布结果待核实", { exact: true })).toBeVisible();
  await expect(panel.getByRole("button", { name: "重试发布", exact: true })).toHaveCount(1);
  await automaticCheckbox.check();
  await page.getByRole("button", { name: "保存并发布", exact: true }).click();
  await expect(page.getByText("网站已发布，已安排公众号同步及自动发布，请查看发布结果。", { exact: true })).toBeVisible();
  for (const width of [1440, 375]) {
    await page.setViewportSize({ width, height: 1000 });
    await panel.scrollIntoViewIfNeeded();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBeTruthy();
    await page.screenshot({ path: `${process.env.CMS_TEST_ARTIFACTS}/wechat-auto-publish-${width}.png`, animations: "disabled" });
  }
  expect(errors).toEqual([]);
  const schema = await context.request.get(process.env.API_INTERNAL_URL + "/openapi/v1.json");
  expect(schema.ok(), await schema.text()).toBeTruthy();
  fs.writeFileSync("../docs/openapi.json", JSON.stringify(await schema.json(), null, 2));
  await context.close();
});
