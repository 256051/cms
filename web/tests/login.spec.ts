import { test, expect } from "@playwright/test";
import fs from "node:fs";
import { fillCaptcha } from "./login";

if (!process.env.CMS_TEST_BASE_URL || !process.env.CMS_TEST_CREDENTIALS_PATH)
  throw new Error("请通过 tests/docker_smoke.py 在独立测试站点运行登录验收。");
const credentials = JSON.parse(fs.readFileSync(process.env.CMS_TEST_CREDENTIALS_PATH, "utf8"));

test("login captcha refresh, retry protection, retained credentials and keyboard submission", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", e => errors.push(e.message));
  await page.goto("/admin/login");
  await page.setViewportSize({ width: 1440, height: 900 });
  const picture = page.getByRole("img", { name: "登录验证码图片" });
  await expect(picture).toBeVisible();
  await page.screenshot({ path: "../artifacts/login-desktop.png", fullPage: true });
  const username = page.getByLabel("账号", { exact: true }), password = page.getByLabel("密码", { exact: true });
  const captcha = page.getByLabel("验证码", { exact: true }), submit = page.getByRole("button", { name: "登录工作台", exact: true });
  await username.fill(credentials.username); await password.fill(credentials.password);
  await fillCaptcha(page);
  const original = await picture.getAttribute("src");
  await page.getByRole("button", { name: "换一张", exact: true }).click();
  await expect(picture).not.toHaveAttribute("src", original!);
  await expect(captcha).toHaveValue(""); await expect(captcha).toBeFocused();
  await fillCaptcha(page);
  const correct = await captcha.inputValue();
  await captcha.fill(correct === "222222" ? "333333" : "222222");
  const wrong = page.waitForResponse(r => r.url().endsWith("/auth/login"));
  await submit.click(); expect((await wrong).status()).toBe(400);
  await expect(page.getByRole("alert").filter({ hasText: "验证码错误或已失效" })).toBeVisible();
  await expect(captcha).toHaveValue(""); await expect(captcha).toBeFocused();
  await expect(username).toHaveValue(credentials.username); await expect(password).toHaveValue(credentials.password);

  await password.fill("Wrong!Password123"); await fillCaptcha(page);
  await submit.click();
  await expect(page.getByRole("alert").filter({ hasText: "账号或密码错误" })).toBeVisible();
  await expect(password).toHaveValue("Wrong!Password123");
  await password.fill(credentials.password); await fillCaptcha(page);
  await page.route("**/api/v1/auth/login", route => route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ code: "TEST", message: "服务暂时不可用" }) }), { times: 1 });
  await submit.click();
  await expect(page.getByRole("alert").filter({ hasText: "服务暂时不可用" })).toBeVisible();
  await expect(password).toHaveValue(credentials.password);
  await fillCaptcha(page);
  await page.route("**/api/v1/auth/login", route => route.fulfill({ status: 429, headers: { "Retry-After": "2" }, contentType: "application/json", body: JSON.stringify({ code: "RATE_LIMITED", message: "操作过于频繁，请稍后重试。" }) }), { times: 1 });
  await submit.click();
  await expect(submit).toBeDisabled();
  await expect(page.getByText(/请在 \d+ 秒后重试/)).toBeVisible();
  await expect(submit).toBeEnabled({ timeout: 5000 });
  await page.setViewportSize({ width: 375, height: 812 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
  await page.screenshot({ path: "../artifacts/login-mobile.png", fullPage: true });
  await fillCaptcha(page);
  await captcha.press("Enter");
  await expect(page.getByRole("heading", { name: /你好/ })).toBeVisible();
  expect(errors).toEqual([]);
});
