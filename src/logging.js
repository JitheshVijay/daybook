// How completely each day was logged, for the Journal's activity heatmap.
// A "full day" has an entry for every daily tracker the user counts (Settings → the heatmap's
// "Counts as a full day"). By default those are the daily kinds of tracking they actually use.
import { completed, dateKey, LABELS, shiftDate, TYPES } from "./domain.js";

export const DAILY_KINDS = ["food", "sleep", "steps", "screentime", "meditation", "habit"];
export const HEAT_LEVELS = 4;

export function dailyTrackers(state, today = dateKey()) {
  const chosen = state.profile?.dailyTrackers;
  if (Array.isArray(chosen) && chosen.length) return TYPES.filter((t) => chosen.includes(t));
  const from = shiftDate(today, -30);
  const used = new Set(completed(state.entries).filter((e) => e.date >= from && e.date <= today).map((e) => e.type));
  const picks = DAILY_KINDS.filter((t) => used.has(t));
  return picks.length ? picks : ["food", "sleep"];
}

/**
 * loggingDays(state, from, to, trackers) → one row per date:
 * { date, count, logged, missing, others, share, level }
 * level 0 nothing logged · 1 entries but under a third of the daily trackers · 2 a third or more ·
 * 3 two thirds or more · 4 every daily tracker logged (a full day). Planned entries don't count.
 */
export function loggingDays(state, from, to, trackers) {
  const byDate = new Map();
  for (const e of completed(state.entries)) {
    if (e.date < from || e.date > to) continue;
    if (!byDate.has(e.date)) byDate.set(e.date, new Set());
    byDate.get(e.date).add(e.type);
  }
  const days = [];
  for (let date = from; date <= to; date = shiftDate(date, 1)) {
    const types = byDate.get(date) || new Set();
    const logged = trackers.filter((t) => types.has(t));
    const missing = trackers.filter((t) => !types.has(t));
    const others = TYPES.filter((t) => types.has(t) && !trackers.includes(t));
    const share = trackers.length ? logged.length / trackers.length : 0;
    const level = !types.size ? 0 : share >= 1 ? 4 : share >= 2 / 3 ? 3 : share >= 1 / 3 ? 2 : 1;
    days.push({ date, count: types.size, logged, missing, others, share, level });
  }
  return days;
}

/** loggingSummary(days, today) → { fullDays, daysWithEntries, streak } — streak counts full days back from today (or yesterday while today is still open). */
export function loggingSummary(days, today = dateKey()) {
  const byDate = new Map(days.map((d) => [d.date, d]));
  let cursor = byDate.get(today)?.level === 4 ? today : shiftDate(today, -1);
  let streak = 0;
  while (byDate.get(cursor)?.level === 4) {
    streak++;
    cursor = shiftDate(cursor, -1);
  }
  return { fullDays: days.filter((d) => d.level === 4).length, daysWithEntries: days.filter((d) => d.count > 0).length, streak };
}

export const describeDay = (day) => {
  if (!day.count) return "Nothing logged";
  const parts = [`${day.logged.length} of ${day.logged.length + day.missing.length} daily trackers`];
  if (day.missing.length) parts.push(`missing ${day.missing.map((t) => LABELS[t].toLowerCase()).join(", ")}`);
  if (day.others.length) parts.push(`also ${day.others.map((t) => LABELS[t].toLowerCase()).join(", ")}`);
  return parts.join(" · ");
};
