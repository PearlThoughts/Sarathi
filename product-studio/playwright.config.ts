import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests-browser",
  fullyParallel: false,
  retries: 0,
  reporter: "list",
  use: {
    baseURL: process.env.PRODUCT_STUDIO_BROWSER_BASE_URL ?? "http://127.0.0.1:3000",
    screenshot: "off",
    trace: "off",
    video: "off",
  },
});
