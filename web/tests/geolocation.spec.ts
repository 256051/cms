import { test, expect } from "@playwright/test";
import fs from "node:fs";
import { loginCaptcha } from "./login";

if (!process.env.CMS_TEST_BASE_URL || !process.env.CMS_TEST_CREDENTIALS_PATH)
  throw new Error("Geolocation checks require an explicitly configured isolated test site.");
const credentials = JSON.parse(fs.readFileSync(process.env.CMS_TEST_CREDENTIALS_PATH, "utf8").replace(/^\uFEFF/, ""));

test("visitor and per-visit IP regions, legacy labels and responsive tables", async ({ browser }) => {
  const context = await browser.newContext({ baseURL: process.env.CMS_TEST_BASE_URL });
  const csrf = (await (await context.request.get("/api/v1/auth/csrf")).json()).data.token;
  const response = await context.request.post("/api/v1/auth/login", { headers: { "X-CSRF-TOKEN": csrf }, data: { ...credentials, ...await loginCaptcha(context.request) } });
  expect(response.ok(), await response.text()).toBeTruthy();
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto("/admin/visitors");
  const current = page.getByRole("row").filter({ hasText: "geo-browser" });
  await expect(current.locator(".traffic-network")).toContainText("240e:3b7:3272:d8d0:db09:c067:8d59:539e");
  await expect(current.locator(".traffic-network")).toContainText("中国");
  const legacy = page.getByRole("row").filter({ hasText: "legacy-region" });
  await expect(legacy.locator(".traffic-network small")).toHaveText("未记录");
  for (const width of [1440, 768, 375]) {
    await page.setViewportSize({ width, height: 1000 });
    if (width < 700)
      await expect.poll(async () => { const box = await page.locator("#admin-navigation").boundingBox(); return box!.x + box!.width; }).toBeLessThanOrEqual(1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBeTruthy();
    await current.locator(".traffic-network").scrollIntoViewIfNeeded();
    await expect(current.locator(".traffic-network")).toBeVisible();
    await page.screenshot({ path: `${process.env.CMS_TEST_ARTIFACTS}/visitors-${width}.png`, fullPage: true, animations: "disabled" });
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await current.getByRole("button", { name: "查看轨迹" }).click();
  await expect(page.getByRole("columnheader", { name: "访问 IP / 所属地区" })).toBeVisible();
  await expect(page.locator(".traffic-network").filter({ hasText: "114.114.114.114" })).toContainText("中国");
  await expect(page.locator(".traffic-network").filter({ hasText: "240e:3b7:3272:d8d0:db09:c067:8d59:539e" })).toContainText("中国");
  for (const width of [1440, 768, 375]) {
    await page.setViewportSize({ width, height: 1000 });
    if (width < 700)
      await expect.poll(async () => { const box = await page.locator("#admin-navigation").boundingBox(); return box!.x + box!.width; }).toBeLessThanOrEqual(1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBeTruthy();
    await page.locator(".traffic-network").first().scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${process.env.CMS_TEST_ARTIFACTS}/visits-${width}.png`, fullPage: true, animations: "disabled" });
  }
  const guest = await browser.newContext({ baseURL: process.env.CMS_TEST_BASE_URL });
  await guest.addInitScript(() => Object.defineProperty(navigator, "doNotTrack", { get: () => "1" }));
  const guestPage = await guest.newPage();
  const visits: string[] = [];
  guestPage.on("request", request => { if (request.url().endsWith("/public/visits")) visits.push(request.url()); });
  await guestPage.goto("/");
  await guestPage.waitForLoadState("networkidle");
  await expect(guestPage.locator(".traffic-notice")).toContainText("记录访问 IP");
  expect(visits).toEqual([]);
  expect(errors).toEqual([]);
  await guest.close(); await context.close();
});
