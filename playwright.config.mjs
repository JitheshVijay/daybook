import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/browser",
  timeout: 45000,
  workers: 1,
  use: {
    baseURL: "http://localhost:5173",
    viewport: { width: 1440, height: 1050 },
    screenshot: "only-on-failure",
  },
  reporter: "list",
});
