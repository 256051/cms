import { expect, type APIRequestContext, type Page } from "@playwright/test";
const { solve } = require("../../tests/captcha.cjs") as { solve(image: string): string };

export async function fillCaptcha(page: Page) {
  const picture = page.getByRole("img", { name: "登录验证码图片" });
  await expect(picture).toBeVisible();
  await page.getByLabel("验证码", { exact: true }).fill(solve((await picture.getAttribute("src"))!));
}

export async function loginCaptcha(request: APIRequestContext) {
  const response = await request.get("/api/v1/auth/captcha");
  expect(response.ok()).toBeTruthy();
  const challenge = (await response.json()).data;
  return { captchaId: challenge.id, captchaCode: solve(challenge.image) };
}
