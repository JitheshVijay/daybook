import { test } from "node:test";
import assert from "node:assert/strict";
import { emptyState, validateState } from "../src/domain.js";
import { dailyTrackers, describeDay, loggingDays, loggingSummary } from "../src/logging.js";

const TODAY = "2026-09-13";
const entry = (id, type, date, status = "done") => ({
  id, type, date, time: "12:00", status, title: "", notes: "", minutes: 10, pages: 0, chapters: 0, steps: 100, distance: 0, bpm: 0, value: 1, quality: 3, mood: "Calm",
  lucid: false, section: "", unit: "", bookId: type === "reading" ? "b" : "", songId: "", habitId: "", exercises: type === "workout" ? [{ name: "Squat", muscle: "quadriceps", sets: [{ reps: 5, weight: 60, done: true }] }] : [], items: type === "food" ? [{ name: "Rice", servings: 1, calories: 200, protein: 4, carbs: 40, fat: 1 }] : [],
});

test("a day's shade is the share of daily trackers logged, and full days make the streak", () => {
  const state = emptyState();
  state.books = [{ id: "b", title: "Deep Work", author: "", totalPages: 0, totalChapters: 0, startPages: 0, startChapters: 0, status: "Reading", cover: "" }];
  state.entries = [
    entry("f1", "food", "2026-09-11"), entry("s1", "sleep", "2026-09-11"), entry("st1", "steps", "2026-09-11"),
    entry("f2", "food", "2026-09-12"), entry("s2", "sleep", "2026-09-12"), entry("st2", "steps", "2026-09-12"), entry("r2", "reading", "2026-09-12"),
    entry("f3", "food", "2026-09-13"), entry("w3", "workout", "2026-09-13"),
    entry("r0", "reading", "2026-09-09"),
    entry("p", "sleep", "2026-09-10", "planned"),
  ];
  const valid = validateState(state);
  const trackers = dailyTrackers(valid, TODAY);
  assert.deepEqual(trackers, ["food", "sleep", "steps"], "the daily kinds of tracking they use");
  const days = loggingDays(valid, "2026-09-09", TODAY, trackers);
  assert.deepEqual(days.map((d) => [d.date, d.level]), [["2026-09-09", 1], ["2026-09-10", 0], ["2026-09-11", 4], ["2026-09-12", 4], ["2026-09-13", 2]]);
  assert.equal(describeDay(days.at(-1)), "1 of 3 daily trackers · missing sleep, steps · also workout");
  assert.equal(describeDay(days[1]), "Nothing logged", "a plan isn't a log");
  assert.deepEqual(loggingSummary(days, TODAY), { fullDays: 2, daysWithEntries: 4, streak: 2 }, "today is still open, so the streak counts to yesterday");

  const chosen = validateState({ ...valid, profile: { ...valid.profile, dailyTrackers: ["food", "workout"] } });
  assert.deepEqual(dailyTrackers(chosen, TODAY), ["workout", "food"]);
  assert.equal(loggingDays(chosen, TODAY, TODAY, dailyTrackers(chosen, TODAY))[0].level, 4);
  assert.throws(() => validateState({ ...valid, profile: { ...valid.profile, dailyTrackers: ["naps"] } }), /daily trackers/);
  assert.deepEqual(dailyTrackers(emptyState(), TODAY), ["food", "sleep"], "a new journal starts with food and sleep");
});
