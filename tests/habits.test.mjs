import { test } from "node:test";
import assert from "node:assert/strict";
import { emptyState, entryDetail, totals, validateState } from "../src/domain.js";
import { extractionSchema } from "../src/day-import.js";
import { executeToolCall, undoBatch } from "../src/chat-tools.js";
import { computeSeries } from "../src/insights.js";

const TODAY = "2026-09-13";
const raw = (type, values = {}) => ({
  ...Object.fromEntries(Object.entries(extractionSchema.properties.entries.items.properties).map(([k, s]) => [k, Array.isArray(s.type) && s.type.includes("null") ? null : s.type === "array" ? [] : s.type === "boolean" ? false : ""])),
  type, status: "done", source: "", resolves: null, ...values,
});
const call = (name, args, id = "call_1") => ({ id, type: "function", function: { name, arguments: JSON.stringify(args) } });
function makeStore(initial = emptyState()) {
  let state = initial;
  return { get: () => state, commit: (u) => (state = validateState(typeof u === "function" ? u(state) : u)) };
}
const ctx = (store, extra = {}) => ({ state: store.get(), commit: store.commit, today: TODAY, now: "22:00", logDate: TODAY, turnId: "t", pending: [], ...extra });

test("old work entries still load and show after the Work tracker was removed", () => {
  const state = emptyState();
  state.profile.dailyTrackers = ["food", "work"];
  state.entries = [{ id: "w1", type: "work", date: TODAY, time: "10:00", status: "done", title: "Quarterly report", notes: "", minutes: 420, pages: 0, chapters: 0, steps: 0, distance: 0, bpm: 0, value: 0, quality: 3, mood: "Neutral", lucid: false, section: "", unit: "", bookId: "", songId: "", habitId: "", exercises: [], items: [], workKind: "office", project: "Q3 report" }];
  const loaded = validateState(state);
  assert.equal(loaded.entries.length, 1);
  assert.equal(entryDetail(loaded.entries[0]), "7h");
  assert.ok(!extractionSchema.properties.entries.items.properties.type.enum.includes("work"), "the assistant can't log work");
  assert.ok(!("workKind" in extractionSchema.properties.entries.items.properties));
  assert.equal(totals(loaded.entries).work, undefined);
});

test("a yes-or-no habit is set up in chat and logged by meaning, once a day", () => {
  const store = makeStore();
  const setup = executeToolCall(call("add_habits", { habits: [{ name: "Brush teeth at night", unit: null, goal: null }] }, "h"), ctx(store));
  assert.deepEqual(store.get().habits.map(({ name, unit, goal }) => ({ name, unit, goal })), [{ name: "Brush teeth at night", unit: "times", goal: 1 }]);
  assert.equal(store.get().entries.length, 0, "setting up logs nothing");
  assert.equal(setup.effects.card.mode, "habits");
  const again = executeToolCall(call("add_habits", { habits: [{ name: "brush teeth at night", unit: null, goal: null }] }, "h2"), ctx(store, { state: store.get() }));
  assert.equal(store.get().habits.length, 1);
  assert.equal(again.result.alreadyTracked.length, 1);

  executeToolCall(call("log_entries", { entries: [raw("habit", { habitName: "Brush teeth at night", value: 1, source: "brushed my teeth before bed" })] }, "l"), ctx(store, { state: store.get() }));
  const state = store.get();
  assert.equal(state.habits.length, 1, "the log joins the habit");
  assert.deepEqual(state.entries.map((e) => [e.habitId, e.value]), [[state.habits[0].id, 1]]);
  assert.equal(computeSeries(state, "habit", { range: "today", habitId: state.habits[0].id }, TODAY).goal, 1);

  store.commit((s) => undoBatch(s, setup.effects.card));
  assert.equal(store.get().habits.length, 1, "a habit with a log stays after Undo");

  const fresh = makeStore();
  executeToolCall(call("log_entries", { entries: [raw("habit", { habitName: "Took vitamins", value: 1, source: "took my vitamins" })] }, "v"), ctx(fresh));
  assert.equal(fresh.get().habits[0].goal, 1, "a habit first met in a log is once a day too");
});
