import { test, expect } from "./fixtures.mjs";
import { fixture, go, mockChat, seed } from "./helpers.mjs";

test("Insights shows real totals per feature with charts, heatmap, and library progress", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await seed(page, fixture());
  await mockChat(page, []);
  await page.goto("/");
  await go(page, "Insights");
  await expect(page.getByRole("tab", { name: "Training" })).toHaveAttribute("aria-selected", "true");
  await expect(page.locator(".recharts-bar-rectangle").first()).toBeVisible();
  await expect(page.locator("svg").filter({ has: page.locator("polygon") }).first()).toBeVisible();
  await page.getByRole("tab", { name: "Nutrition" }).click();
  await expect(page.getByText(/of \d+ food items are estimates/)).toBeVisible();
  await page.getByRole("tab", { name: "Reading" }).click();
  await expect(page.getByRole("progressbar", { name: "Deep Work completion" })).toBeVisible();
  await expect(page.getByRole("radio", { name: "Last 30 days" })).toHaveAttribute("aria-checked", "true");
  await page.getByRole("radio", { name: "Last 7 days" }).click();
  await expect(page.getByRole("radio", { name: "Last 7 days" })).toHaveAttribute("aria-checked", "true");
  await page.getByRole("tab", { name: "Steps" }).click();
  await expect(page.locator(".recharts-bar-rectangle")).toHaveCount(7);
  expect(errors).toEqual([]);
});

test("an empty journal shows honest empty states, not zero-filled charts", async ({ page }) => {
  await mockChat(page, []);
  await page.goto("/");
  await go(page, "Insights");
  await expect(page.getByText(/No .* logged/).first()).toBeVisible();
  await expect(page.locator(".recharts-bar-rectangle")).toHaveCount(0);
});

test("adductor sets light the inner thigh on the front and back of the muscle map", async ({ page }) => {
  const state = fixture();
  state.entries = state.entries.filter((e) => e.type !== "workout");
  const base = state.entries[0];
  state.entries.push({ ...base, id: "legs", type: "workout", title: "Legs", minutes: 0, items: [], exercises: [{ name: "Hip adduction", muscle: "adductor", sets: [1, 2].map(() => ({ reps: 12, weight: 60, done: true })) }] });
  await seed(page, state);
  await mockChat(page, []);
  await page.goto("/");
  await go(page, "Insights");
  const card = page.locator("[data-slot=card]").filter({ hasText: "Muscle map" });
  const lit = () => card.locator("polygon").evaluateAll((list) => list.filter((p) => !/163, 163, 163|#a3a3a3/i.test(getComputedStyle(p).fill)).length);
  await expect.poll(lit).toBeGreaterThan(0);
  await card.locator("polygon").evaluateAll((list) => list.find((p) => !/163, 163, 163/.test(getComputedStyle(p).fill))?.dispatchEvent(new MouseEvent("click", { bubbles: true })));
  await expect(card.getByText("Adductors (inner thigh)")).toBeVisible();
  await expect(card.getByText("· 2 sets")).toBeVisible();
  await card.getByRole("radio", { name: "Back" }).click();
  await expect.poll(lit).toBeGreaterThan(0);
});
