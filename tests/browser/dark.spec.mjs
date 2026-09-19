import { test, expect } from "./fixtures.mjs";
import { calls, fixture, go, mockChat, raw, say, seed, send, toolCall } from "./helpers.mjs";

test.use({ colorScheme: "dark" });

test("dark theme renders chat cards and nutrition charts on a phone", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.setViewportSize({ width: 390, height: 844 });
  await seed(page, fixture());
  await mockChat(page, [
    calls(
      toolCall("log_entries", {
        entries: [
          raw("meditation", { minutes: 15, quality: 4, mood: "Calm", time: "07:00", source: "meditated" }),
          raw("food", { title: "Lunch", source: "burrito", items: [{ name: "chicken burrito", servings: 1, calories: 780, protein: 42, carbs: 90, fat: 26, estimated: true, estimateNote: "one large burrito" }] }),
          raw("reading", { bookTitle: "Deep Work", source: "read some" }),
        ],
      }, "d1"),
    ),
    calls(toolCall("ask_user", { question: "How many pages of Deep Work did you read?", options: ["10 pages", "20 pages", "30 pages"] }, "d2")),
  ]);
  await page.goto("/");
  await expect(page.locator("html")).toHaveClass(/dark/);
  await send(page, "Meditated 15 min, burrito for lunch, read some Deep Work");
  await expect(page.getByTestId("question-card")).toBeVisible();
  await page.screenshot({ path: "qa/dark-chat-390.png" });
  await go(page, "Insights");
  await page.getByRole("tab", { name: "Nutrition" }).click();
  await expect(page.locator(".recharts-bar-rectangle").first()).toBeVisible();
  await page.screenshot({ path: "qa/dark-insights-nutrition-390.png", fullPage: true });
  expect(errors).toEqual([]);
});
