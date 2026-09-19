import { test } from "node:test";
import assert from "node:assert/strict";
import { emptyState } from "../src/domain.js";
import {
  computeSeries,
  rangeDates,
  previousRange,
  resolveChartRequest,
  caloriesByMeal,
  setsByMuscle,
  daysAtGoal,
  recentDays,
} from "../src/insights.js";

const TODAY = "2026-09-13"; // a Sunday
const entry = (type, date, rest = {}) => ({
  id: `${type}-${date}-${Math.random()}`,
  type,
  date,
  time: "09:00",
  status: "done",
  ...rest,
});
const food = (date, title, calories, protein = 0) =>
  entry("food", date, { title, items: [{ name: title, servings: 1, calories, protein, carbs: 10, fat: 5 }] });

test("named ranges resolve to local inclusive dates and never pass today", () => {
  assert.deepEqual(rangeDates("today", TODAY).dates, [TODAY]);
  assert.equal(rangeDates("this_week", TODAY).from, "2026-09-07");
  assert.equal(rangeDates("this_week", TODAY).to, TODAY);
  assert.deepEqual([rangeDates("last_week", TODAY).from, rangeDates("last_week", TODAY).to], ["2026-08-31", "2026-09-06"]);
  assert.equal(rangeDates("last_30_days", TODAY).dates.length, 30);
  assert.equal(rangeDates("this_month", TODAY).from, "2026-09-01");
  assert.equal(rangeDates("last_7_days", "2027-01-03").from, "2026-12-28");
  assert.deepEqual(previousRange(rangeDates("last_7_days", TODAY)), {
    from: "2026-08-31",
    to: "2026-09-06",
    dates: rangeDates("last_week", TODAY).dates,
  });
  assert.throws(() => rangeDates("custom", TODAY, "2026-09-10", "2026-09-01"), /starts after/);
  assert.throws(() => rangeDates("custom", TODAY, "2025-01-01", "2026-09-01"), /366/);
  assert.throws(() => rangeDates("fortnight", TODAY), /Unknown range/);
});

test("series keep missing days as null, summarize logged days, and compare with the previous period", () => {
  const state = emptyState();
  state.profile.stepsGoal = 8000;
  state.entries = [
    entry("steps", "2026-09-08", { steps: 6000 }),
    entry("steps", "2026-09-10", { steps: 9000 }),
    entry("steps", "2026-09-13", { steps: 3000, status: "planned" }),
    entry("steps", "2026-09-01", { steps: 5000 }),
  ];
  const series = computeSeries(state, "steps", { range: "last_7_days" }, TODAY);
  assert.equal(series.points.length, 7);
  assert.deepEqual(series.points.map((p) => p.value), [null, 6000, null, 9000, null, null, null]);
  assert.equal(series.summary.total, 15000);
  assert.equal(series.summary.daysWithData, 2);
  assert.equal(series.summary.perLoggedDay, 7500);
  assert.deepEqual(series.summary.best, { date: "2026-09-10", value: 9000 });
  assert.equal(series.summary.previous.total, 5000);
  assert.equal(series.summary.previous.change, 2);
  assert.equal(series.goal, 8000);
  assert.deepEqual(daysAtGoal(series), { hit: 1, logged: 2 });
});

test("lower-is-better metrics pick the lowest day as best; weekly goals have no daily line", () => {
  const state = emptyState();
  state.entries = [
    entry("screentime", "2026-09-11", { minutes: 200 }),
    entry("screentime", "2026-09-12", { minutes: 90 }),
    entry("workout", "2026-09-12", { minutes: 40, exercises: [{ name: "Squat", muscle: "quadriceps", sets: [{ weight: 60, reps: 5, done: true }] }] }),
  ];
  assert.deepEqual(computeSeries(state, "screentime", { range: "last_7_days" }, TODAY).summary.best, { date: "2026-09-12", value: 90 });
  const workouts = computeSeries(state, "workouts", { range: "last_7_days" }, TODAY);
  assert.equal(workouts.goal, null);
  assert.equal(computeSeries(state, "workouts", { range: "last_90_days" }, TODAY).bucket, "week");
  assert.equal(computeSeries(state, "workouts", { range: "last_90_days" }, TODAY).goal, 4);
  assert.equal(computeSeries(state, "volume", { range: "today" }, "2026-09-12").summary.total, 300);
});

test("macros are multi-series and quality averages instead of summing", () => {
  const state = emptyState();
  state.entries = [
    food("2026-09-12", "Breakfast", 300, 20),
    food("2026-09-12", "Dinner", 700, 40),
    entry("meditation", "2026-09-12", { minutes: 10, quality: 4, mood: "Calm" }),
    entry("meditation", "2026-09-12", { minutes: 10, quality: 2, mood: "Calm" }),
  ];
  const macros = computeSeries(state, "macros", { range: "last_7_days" }, TODAY);
  assert.deepEqual(macros.series.map((s) => s.key), ["protein", "carbs", "fat"]);
  const day = macros.points.find((p) => p.date === "2026-09-12");
  assert.deepEqual([day.protein, day.carbs, day.fat], [60, 20, 10]);
  assert.equal(computeSeries(state, "meditationQuality", { range: "today" }, "2026-09-12").points[0].value, 3);
  const meals = caloriesByMeal(state, rangeDates("last_7_days", TODAY));
  assert.deepEqual(meals.series.map((s) => s.key), ["Breakfast", "Dinner"]);
  assert.equal(meals.points.find((p) => p.date === "2026-09-12").Dinner, 700);
});

test("chart requests from the assistant are whitelisted", () => {
  const state = emptyState();
  state.habits = [{ id: "h1", name: "Water", unit: "glasses", goal: 8 }];
  assert.deepEqual(resolveChartRequest(state, { metric: "protein", range: "this_week", chart: "bar", groupBy: "day" }, TODAY), {
    metric: "protein",
    range: "this_week",
    from: null,
    to: null,
    habitId: null,
    groupBy: "day",
    chart: "bar",
  });
  assert.equal(resolveChartRequest(state, { metric: "habit", habit: "water", range: "today", chart: "none", groupBy: "total" }, TODAY).habitId, "h1");
  assert.throws(() => resolveChartRequest(state, { metric: "happiness", range: "today" }, TODAY), /Unknown metric/);
  assert.throws(() => resolveChartRequest(state, { metric: "habit", habit: "Juggling", range: "today" }, TODAY), /existing habits/);
  assert.throws(() => resolveChartRequest(state, { metric: "steps", range: "custom", from: "2026-09-02" }, TODAY), /custom range/);
});

test("breakdowns and assistant context use completed records only", () => {
  const state = emptyState();
  state.entries = [
    entry("workout", "2026-09-12", { minutes: 40, exercises: [{ name: "Bench", muscle: "chest", sets: [{ weight: 40, reps: 10, done: true }, { weight: 40, reps: 10, done: false }] }] }),
    entry("steps", "2026-09-13", { steps: 4000 }),
    entry("steps", "2026-09-11", { steps: 9999, status: "planned" }),
  ];
  assert.deepEqual(setsByMuscle(state, rangeDates("last_7_days", TODAY)), [{ muscle: "chest", label: "chest", sets: 1 }]);
  const days = recentDays(state, TODAY);
  assert.deepEqual(days.map((d) => d.date), ["2026-09-12", "2026-09-13"]);
  assert.equal(days[1].steps, 4000);
  assert.equal(days[0].workouts, 1);
});
