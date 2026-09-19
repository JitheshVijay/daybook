import { test, expect } from "./fixtures.mjs";
import { calls, fixture, mockChat, raw, say, seed, send, stored, storedChat, toolCall } from "./helpers.mjs";
import { executeToolCall } from "../../src/chat-tools.js";
import { applyEffects, emptyChat } from "../../src/chat-history.js";
import { dateKey, emptyState, validateState } from "../../src/domain.js";

test("a message logs complete activities, keeps partial ones pending, and undo reverts the batch", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const requests = await mockChat(page, [
    calls(
      toolCall("log_entries", {
        entries: [
          raw("meditation", { minutes: 15, quality: 4, mood: "Calm", time: "07:00", source: "meditated 15 min" }),
          raw("food", { title: "Dinner", source: "2 eggs and toast", items: [{ name: "eggs", servings: 2, calories: 72, protein: 6, carbs: 0.4, fat: 5, estimated: true, estimateNote: "one large egg" }] }),
          raw("reading", { bookTitle: "Deep Work", source: "read some Deep Work" }),
        ],
      }, "call_log"),
    ),
    say("Logged your meditation and dinner. How many pages of Deep Work did you read?"),
  ]);
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "What did you get up to today?" })).toBeVisible();
  await send(page, "meditated 15 min at 7, quality 4. 2 eggs and toast for dinner. read some Deep Work");
  const card = page.getByTestId("logged-card");
  await expect(card).toContainText("Logged 2 activities · 1 needs details");
  await expect(card).toContainText("Meditation");
  await expect(card).toContainText("300 kcal"); // the app's estimate replaces the model's guess
  expect(requests.nutrition.map((r) => r.foods)).toEqual([[{ name: "eggs", servings: 2 }]]);
  await expect(card.getByText("Estimated")).toBeVisible();
  await expect(card.getByRole("button", { name: /Fill in .* manually/ })).toBeVisible();
  await expect(page.getByText("How many pages of Deep Work did you read?")).toBeVisible();
  expect(requests).toHaveLength(2);
  expect(requests[1].iteration).toBe(2);
  const toolMessage = requests[1].messages.at(-1);
  expect(toolMessage.role).toBe("tool");
  expect(JSON.parse(toolMessage.content).needsDetails[0].questions[0]).toMatch(/pages, chapters, or minutes/);
  expect((await stored(page)).entries).toHaveLength(2);
  expect((await stored(page)).books).toHaveLength(0);

  await card.getByRole("button", { name: "Undo" }).click();
  await expect(card.getByText("Undone")).toBeVisible();
  expect((await stored(page)).entries).toHaveLength(0);
  expect(errors).toEqual([]);
});

test("tappable answers send a reply that completes the pending item", async ({ page }) => {
  const requests = await mockChat(page, [
    calls(toolCall("log_entries", { entries: [raw("cardio", { title: "Run", source: "went for a run" })] }, "c1")),
    calls(toolCall("ask_user", { question: "How long was your run?", options: ["20 min", "30 min", "45 min"] }, "c2")),
    (body) => calls(toolCall("log_entries", { entries: [raw("cardio", { title: "Run", minutes: 30, source: "30 min", resolves: body.context.pending[0].id })] }, "c3")),
    say("Logged your 30-minute run."),
  ]);
  await page.goto("/");
  await send(page, "went for a run");
  const question = page.getByTestId("question-card");
  await expect(question).toContainText("How long was your run?");
  expect((await storedChat(page)).pending).toHaveLength(1);
  await question.getByRole("button", { name: "30 min" }).click();
  await expect(page.getByText("Logged your 30-minute run.")).toBeVisible();
  expect(requests[2].messages.at(-1)).toEqual({ role: "user", content: "30 min" });
  expect((await stored(page)).entries[0].minutes).toBe(30);
  expect((await storedChat(page)).pending).toEqual([]);
  await expect(question.getByRole("button", { name: "30 min" })).toBeDisabled();
});

test("pending items can be filled in manually from the card", async ({ page }) => {
  await mockChat(page, [
    calls(toolCall("log_entries", { entries: [raw("reading", { bookTitle: "Dune", source: "read Dune" })] }, "p1")),
    say("How much of Dune did you read?"),
  ]);
  await page.goto("/");
  await send(page, "read Dune");
  await page.getByTestId("logged-card").getByRole("button", { name: /Fill in .* manually/ }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByLabel("Book", { exact: true })).toHaveValue(/.+/);
  await dialog.getByLabel("Pages read", { exact: true }).fill("40");
  await dialog.getByRole("button", { name: "Update draft" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const data = await stored(page);
  expect(data.entries[0].pages).toBe(40);
  expect(data.books[0].title).toBe("Dune");
  await expect(page.getByTestId("logged-card")).toContainText("40 pages");
});

test("chart cards are computed from saved records and open the matching Insights tab", async ({ page }) => {
  await seed(page, fixture());
  await mockChat(page, [
    calls(toolCall("query_data", { metric: "protein", habit: null, range: "last_7_days", from: null, to: null, groupBy: "day", chart: "bar" }, "q1")),
    say("You averaged about 70 g of protein on the days you logged."),
  ]);
  await page.goto("/");
  await send(page, "How is my protein this week?");
  const card = page.getByTestId("chart-card");
  await expect(card).toContainText("Protein");
  await expect(card.locator(".recharts-bar-rectangle")).toHaveCount(7);
  await card.getByRole("button", { name: "Insights" }).click();
  await expect(page.getByRole("heading", { name: "Insights", level: 1 }).last()).toBeVisible();
  await expect(page.getByRole("tab", { name: "Nutrition" })).toHaveAttribute("aria-selected", "true");
});

test("provider failures leave data untouched and can be retried; the conversation survives reload", async ({ page }) => {
  const requests = await mockChat(page, [
    { status: 502, body: { error: "The AI key was not accepted. Check the server configuration." } },
    calls(toolCall("log_entries", { entries: [raw("steps", { steps: 8200, source: "8,200 steps" })] }, "s1")),
    say("Logged 8,200 steps."),
  ]);
  await page.goto("/");
  await send(page, "8,200 steps today");
  await expect(page.getByRole("alert")).toContainText("key was not accepted");
  expect(await stored(page)).toBeNull();
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(page.getByText("Logged 8,200 steps.")).toBeVisible();
  expect(requests).toHaveLength(3);
  expect((await stored(page)).entries[0].steps).toBe(8200);
  await page.reload();
  await expect(page.getByText("Logged 8,200 steps.")).toBeVisible();
  await expect(page.getByTestId("logged-card")).toContainText("8,200 steps");
  await page.getByRole("button", { name: "New chat" }).click();
  await expect(page.getByRole("heading", { name: "What did you get up to today?" })).toBeVisible();
  expect((await stored(page)).entries).toHaveLength(1);
});

test("without an AI connection the chat explains setup and manual logging still works", async ({ page }) => {
  await mockChat(page, [], { configured: false });
  await page.goto("/");
  await expect(page.getByText("AI isn’t connected yet")).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Message Daybook" })).toBeDisabled();
  await page.getByRole("button", { name: "Log manually" }).first().click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "Steps", exact: true }).click();
  await dialog.getByLabel("Total steps for this day").fill("6500");
  await dialog.getByRole("button", { name: "Save steps" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect((await stored(page)).entries[0].steps).toBe(6500);
});

test("a gym session saves as one workout, asks only for missing reps, and the answer completes the same workout", async ({ page }) => {
  const set = (reps, weight) => ({ reps, weight, done: true });
  const requests = await mockChat(page, [
    calls(
      toolCall("log_entries", { entries: [raw("cardio", { title: "Treadmill", minutes: 12, source: "10 minutes of cardio" })] }, "g0"),
      toolCall("log_entries", { entries: [raw("workout", { title: "Deadlifts", source: "6 reps of deadlifts 80kg", exercises: [{ name: "Deadlift", muscle: null, sets: [set(6, 80)] }] })] }, "g1"),
      toolCall("log_entries", { entries: [raw("workout", { title: "Leg Extension", source: "leg extension", exercises: [{ name: "Leg extension", muscle: null, sets: [set(12, 57), set(12, 57)] }] })] }, "g2"),
      toolCall("log_entries", { entries: [raw("workout", { title: "Hip Abduction", source: "hip abduction", exercises: [{ name: "Hip abduction", muscle: null, sets: [set(null, 60), set(null, 60)] }] })] }, "g3"),
    ),
    say("Logged your treadmill and workout. How many reps did you do on hip abduction?"),
    (body) => calls(toolCall("log_entries", { entries: [raw("workout", { source: "12 reps", resolves: body.context.pending[0].id, exercises: [{ name: "Hip abduction", muscle: "abductors", sets: [set(12, 60), set(12, 60)] }] })] }, "g4")),
    say("Added hip abduction to your workout."),
  ]);
  await page.goto("/");
  await send(page, "gym: 10 min cardio, deadlifts 6x80, leg extension 2x12 at 57, hip abduction 2 sets at 60");
  const card = page.getByTestId("logged-card").first();
  await expect(card).toContainText("Logged 2 activities · 1 needs details");
  await expect(card).toContainText("2 exercises");
  const waiting = card.getByTestId("needs-details");
  await expect(waiting).toContainText("Hip abduction: how many reps in each set?");
  await expect(waiting).not.toContainText(/how long|minutes/i);
  let data = await stored(page);
  expect(data.entries.filter((e) => e.type === "workout")).toHaveLength(1);
  const combined = requests[1].messages.filter((m) => m.role === "tool").map((m) => JSON.parse(m.content));
  expect(combined.filter((r) => r.combinedWith === "g0")).toHaveLength(3);

  await send(page, "12 reps");
  await expect(page.getByText("Added hip abduction to your workout.")).toBeVisible();
  data = await stored(page);
  const workouts = data.entries.filter((e) => e.type === "workout");
  expect(workouts).toHaveLength(1);
  expect(workouts[0].exercises.map((x) => x.name)).toEqual(["Deadlift", "Leg extension", "Hip abduction"]);
  expect((await storedChat(page)).pending).toEqual([]);
});

test("foods without calories are estimated and saved without asking, and the manual form can estimate too", async ({ page }) => {
  const requests = await mockChat(page, [
    calls(
      toolCall("log_entries", {
        entries: [
          raw("food", {
            title: "Food",
            source: "i had 2 eggs fried, then i had potato and rice",
            items: [
              { name: "eggs, fried", servings: 2, calories: null, protein: null, carbs: null, fat: null, estimated: false, estimateNote: "" },
              { name: "rice", servings: null, calories: null, protein: null, carbs: null, fat: null, estimated: false, estimateNote: "" },
            ],
          }),
        ],
      }, "food"),
    ),
    (body) => {
      const result = JSON.parse(body.messages.at(-1).content);
      expect(result.needsDetails).toEqual([]);
      return say("Saved your food with estimated calories.");
    },
  ]);
  await page.goto("/");
  await send(page, "i had 2 eggs fried, then i had potato and rice");
  const card = page.getByTestId("logged-card");
  await expect(card).toContainText("450 kcal");
  await expect(card.getByText("Estimated")).toBeVisible();
  await expect(page.getByTestId("needs-details")).toHaveCount(0);
  await expect(page.getByText("Saved your food with estimated calories.")).toBeVisible();
  expect(requests.nutrition).toHaveLength(1);
  expect(requests.nutrition[0].foods).toEqual([{ name: "eggs, fried", servings: 2 }, { name: "rice", servings: null }]);
  const meal = (await stored(page)).entries.find((e) => e.type === "food");
  expect(meal.items.map((i) => [i.name, i.servings, i.calories, i.estimated])).toEqual([["eggs, fried", 2, 150, true], ["rice", 1, 150, true]]);
  expect((await storedChat(page)).pending).toEqual([]);

  await page.getByRole("button", { name: "Log manually" }).first().click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "Food", exact: true }).click();
  await dialog.getByLabel("Meal name").fill("Lunch");
  await dialog.getByLabel("Food name").fill("chicken biryani");
  await dialog.getByRole("button", { name: "Estimate calories" }).click();
  await expect(dialog.getByText("1 typical chicken biryani")).toBeVisible();
  await expect(dialog.getByLabel("Calories (kcal)")).toHaveValue("150");
  expect(requests.nutrition.at(-1).foods).toEqual([{ name: "chicken biryani", servings: 1 }]);
});

test("a conversation left with foods waiting for calories gets them estimated and saved on the next visit", async ({ page }) => {
  const today = dateKey();
  let state = emptyState();
  const commit = (update) => (state = validateState(typeof update === "function" ? update(state) : update));
  const words = "i had 2 eggs fried, then i had rice";
  const log = toolCall("log_entries", {
    entries: [
      raw("food", {
        title: "Food",
        source: words,
        items: [
          { name: "eggs, fried", servings: 2, calories: 90, protein: 6, carbs: 0.5, fat: 7, estimated: true, estimateNote: "one large egg" },
          { name: "rice", servings: null, calories: null, protein: null, carbs: null, fat: null, estimated: false, estimateNote: "" },
        ],
      }),
    ],
  }, "old");
  const out = executeToolCall(log, { state, commit, today, now: "13:00", logDate: today, turnId: "old-turn", pending: [], turnTargets: [], turnSignatures: new Set() });
  const chat = applyEffects(
    {
      ...emptyChat(),
      logDate: today,
      messages: [
        { id: "u1", role: "user", content: words, turnId: "old-turn", at: 1 },
        { id: "a1", role: "assistant", content: "", tool_calls: [log], turnId: "old-turn", at: 2 },
        { id: "t1", role: "tool", tool_call_id: "old", name: "log_entries", content: JSON.stringify(out.result), card: out.effects.card, turnId: "old-turn", at: 3 },
        { id: "a2", role: "assistant", content: "I saved your nutrition.", turnId: "old-turn", at: 4 },
      ],
    },
    out.effects,
  );
  expect(chat.pending.map((p) => p.type)).toEqual(["food"]);
  await page.addInitScript(([records, conversation]) => {
    if (!sessionStorage.getItem("seeded")) {
      localStorage.setItem("daybook.v1", JSON.stringify(records));
      localStorage.setItem("daybook.chat.v1", JSON.stringify(conversation));
      sessionStorage.setItem("seeded", "1");
    }
  }, [state, chat]);
  const requests = await mockChat(page, []);
  await page.goto("/");
  await expect(page.getByText("I estimated the calories for the foods that were waiting and saved them.")).toBeVisible();
  expect(requests.nutrition.map((r) => r.foods)).toEqual([[{ name: "rice", servings: null }]]);
  expect(requests.nutrition[0].description).toBe(words);
  const meal = (await stored(page)).entries.find((e) => e.type === "food");
  expect(meal.items.map((i) => [i.name, i.calories, i.estimated])).toEqual([["eggs, fried", 90, true], ["rice", 150, true]]);
  expect((await storedChat(page)).pending).toEqual([]);
  await expect(page.getByTestId("needs-details")).toHaveCount(0);
  expect(requests).toHaveLength(0);
});

test("a meal estimated before the estimator improved is estimated again once, with Undo", async ({ page }) => {
  const today = dateKey();
  let state = emptyState();
  const commit = (update) => (state = validateState(typeof update === "function" ? update(state) : update));
  const words = "i ate Pink Perch fish fried, 2 eggs fried, then potato curry and 1 plate of rice";
  const item = (name, servings, calories) => ({ name, servings, calories, protein: 5, carbs: 20, fat: 4, estimated: true, estimateNote: "old estimate" });
  const log = toolCall("log_entries", { entries: [raw("food", { title: "Food", source: words, items: [item("Pink Perch fish, fried", 3, 100), item("rice", 1, 200)] })] }, "old");
  const out = executeToolCall(log, { state, commit, today, now: "16:13", logDate: today, turnId: "old-turn", pending: [], turnTargets: [], turnSignatures: new Set() });
  const chat = {
    ...emptyChat(),
    logDate: today,
    messages: [
      { id: "u1", role: "user", content: words, turnId: "old-turn", at: 1 },
      { id: "a1", role: "assistant", content: "", tool_calls: [log], turnId: "old-turn", at: 2 },
      { id: "t1", role: "tool", tool_call_id: "old", name: "log_entries", content: JSON.stringify(out.result), card: out.effects.card, turnId: "old-turn", at: 3 },
      { id: "a2", role: "assistant", content: "Your meal has been logged.", turnId: "old-turn", at: 4 },
    ],
  };
  await page.addInitScript(([records, conversation]) => {
    if (!sessionStorage.getItem("seeded")) {
      localStorage.setItem("daybook.v1", JSON.stringify(records));
      localStorage.setItem("daybook.chat.v1", JSON.stringify(conversation));
      sessionStorage.setItem("seeded", "1");
    }
  }, [state, chat]);
  const requests = await mockChat(page, []);
  await page.goto("/");
  await expect(page.getByText("Calorie estimates are more accurate now, so I estimated Food again from what you told me: 500 → 600 kcal. Undo keeps the old numbers.")).toBeVisible();
  expect(requests.nutrition).toHaveLength(1);
  expect(requests.nutrition[0].description).toBe(words);
  const updated = page.getByTestId("logged-card").filter({ hasText: "Updated entry" });
  await expect(updated).toContainText("600 kcal");
  expect((await stored(page)).entries[0].items.map((i) => i.calories)).toEqual([150, 150]);

  await page.reload();
  await expect(page.getByText(/estimated Food again/)).toHaveCount(1);
  expect(requests.nutrition).toHaveLength(1); // only once per browser

  await updated.getByRole("button", { name: "Undo" }).click();
  await expect(updated.getByText("Undone")).toBeVisible();
  expect((await stored(page)).entries[0].items.map((i) => i.calories)).toEqual([100, 200]);
});

test("just after midnight the chat logs to the day that just ended", async ({ page }) => {
  await page.clock.setFixedTime(new Date("2026-09-14T00:30:00"));
  const requests = await mockChat(page, [say("Noted.")]);
  await page.goto("/");
  await expect(page.getByRole("button", { name: /Logging for Yesterday, the day that just ended/ })).toContainText("Yesterday (late night)");
  await send(page, "i meditated for 5 minutes today");
  await expect(page.getByText("Noted.")).toBeVisible();
  expect(requests[0].context.today).toBe("2026-09-14");
  expect(requests[0].context.logDate).toBe("2026-09-13");
});

test("'move the fried egg from September 12th to September 13th' moves it without asking the model", async ({ page }) => {
  await page.clock.setFixedTime(new Date("2026-09-14T11:00:00"));
  const state = emptyState();
  const item = (name, servings, calories) => ({ name, servings, calories, protein: 10, carbs: 20, fat: 10, estimated: true, estimateNote: "typical" });
  const base = { status: "done", notes: "", minutes: 0, pages: 0, chapters: 0, steps: 0, distance: 0, bpm: 0, value: 0, quality: 3, mood: "Neutral", lucid: false, section: "", unit: "", bookId: "", songId: "", habitId: "", exercises: [] };
  state.entries = [
    { ...base, id: "dinner13", type: "food", date: "2026-09-13", time: "19:00", title: "Dinner", items: [item("ghee dosa", 3, 400)] },
    { ...base, id: "egg12", type: "food", date: "2026-09-12", time: "10:43", title: "", items: [item("fried egg", 1, 98)] },
  ];
  await seed(page, state);
  const requests = await mockChat(page, []); // any call to the model would fail this test
  await page.goto("/");
  await send(page, "move the fried egg from September 12th to September 13th");
  const card = page.getByTestId("logged-card");
  await expect(card).toContainText("Updated entry");
  await expect(card).toContainText("date 2026-09-12 → 2026-09-13");
  await expect(page.getByText("Moved Food (98 kcal · 1 food) from Sat 12 Sept to Sun 13 Sept.")).toBeVisible();
  expect(requests).toHaveLength(0);
  const saved = await stored(page);
  expect(saved.entries.map((e) => [e.id, e.date, e.title])).toEqual([["dinner13", "2026-09-13", "Dinner"], ["egg12", "2026-09-13", ""]]);
  await card.getByRole("button", { name: "Undo" }).click();
  await expect.poll(async () => (await stored(page)).entries.find((e) => e.id === "egg12").date).toBe("2026-09-12");
});
