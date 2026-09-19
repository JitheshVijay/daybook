import { test, expect } from "./fixtures.mjs";
import { go, mockChat, stored } from "./helpers.mjs";

test.beforeEach(async ({ page }) => {
  await mockChat(page, []);
});

test("manual workout logging, editing and deleting from the Journal, and backup restore", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await page.getByRole("button", { name: "Log manually" }).first().click();
  let dialog = page.getByRole("dialog");
  await dialog.getByLabel("Workout name").fill("Upper body");
  await dialog.getByLabel("Duration (minutes)").fill("45");
  await dialog.getByLabel("Exercise name").fill("Bench press");
  for (const set of [1, 2, 3]) await dialog.getByLabel(`Exercise 1 set ${set} weight`, { exact: true }).fill("40");
  await dialog.getByRole("button", { name: "Save workout" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);

  await go(page, "Journal");
  await page.getByRole("button", { name: /Upper body/ }).click();
  dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("45 min · 3 sets · 1 exercise");
  await dialog.getByRole("button", { name: "Edit entry" }).click();
  dialog = page.getByRole("dialog");
  await dialog.getByLabel("Exercise 1 set 1 reps", { exact: true }).fill("12");
  await dialog.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect((await stored(page)).entries[0].exercises[0].sets[0].reps).toBe(12);

  await go(page, "Settings");
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export backup" }).first().click();
  const backupPath = await (await downloadPromise).path();

  await go(page, "Journal");
  await page.getByRole("button", { name: /Upper body/ }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Delete entry" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Delete entry" }).click();
  await expect(page.getByText("No entries for this day")).toBeVisible();

  await go(page, "Settings");
  await page.locator("input[type=file]").setInputFiles(backupPath);
  await page.getByRole("button", { name: "Restore these records" }).click();
  expect((await stored(page)).entries).toHaveLength(1);
  expect(errors).toEqual([]);
});

test("books and habits can be created inside the log form", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Log manually" }).first().click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "Reading", exact: true }).click();
  await dialog.getByLabel("Book title").fill("Deep Work");
  await dialog.getByRole("button", { name: "Add book", exact: true }).click();
  await dialog.getByLabel("Pages read", { exact: true }).fill("12");
  await dialog.getByRole("button", { name: "Save reading" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("button", { name: "Log manually" }).first().click();
  await page.getByRole("dialog").getByRole("button", { name: "Habit", exact: true }).click();
  await page.getByRole("dialog").getByLabel("Habit name").fill("Water");
  await page.getByRole("dialog").getByLabel("Unit", { exact: true }).fill("glasses");
  await page.getByRole("dialog").getByRole("button", { name: "Add habit", exact: true }).click();
  await page.getByRole("dialog").getByLabel("Amount (glasses)").fill("3");
  await page.getByRole("dialog").getByRole("button", { name: "Save habit" }).click();
  const data = await stored(page);
  expect(data.books.map((b) => b.title)).toEqual(["Deep Work"]);
  expect(data.habits.map((h) => h.name)).toEqual(["Water"]);
  expect(data.entries).toHaveLength(2);
});

test("unreadable saved data is preserved and never overwritten", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("daybook.v1", "broken original"));
  await page.goto("/");
  await expect(page.getByRole("alert").first()).toContainText("Existing data has not been overwritten");
  await expect.poll(() => page.evaluate(() => localStorage.getItem("daybook.v1"))).toBe("broken original");
});

test("the Journal heatmap shades days by how much was logged and opens a day when tapped", async ({ page }) => {
  const { fixture, seed, mockChat, go, stored } = await import("./helpers.mjs");
  const { dateKey, shiftDate } = await import("../../src/domain.js");
  await seed(page, fixture());
  await mockChat(page, []);
  await page.goto("/");
  await go(page, "Journal");
  const heatmap = page.getByTestId("logging-heatmap");
  await expect(heatmap).toContainText("Full days");
  const yesterday = shiftDate(dateKey(), -1);
  const cell = heatmap.locator(`[data-date="${yesterday}"]`);
  await expect(cell).toHaveAttribute("data-level", /[1-4]/);
  await cell.click();
  await expect(page.getByRole("heading", { level: 2 })).not.toHaveText("Today");
  await expect(heatmap.getByText(/daily trackers/).first()).toBeVisible();
  await cell.press("ArrowDown");
  await expect(heatmap.locator(`[data-date="${dateKey()}"]`)).toBeFocused();

  await heatmap.getByRole("button", { name: "Full day" }).click();
  await page.getByRole("checkbox", { name: "Workout" }).click();
  await expect.poll(async () => (await stored(page)).profile.dailyTrackers).toContain("workout");
  await expect(heatmap).toContainText(/A full day includes .*workout/);
});

test("a yes-or-no habit is checked off in one tap", async ({ page }) => {
  const { seed, mockChat, go, stored } = await import("./helpers.mjs");
  const { emptyState } = await import("../../src/domain.js");
  const state = emptyState();
  state.habits = [{ id: "teeth", name: "Brush teeth at night", unit: "times", goal: 1 }];
  await seed(page, state);
  await mockChat(page, []);
  await page.goto("/");
  await go(page, "Journal");
  const habit = page.getByRole("button", { name: /^Brush teeth at night (Tap when done|Done)$/ });
  await expect(habit).toContainText("Tap when done");
  await habit.click();
  await expect(habit).toContainText("Done");
  expect((await stored(page)).entries.map((e) => [e.habitId, e.value])).toEqual([["teeth", 1]]);

  await go(page, "Insights");
  await expect(page.getByRole("tab", { name: "Work" })).toHaveCount(0);
});

test("with the database, this browser's data moves in once and every change is saved there", async ({ page }) => {
  const { applyChanges } = await import("../../src/sync.js");
  const { seed, mockChat, go } = await import("./helpers.mjs");
  const { emptyState } = await import("../../src/domain.js");
  // A stand-in for the local database server (the real one is covered by tests/database.test.mjs).
  const server = { state: emptyState(), chat: null, version: 0, requests: [] };
  const local = emptyState();
  local.habits = [{ id: "teeth", name: "Brush teeth at night", unit: "times", goal: 1 }];
  await seed(page, local);
  await mockChat(page, []);
  await page.route("**/api/data**", async (route) => {
    const request = route.request();
    const url = new URL(request.url()).pathname;
    const body = request.postDataJSON?.() || null;
    server.requests.push(`${request.method()} ${url}`);
    if (request.method() === "GET" && url === "/api/data")
      return route.fulfill({ json: { mode: "database", file: "data/daybook.db", version: server.version, empty: server.state.habits.length + server.state.entries.length === 0, state: server.state, chat: server.chat } });
    if (url === "/api/data/version") return route.fulfill({ json: { version: server.version } });
    if (url === "/api/data" && request.method() === "PUT") server.state = body.state;
    else if (url === "/api/data/chat") server.chat = body.chat;
    else if (url === "/api/data/changes") server.state = applyChanges(server.state, body.changes);
    server.version += 1;
    return route.fulfill({ json: { version: server.version } });
  });
  await page.goto("/");
  await expect(page.getByText("Your data is now in the Daybook database")).toBeVisible();
  await expect.poll(() => server.state.habits.map((h) => h.name)).toEqual(["Brush teeth at night"]);

  await go(page, "Journal");
  await page.getByRole("button", { name: /^Brush teeth at night (Tap when done|Done)$/ }).click();
  await expect.poll(() => server.state.entries.map((e) => [e.habitId, e.value])).toEqual([["teeth", 1]]);
  expect(server.requests).toContain("POST /api/data/changes");

  await go(page, "Settings");
  await expect(page.getByTestId("storage-card")).toContainText("In the Daybook database on this computer (data/daybook.db)");
  await expect(page.getByTestId("storage-card")).toContainText("All changes are saved.");

  await page.reload();
  await expect(page.getByText("Your data is now in the Daybook database")).toHaveCount(0);
  expect(server.requests.filter((r) => r === "PUT /api/data")).toHaveLength(1);
});

test("an entry logged while a chat save is still on its way reaches the database (lost back workout, 2026-09-14)", async ({ page }) => {
  const { applyChanges } = await import("../../src/sync.js");
  const { mockChat, raw, toolCall, calls, say, send } = await import("./helpers.mjs");
  const { emptyState } = await import("../../src/domain.js");
  const server = { state: emptyState(), chat: null, version: 0 };
  server.state.habits = [{ id: "teeth", name: "Brush teeth at night", unit: "times", goal: 1 }];
  const workout = raw("workout", { title: "Workout", source: "pull down 4x12 at 30", exercises: [{ name: "Lat pulldown", muscle: null, sets: [30, 40, 50, 60].map((weight) => ({ weight, reps: 12, done: true })) }] });
  const cardio = raw("cardio", { title: "Cardio", minutes: 5, source: "5 minutes of cardio" });
  const kombucha = raw("food", { title: "Food", source: "200ml 37 kcal kombucha", items: [{ name: "kombucha, 200 ml", servings: 1, calories: 37, protein: null, carbs: null, fat: null, estimated: false, estimateNote: "" }] });
  await mockChat(page, [calls(toolCall("log_entries", { entries: [workout, cardio] })), say("Logged."), calls(toolCall("log_entries", { entries: [kombucha] })), say("Logged.")]);
  await page.route("**/api/data**", async (route) => {
    const request = route.request();
    const url = new URL(request.url()).pathname;
    const body = request.postDataJSON?.() || null;
    if (request.method() === "GET" && url === "/api/data") return route.fulfill({ json: { mode: "database", file: "data/daybook.db", version: server.version, empty: false, state: server.state, chat: server.chat } });
    if (url === "/api/data/version") return route.fulfill({ json: { version: server.version } });
    // A slow conversation save: entries are saved while it is still on its way.
    if (url === "/api/data/chat") {
      await new Promise((resolve) => setTimeout(resolve, 700));
      server.chat = body.chat;
    } else if (url === "/api/data/changes") server.state = applyChanges(server.state, body.changes);
    server.version += 1;
    return route.fulfill({ json: { version: server.version } });
  });
  await page.goto("/");
  await send(page, "i went to the gym and did lat pulldown 4 sets of 12 reps with 30kg, 40kg, 50kg and 60kg, then 5 minutes of cardio");
  await expect(page.getByText("Logged.")).toBeVisible();
  await expect.poll(() => server.state.entries.map((e) => e.type).sort(), { timeout: 8000 }).toEqual(["cardio", "workout"]);
  await send(page, "i had 200ml 37 kcal kombucha");
  await expect(page.getByText("Logged.")).toHaveCount(2);
  await expect.poll(() => server.state.entries.map((e) => e.type).sort(), { timeout: 8000 }).toEqual(["cardio", "food", "workout"]);
  await page.reload();
  await expect.poll(() => server.chat?.messages?.filter((m) => m.card).length, { timeout: 8000 }).toBe(2);
});
