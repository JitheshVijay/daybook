// Series, summaries, and breakdowns computed from real records only.
// Shared by the Insights page, chart cards in chat, and the assistant's query_data tool.
import {
  completed,
  dateKey,
  parseDate,
  shiftDate,
  sum,
  totals,
  trainingStats,
  weekDates,
  validDate,
  MUSCLES,
} from "./domain.js";

export const RANGES = [
  "today",
  "yesterday",
  "this_week",
  "last_week",
  "last_7_days",
  "last_30_days",
  "last_90_days",
  "this_month",
  "custom",
];
export const RANGE_LABELS = {
  today: "Today",
  yesterday: "Yesterday",
  this_week: "This week",
  last_week: "Last week",
  last_7_days: "Last 7 days",
  last_30_days: "Last 30 days",
  last_90_days: "Last 90 days",
  this_month: "This month",
  custom: "Custom range",
};

const MACRO_SERIES = [
  { key: "protein", label: "Protein" },
  { key: "carbs", label: "Carbs" },
  { key: "fat", label: "Fat" },
];

// kind: "sum" adds per day; "mean" averages sessions (e.g. quality ratings).
export const METRICS = {
  workouts: { label: "Workouts", unit: "workouts", types: ["workout"], kind: "sum", pick: (t) => t.workouts, goal: { key: "workoutGoal", per: "week" } },
  workoutMinutes: { label: "Training time", unit: "min", types: ["workout"], kind: "sum", pick: (t) => t.workoutMinutes },
  sets: { label: "Completed sets", unit: "sets", types: ["workout"], kind: "sum", pick: (_, list) => trainingStats(list).sets },
  volume: { label: "Training volume", unit: "kg", types: ["workout"], kind: "sum", pick: (_, list) => trainingStats(list).volume },
  cardio: { label: "Cardio", unit: "min", types: ["cardio"], kind: "sum", pick: (t) => t.cardio },
  steps: { label: "Steps", unit: "steps", types: ["steps"], kind: "sum", pick: (t) => t.steps, goal: { key: "stepsGoal", per: "day" } },
  sleep: { label: "Sleep", unit: "min", types: ["sleep"], kind: "sum", pick: (t) => t.sleep },
  screentime: { label: "Screen time", unit: "min", types: ["screentime"], kind: "sum", pick: (t) => t.screentime, goal: { key: "screenGoal", per: "day" }, lowerIsBetter: true },
  calories: { label: "Calories", unit: "kcal", types: ["food"], kind: "sum", pick: (t) => t.calories, goal: { key: "calorieGoal", per: "day" } },
  protein: { label: "Protein", unit: "g", types: ["food"], kind: "sum", pick: (t) => t.protein, goal: { key: "proteinGoal", per: "day" } },
  carbs: { label: "Carbs", unit: "g", types: ["food"], kind: "sum", pick: (t) => t.carbs },
  fat: { label: "Fat", unit: "g", types: ["food"], kind: "sum", pick: (t) => t.fat },
  macros: { label: "Macros", unit: "g", types: ["food"], kind: "sum", series: MACRO_SERIES, pick: (t) => t.protein + t.carbs + t.fat },
  pages: { label: "Pages read", unit: "pages", types: ["reading"], kind: "sum", pick: (t) => t.pages, goal: { key: "readingGoal", per: "day" } },
  reading: { label: "Reading time", unit: "min", types: ["reading"], kind: "sum", pick: (t) => t.reading },
  guitar: { label: "Guitar practice", unit: "min", types: ["guitar"], kind: "sum", pick: (t) => t.guitar, goal: { key: "guitarGoal", per: "day" } },
  meditation: { label: "Meditation", unit: "min", types: ["meditation"], kind: "sum", pick: (t) => t.meditation, goal: { key: "meditationGoal", per: "day" } },
  meditationQuality: { label: "Meditation quality", unit: "/ 5", types: ["meditation"], kind: "mean", pick: (_, list) => sum(list.filter((e) => e.type === "meditation"), (e) => e.quality) / Math.max(1, list.filter((e) => e.type === "meditation").length) },
  dreams: { label: "Dreams recorded", unit: "dreams", types: ["dream"], kind: "sum", pick: (t) => t.dreams },
  habit: { label: "Habit", unit: "", types: ["habit"], kind: "sum", pick: () => 0 },
};
export const METRIC_KEYS = Object.keys(METRICS);

const MAX_CUSTOM_DAYS = 366;
const round = (value, digits = 1) =>
  value === null || value === undefined
    ? null
    : Math.round(value * 10 ** digits) / 10 ** digits;
const daysBetween = (from, to) =>
  Math.round((parseDate(to) - parseDate(from)) / 86400000) + 1;

export function listDates(from, to) {
  const count = daysBetween(from, to);
  return Array.from({ length: count }, (_, i) => shiftDate(from, i));
}

// Resolve a named range to inclusive local dates. Ranges never extend past today.
export function rangeDates(range, today = dateKey(), from = null, to = null) {
  let start, end;
  switch (range) {
    case "today":
      start = end = today;
      break;
    case "yesterday":
      start = end = shiftDate(today, -1);
      break;
    case "this_week":
      start = weekDates(today)[0];
      end = today;
      break;
    case "last_week": {
      const monday = weekDates(today)[0];
      start = shiftDate(monday, -7);
      end = shiftDate(monday, -1);
      break;
    }
    case "last_7_days":
      start = shiftDate(today, -6);
      end = today;
      break;
    case "last_30_days":
      start = shiftDate(today, -29);
      end = today;
      break;
    case "last_90_days":
      start = shiftDate(today, -89);
      end = today;
      break;
    case "this_month":
      start = `${today.slice(0, 7)}-01`;
      end = today;
      break;
    case "custom":
      if (!validDate(from) || !validDate(to))
        throw Error("A custom range needs from and to dates as YYYY-MM-DD.");
      if (from > to) throw Error("The range starts after it ends.");
      if (daysBetween(from, to) > MAX_CUSTOM_DAYS)
        throw Error(`Choose a range of ${MAX_CUSTOM_DAYS} days or fewer.`);
      start = from;
      end = to;
      break;
    default:
      throw Error(`Unknown range “${range}”.`);
  }
  return { from: start, to: end, dates: listDates(start, end) };
}

// The equally long period immediately before a range.
export function previousRange({ from, to }) {
  const length = daysBetween(from, to);
  const end = shiftDate(from, -1);
  const start = shiftDate(end, -(length - 1));
  return { from: start, to: end, dates: listDates(start, end) };
}

function groupByDate(entries, dates) {
  const wanted = new Set(dates);
  const map = new Map(dates.map((d) => [d, []]));
  for (const e of completed(entries)) if (wanted.has(e.date)) map.get(e.date).push(e);
  return map;
}

function relevant(list, metric, habitId) {
  const spec = METRICS[metric];
  return list.filter(
    (e) =>
      spec.types.includes(e.type) && (metric !== "habit" || e.habitId === habitId),
  );
}

function dayValue(list, metric, habitId) {
  const spec = METRICS[metric];
  const own = relevant(list, metric, habitId);
  if (!own.length) return null;
  if (metric === "habit") return sum(own, (e) => e.value);
  if (spec.series) {
    const t = totals(own);
    return Object.fromEntries(spec.series.map((s) => [s.key, round(t[s.key])]));
  }
  return round(spec.pick(totals(own), own), metric === "meditationQuality" ? 2 : 1);
}

const weekStart = (key) => weekDates(key)[0];
const shortDay = (key) =>
  parseDate(key).toLocaleDateString("en-GB", { weekday: "short" });
const shortDate = (key) =>
  parseDate(key).toLocaleDateString("en-GB", { day: "numeric", month: "short" });

export function metricGoal(state, metric, habitId, bucket) {
  const spec = METRICS[metric];
  if (metric === "habit") {
    const goal = state.habits.find((h) => h.id === habitId)?.goal || 0;
    return goal ? (bucket === "week" ? goal * 7 : goal) : null;
  }
  if (!spec?.goal) return null;
  const value = Number(state.profile?.[spec.goal.key]) || 0;
  if (!value) return null;
  if (spec.goal.per === bucket) return value;
  if (spec.goal.per === "day" && bucket === "week") return value * 7;
  return null; // A weekly goal has no honest daily line.
}

export function metricLabel(state, metric, habitId) {
  if (metric !== "habit") return METRICS[metric].label;
  return state.habits.find((h) => h.id === habitId)?.name || "Habit";
}
export function metricUnit(state, metric, habitId) {
  if (metric !== "habit") return METRICS[metric].unit;
  return state.habits.find((h) => h.id === habitId)?.unit || "times";
}

function summarize(values, spec, dates) {
  const logged = values
    .map((value, i) => ({ date: dates[i], value }))
    .filter((p) => p.value !== null);
  const scalar = (v) =>
    v && typeof v === "object" ? Object.values(v).reduce((a, b) => a + b, 0) : v;
  const total =
    spec.kind === "mean"
      ? logged.length
        ? logged.reduce((a, p) => a + p.value, 0) / logged.length
        : 0
      : logged.reduce((a, p) => a + scalar(p.value), 0);
  let best = null;
  for (const p of logged) {
    const v = scalar(p.value);
    if (!best || (spec.lowerIsBetter ? v < best.value : v > best.value))
      best = { date: p.date, value: round(v) };
  }
  return {
    total: round(total, spec.kind === "mean" ? 2 : 1),
    perLoggedDay:
      spec.kind === "mean"
        ? round(total, 2)
        : logged.length
          ? round(total / logged.length)
          : 0,
    daysWithData: logged.length,
    days: dates.length,
    best,
  };
}

/**
 * computeSeries(state, metric, options, today)
 * options: { range, from, to, habitId, groupBy: "day" | "week" | "total" }
 * Days without a relevant entry are null (missing, not zero).
 */
export function computeSeries(state, metric, options = {}, today = dateKey()) {
  const spec = METRICS[metric];
  if (!spec) throw Error(`Unknown metric “${metric}”.`);
  const habitId = options.habitId || null;
  if (metric === "habit" && !state.habits.some((h) => h.id === habitId))
    throw Error("Choose one of the existing habits.");
  const window = rangeDates(options.range || "last_7_days", today, options.from, options.to);
  const groupBy =
    options.groupBy || (window.dates.length > 31 ? "week" : "day");
  const byDate = groupByDate(state.entries, window.dates);
  const daily = window.dates.map((d) => dayValue(byDate.get(d), metric, habitId));
  const summary = summarize(daily, spec, window.dates);

  const prev = previousRange(window);
  const prevByDate = groupByDate(state.entries, prev.dates);
  const prevSummary = summarize(
    prev.dates.map((d) => dayValue(prevByDate.get(d), metric, habitId)),
    spec,
    prev.dates,
  );
  summary.previous = {
    from: prev.from,
    to: prev.to,
    total: prevSummary.total,
    daysWithData: prevSummary.daysWithData,
    change:
      prevSummary.daysWithData && prevSummary.total
        ? round((summary.total - prevSummary.total) / prevSummary.total, 3)
        : null,
  };

  const seriesKeys = spec.series || [{ key: "value", label: metricLabel(state, metric, habitId) }];
  const series = seriesKeys.map((s, i) => ({ ...s, color: `var(--chart-${i + 1})` }));
  let points;
  if (groupBy === "week") {
    const weeks = new Map();
    window.dates.forEach((d, i) => {
      const key = weekStart(d);
      if (!weeks.has(key)) weeks.set(key, []);
      weeks.get(key).push(daily[i]);
    });
    points = [...weeks.entries()].map(([key, values]) => {
      const logged = values.filter((v) => v !== null);
      const point = { date: key, label: shortDate(key) };
      if (!logged.length) {
        for (const s of series) point[s.key] = null;
      } else if (spec.series) {
        for (const s of series) point[s.key] = round(sum(logged, (v) => v[s.key]));
      } else {
        point.value =
          spec.kind === "mean"
            ? round(logged.reduce((a, b) => a + b, 0) / logged.length, 2)
            : round(logged.reduce((a, b) => a + b, 0));
      }
      return point;
    });
  } else {
    points = window.dates.map((d, i) => {
      const point = {
        date: d,
        label: window.dates.length <= 7 ? shortDay(d) : shortDate(d),
      };
      if (spec.series)
        for (const s of series) point[s.key] = daily[i] ? daily[i][s.key] : null;
      else point.value = daily[i];
      return point;
    });
  }
  const bucket = groupBy === "week" ? "week" : "day";
  return {
    metric,
    habitId,
    label: metricLabel(state, metric, habitId),
    unit: metricUnit(state, metric, habitId),
    lowerIsBetter: Boolean(spec.lowerIsBetter),
    kind: spec.kind,
    range: options.range || "last_7_days",
    from: window.from,
    to: window.to,
    groupBy: groupBy === "total" ? "total" : bucket,
    bucket,
    series,
    points: groupBy === "total" ? [] : points,
    goal: metricGoal(state, metric, habitId, bucket),
    summary,
  };
}

// Validate a chart/query request coming from the assistant before rendering it.
export function resolveChartRequest(state, args, today = dateKey()) {
  const metric = args?.metric;
  if (!METRICS[metric]) throw Error(`Unknown metric “${metric}”.`);
  const range = args.range || "last_7_days";
  if (!RANGES.includes(range)) throw Error(`Unknown range “${range}”.`);
  const groupBy = ["day", "week", "total"].includes(args.groupBy) ? args.groupBy : undefined;
  const habitId =
    metric === "habit"
      ? state.habits.find((h) => h.id === args.habit || h.name.toLowerCase() === String(args.habit || "").toLowerCase())?.id
      : null;
  if (metric === "habit" && !habitId) throw Error("Choose one of the existing habits.");
  const chart = ["bar", "line"].includes(args.chart) ? args.chart : "none";
  rangeDates(range, today, args.from, args.to); // throws on a bad custom range
  return {
    metric,
    range,
    from: range === "custom" ? args.from : null,
    to: range === "custom" ? args.to : null,
    habitId,
    groupBy: chart !== "none" && groupBy === "total" ? undefined : groupBy,
    chart,
  };
}

// ---------- breakdowns for the Insights page ----------

export function entriesInRange(state, from, to, types = null) {
  return completed(state.entries).filter(
    (e) => e.date >= from && e.date <= to && (!types || types.includes(e.type)),
  );
}

const MEALS = ["Breakfast", "Lunch", "Dinner", "Snack", "Other"];
export function mealName(entry) {
  const title = (entry.title || "").toLowerCase();
  if (/breakfast|brunch/.test(title)) return "Breakfast";
  if (/lunch/.test(title)) return "Lunch";
  if (/dinner|supper/.test(title)) return "Dinner";
  if (/snack/.test(title)) return "Snack";
  return "Other";
}
export function caloriesByMeal(state, window) {
  const byDate = groupByDate(state.entries, window.dates);
  const used = new Set();
  const points = window.dates.map((d) => {
    const point = { date: d, label: window.dates.length <= 7 ? shortDay(d) : shortDate(d) };
    for (const e of byDate.get(d).filter((x) => x.type === "food")) {
      const meal = mealName(e);
      used.add(meal);
      point[meal] = round((point[meal] || 0) + sum(e.items, (i) => i.calories * i.servings));
    }
    return point;
  });
  const series = MEALS.filter((m) => used.has(m)).map((m, i) => ({
    key: m,
    label: m,
    color: `var(--chart-${i + 1})`,
  }));
  return { points, series };
}

export function estimatedItems(state, window) {
  const foods = entriesInRange(state, window.from, window.to, ["food"]);
  const items = foods.flatMap((e) => e.items);
  return { total: items.length, estimated: items.filter((i) => i.estimated).length };
}

export function setsByMuscle(state, window) {
  const stats = trainingStats(entriesInRange(state, window.from, window.to, ["workout"]));
  return MUSCLES.map((m) => ({ muscle: m, label: m.replaceAll("-", " "), sets: stats.muscles[m] }))
    .filter((m) => m.sets > 0)
    .sort((a, b) => b.sets - a.sets);
}

export function minutesBySong(state, window) {
  const sessions = entriesInRange(state, window.from, window.to, ["guitar"]);
  const map = new Map();
  for (const e of sessions) {
    const title = state.songs.find((s) => s.id === e.songId)?.title || "General practice";
    map.set(title, (map.get(title) || 0) + (Number(e.minutes) || 0));
  }
  return [...map.entries()]
    .map(([title, minutes]) => ({ title, minutes }))
    .sort((a, b) => b.minutes - a.minutes);
}

export function daysAtGoal(series) {
  if (!series.goal || series.bucket !== "day") return null;
  const logged = series.points.filter((p) => p.value !== null);
  const hit = logged.filter((p) =>
    series.lowerIsBetter ? p.value <= series.goal : p.value >= series.goal,
  ).length;
  return { hit, logged: logged.length };
}

// Compact per-day totals for the assistant's context (non-zero values only).
export function recentDays(state, today = dateKey(), count = 7) {
  const dates = listDates(shiftDate(today, -(count - 1)), today);
  const byDate = groupByDate(state.entries, dates);
  return dates
    .map((d) => {
      const list = byDate.get(d);
      if (!list.length) return null;
      const t = totals(list);
      const compact = Object.fromEntries(
        Object.entries(t)
          .filter(([, v]) => v)
          .map(([k, v]) => [k, round(v)]),
      );
      return { date: d, ...compact };
    })
    .filter(Boolean);
}

// Which Insights tab shows a metric (used by chat chart cards and the Insights page).
export const METRIC_TABS = {
  workouts: "training",
  workoutMinutes: "training",
  sets: "training",
  volume: "training",
  cardio: "training",
  calories: "nutrition",
  protein: "nutrition",
  carbs: "nutrition",
  fat: "nutrition",
  macros: "nutrition",
  steps: "steps",
  sleep: "sleep",
  screentime: "screen",
  pages: "reading",
  reading: "reading",
  guitar: "guitar",
  meditation: "mind",
  meditationQuality: "mind",
  dreams: "mind",
  habit: "habits",
}

// Which Insights tab shows a metric (used by chat chart cards).
export function tabForMetric(metric) {
  return METRIC_TABS[metric] || "training"
}
