import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  timeout: 60_000,
  workers: 1,
  use: {
    baseURL: process.env.CMS_TEST_BASE_URL || "http://localhost:3000",
    ignoreHTTPSErrors: process.env.CMS_TEST_SELF_SIGNED === "1",
    browserName: "chromium",
    channel: "msedge",
    headless: true,
    actionTimeout: 10_000,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  reporter: [["list"], ["html", { open: "never" }]],
});
