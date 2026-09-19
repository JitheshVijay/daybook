// Every browser test runs against the developer's live server, so none may touch the real
// database: /api/data answers "use browser storage" unless a test routes it itself.
import { test as base, expect } from "@playwright/test";

export const test = base.extend({
  page: async ({ page }, use) => {
    await page.route("**/api/data**", (route) => route.fulfill({ status: 403, json: { error: "Browser tests use browser storage.", mode: "browser" } }));
    await use(page);
  },
});
export { expect };
