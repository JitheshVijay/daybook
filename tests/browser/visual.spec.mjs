import { test, expect } from "./fixtures.mjs";
import { calls, fixture, go, mockChat, raw, say, seed, send, toolCall } from "./helpers.mjs";

const WIDTHS = [360, 390, 700, 900, 1200, 1440, 1728];

async function noOverflow(page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
}

test("every page fits every width without horizontal overflow; screenshots for QA", async ({ page }) => {
  test.setTimeout(180000);
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await seed(page, fixture());
  await mockChat(page, [
    calls(
      toolCall("log_entries", {
        entries: [
          raw("meditation", { minutes: 15, quality: 4, mood: "Calm", time: "07:00", source: "meditated" }),
          raw("workout", { title: "Push day", minutes: 45, time: "18:00", source: "bench", exercises: [{ name: "Bench press", muscle: "chest", sets: [1, 2, 3].map(() => ({ weight: 50, reps: 10, done: true })) }] }),
          raw("food", { title: "Dinner", source: "burrito", items: [{ name: "chicken burrito", servings: 1, calories: 780, protein: 42, carbs: 90, fat: 26, estimated: true, estimateNote: "one large burrito" }] }),
        ],
      }, "v1"),
    ),
    say("Logged your meditation, push day, and dinner. The burrito is an estimate."),
    calls(toolCall("query_data", { metric: "calories", habit: null, range: "last_7_days", from: null, to: null, groupBy: "day", chart: "bar" }, "v2")),
    say("You averaged about 1,300 kcal on the days you logged, a little under last week."),
  ]);
  await page.goto("/");
  await send(page, "Meditated 15 min at 7, quality 4. Bench 3x10 at 50kg at 6pm, 45 min. Chicken burrito for dinner.");
  await expect(page.getByTestId("logged-card")).toBeVisible();
  await send(page, "How are my calories this week?");
  await expect(page.getByTestId("chart-card")).toBeVisible();

  for (const [label, name] of [["chat", null], ["insights", "Insights"], ["journal", "Journal"], ["settings", "Settings"]]) {
    await page.setViewportSize({ width: 1440, height: 900 });
    if (name) await go(page, name);
    for (const width of WIDTHS) {
      await page.setViewportSize({ width, height: width < 768 ? 844 : 900 });
      await page.waitForTimeout(150);
      await noOverflow(page);
      if ([390, 900, 1440].includes(width)) await page.screenshot({ path: `qa/${label}-${width}.png`, fullPage: label !== "chat" });
    }
  }
  expect(errors).toEqual([]);
});
