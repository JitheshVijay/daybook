// Song practice scheduling with a spaced-repetition memory model.
//
// Each rated guitar session for a song is a review. The memory model is FSRS-5 (Free Spaced
// Repetition Scheduler, open-spaced-repetition) with its published default parameters:
//   retention after t days:  R(t) = (1 + 19/81 · t / S) ^ -0.5, so R = 90% when t = S
//   stability S (days) grows after a successful review, most when the song had begun to fade
//   and when the review went well; a failed review resets it lower.
//   difficulty D (1–10) rises after rough sessions and falls after clean ones.
// The defaults were fit on flashcard reviews, not instrument practice, so dates are a guide that
// sharpens as sessions are rated. A session without a rating counts as "Solid".
import { completed, dateKey, parseDate, shiftDate, sum } from "./domain.js";

export const TARGET_RETENTION = 0.9;
export const MODEL_NAME = "FSRS-5 spaced repetition (default parameters)";
export const RATINGS = [
  { value: 1, label: "Couldn't play it", hint: "Lost my place or couldn't get through it" },
  { value: 2, label: "Rough", hint: "Got through with lots of mistakes" },
  { value: 3, label: "Solid", hint: "A few mistakes" },
  { value: 4, label: "Clean", hint: "Clean at the tempo I wanted" },
];
export const ratingLabel = (value) => RATINGS.find((r) => r.value === value)?.label || "";
export const isRating = (value) => Number.isInteger(value) && value >= 1 && value <= 4;

const W = [0.40255, 1.18385, 3.173, 15.69105, 7.1949, 0.5345, 1.4604, 0.0046, 1.54575, 0.1192, 1.01925, 1.9395, 0.11, 0.29605, 2.2698, 0.2315, 2.9898, 0.51655, 0.6621];
const DECAY = -0.5;
const FACTOR = 19 / 81;
const MAX_STABILITY = 36500;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

export const retrievability = (elapsedDays, stability) => Math.pow(1 + (FACTOR * Math.max(0, elapsedDays)) / stability, DECAY);
const initStability = (g) => Math.max(W[g - 1], 0.1);
const initDifficulty = (g) => clamp(W[4] - Math.exp(W[5] * (g - 1)) + 1, 1, 10);
function nextDifficulty(d, g) {
  const delta = -W[6] * (g - 3);
  const damped = d + (delta * (10 - d)) / 9;
  return clamp(W[7] * initDifficulty(4) + (1 - W[7]) * damped, 1, 10);
}
const recallStability = (d, s, r, g) =>
  s * (1 + Math.exp(W[8]) * (11 - d) * Math.pow(s, -W[9]) * (Math.exp(W[10] * (1 - r)) - 1) * (g === 2 ? W[15] : 1) * (g === 4 ? W[16] : 1));
const forgetStability = (d, s, r) => Math.min(W[11] * Math.pow(d, -W[12]) * (Math.pow(s + 1, W[13]) - 1) * Math.exp(W[14] * (1 - r)), s / Math.exp(W[17] * W[18]));
const sameDayStability = (s, g) => s * Math.exp(W[17] * (g - 3 + W[18]));

export const daysBetween = (from, to) => Math.round((parseDate(to) - parseDate(from)) / 86400000);

/**
 * songMemory(sessions) → { stability, difficulty, lastDate, history } for sessions of one song.
 * sessions: guitar entries (date, time, quality); quality 1–4 is the rating, anything else "Solid".
 */
export function songMemory(sessions) {
  const ordered = sessions.slice().sort((a, b) => `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`));
  let stability = null;
  let difficulty = null;
  let lastDate = null;
  const history = [];
  for (const session of ordered) {
    const assumed = !isRating(session.quality);
    const grade = assumed ? 3 : session.quality;
    let retention = null;
    if (stability === null) {
      stability = initStability(grade);
      difficulty = initDifficulty(grade);
    } else {
      const elapsed = daysBetween(lastDate, session.date);
      retention = retrievability(elapsed, stability);
      stability =
        elapsed <= 0 ? sameDayStability(stability, grade) : grade === 1 ? forgetStability(difficulty, stability, retention) : recallStability(difficulty, stability, retention, grade);
      stability = clamp(stability, 0.1, MAX_STABILITY);
      difficulty = nextDifficulty(difficulty, grade);
    }
    lastDate = session.date;
    history.push({ id: session.id, date: session.date, grade, assumed, retention, stability, difficulty });
  }
  return { stability, difficulty, lastDate, history };
}

/**
 * songStats(state, today) → one row per song: sessions, minutes, last rating, estimated
 * retention today, memory stability, difficulty, and the next review date (when retention
 * falls to the 90% target).
 */
export function songStats(state, today = dateKey(), { beforeToday = false } = {}) {
  const sessions = completed(state.entries).filter((e) => e.type === "guitar" && e.songId && (beforeToday ? e.date < today : e.date <= today));
  return (state.songs || []).map((song, index) => {
    const own = sessions.filter((e) => e.songId === song.id);
    const rated = own.filter((e) => isRating(e.quality)).sort((a, b) => `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`));
    const base = { song, index, sessions: own.length, rated: rated.length, minutes: sum(own, (e) => e.minutes), lastRating: rated.at(-1)?.quality ?? null };
    if (!own.length) return { ...base, state: "new", lastDate: null, retention: null, stability: null, difficulty: null, dueDate: null, daysUntilDue: null, history: [] };
    const memory = songMemory(own);
    const elapsed = daysBetween(memory.lastDate, today);
    const interval = Math.max(1, Math.round(memory.stability));
    const dueDate = shiftDate(memory.lastDate, interval);
    const daysUntilDue = daysBetween(today, dueDate);
    return {
      ...base,
      state: daysUntilDue <= 0 ? "due" : "scheduled",
      lastDate: memory.lastDate,
      retention: retrievability(elapsed, memory.stability),
      stability: memory.stability,
      difficulty: memory.difficulty,
      dueDate,
      daysUntilDue,
      history: memory.history,
    };
  });
}

const STATUS_ORDER = { Learning: 0, "Can play slowly": 1, "Want to learn": 2, "Performance ready": 3 };
export const daysAgo = (date, today) => {
  const n = daysBetween(date, today);
  return n <= 0 ? "today" : n === 1 ? "yesterday" : `${n} days ago`;
};
export const dueLabel = (row) =>
  row.state === "new" ? "Not started" : row.daysUntilDue < 0 ? `Overdue ${-row.daysUntilDue} ${row.daysUntilDue === -1 ? "day" : "days"}` : row.daysUntilDue === 0 ? "Due today" : row.daysUntilDue === 1 ? "Due tomorrow" : `Due in ${row.daysUntilDue} days`;

function reasonFor(row, today) {
  if (row.state === "new") return row.song.status === "Want to learn" ? "On your list and not started yet. Start slowly." : "No practice logged yet. Start slowly.";
  const pct = Math.round(row.retention * 100);
  if (row.lastRating && row.lastRating <= 2) return `${ratingLabel(row.lastRating)} last time and estimated retention is down to ${pct}%. Go slower today.`;
  return `Estimated retention ${pct}%, below your 90% target. Last played ${daysAgo(row.lastDate, today)}.`;
}

/**
 * splitMinutes(total, weights) → whole minutes proportional to weights that add up to total,
 * with at least 5 per song whenever total allows it (largest remainders get the spare minutes).
 */
export function splitMinutes(total, weights) {
  if (!weights.length || total <= 0) return weights.map(() => 0);
  const floor = total >= 5 * weights.length ? 5 : 0;
  const spare = total - floor * weights.length;
  const usable = weights.some((w) => w > 0) ? weights.map((w) => Math.max(0, w)) : weights.map(() => 1);
  const weightSum = usable.reduce((a, w) => a + w, 0);
  const exact = usable.map((w) => (spare * w) / weightSum);
  const minutes = exact.map((x) => Math.floor(x));
  let left = spare - minutes.reduce((a, m) => a + m, 0);
  exact
    .map((x, i) => ({ i, frac: x - Math.floor(x) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i)
    .forEach(({ i }) => {
      if (left > 0) {
        minutes[i] += 1;
        left -= 1;
      }
    });
  return minutes.map((m) => m + floor);
}

/**
 * practicePlan(state, today) → { items, upcoming, stats, goalMinutes, doneMinutes, remainingMinutes, goalMet }
 * Today's songs, most at risk of being forgotten first: every song past its review date
 * (lowest estimated retention first), then one new song (two when nothing is due), up to one
 * song per 5 minutes of the daily guitar goal.
 *
 * The picks come from the state at the start of today, so logging a session doesn't reshuffle
 * the day: a practiced song stays on the plan marked done (a review moves its next due date out,
 * which would otherwise drop it and pull in new songs). Every guitar minute logged today counts
 * toward the goal; songs practiced off-plan are listed as extras. The remaining minutes are
 * split across the songs not yet practiced, weighted by difficulty. Once the goal is met the
 * rest of the plan is optional, since extra same-day reps add little long-term memory.
 */
export function practicePlan(state, today = dateKey(), { goalMinutes } = {}) {
  const goal = goalMinutes || state.profile?.guitarGoal || 20;
  const stats = songStats(state, today);
  const basis = songStats(state, today, { beforeToday: true });
  const maxSongs = clamp(Math.floor(goal / 5), 1, 5);
  const due = basis.filter((r) => r.state === "due").sort((a, b) => a.retention - b.retention || a.stability - b.stability);
  const fresh = basis
    .filter((r) => r.state === "new" && r.song.status !== "Performance ready")
    .sort((a, b) => STATUS_ORDER[a.song.status] - STATUS_ORDER[b.song.status] || String(a.song.added || "").localeCompare(String(b.song.added || "")) || a.index - b.index);
  const picks = due.slice(0, maxSongs).map((row) => ({ row, kind: row.lastRating && row.lastRating <= 2 ? "struggling" : "due" }));
  const newSlots = Math.max(0, Math.min(picks.length ? 1 : 2, maxSongs - picks.length));
  picks.push(...fresh.slice(0, newSlots).map((row) => ({ row, kind: "new" })));
  const weight = ({ row, kind }) => (kind === "new" ? 6 : row.difficulty) + (kind === "struggling" ? 2 : 0);

  const todaySessions = completed(state.entries).filter((e) => e.type === "guitar" && e.date === today);
  const doneMinutes = sum(todaySessions, (e) => e.minutes);
  const remainingMinutes = Math.max(0, goal - doneMinutes);
  const practiced = (songId) => todaySessions.filter((e) => e.songId === songId);
  const doneFields = (songId) => {
    const own = practiced(songId);
    const rated = own.filter((e) => isRating(e.quality));
    return {
      done: own.length > 0,
      minutesDone: sum(own, (e) => e.minutes),
      sections: [...new Set(own.map((e) => String(e.section || "").trim()).filter(Boolean))],
      ratingToday: rated.length ? rated.at(-1).quality : null,
    };
  };

  const planned = picks.map((pick) => ({
    songId: pick.row.song.id,
    title: pick.row.song.title,
    artist: pick.row.song.artist,
    kind: pick.kind,
    reason: reasonFor(pick.row, today),
    retention: pick.row.retention,
    weight: weight(pick),
    ...doneFields(pick.row.song.id),
  }));
  const plannedIds = new Set(planned.map((i) => i.songId));
  const extras = [...new Set(todaySessions.map((e) => e.songId).filter((id) => id && !plannedIds.has(id)))]
    .map((id) => (state.songs || []).find((s) => s.id === id))
    .filter(Boolean)
    .map((song) => ({ songId: song.id, title: song.title, artist: song.artist, kind: "extra", reason: "Practiced today, not on today’s plan.", retention: null, weight: 0, ...doneFields(song.id) }));

  const open = planned.filter((i) => !i.done);
  const fit = remainingMinutes > 0 ? clamp(Math.floor(remainingMinutes / 5), 1, open.length || 1) : 0;
  const active = open.slice(0, fit);
  const shares = splitMinutes(remainingMinutes, active.map((i) => i.weight));
  const items = [
    ...active.map((item, i) => ({ ...item, minutes: shares[i], optional: false })),
    ...open.slice(fit).map((item) => ({ ...item, minutes: 0, optional: true })),
    ...planned.filter((i) => i.done).map((item) => ({ ...item, minutes: item.minutesDone, optional: false })),
    ...extras.map((item) => ({ ...item, minutes: item.minutesDone, optional: false })),
  ].map(({ weight: _weight, ...item }) => item);

  const upcoming = stats
    .filter((r) => r.state === "scheduled")
    .sort((a, b) => a.daysUntilDue - b.daysUntilDue || a.retention - b.retention)
    .map((r) => ({ songId: r.song.id, title: r.song.title, artist: r.song.artist, dueDate: r.dueDate, daysUntilDue: r.daysUntilDue, retention: r.retention }));
  return { date: today, goalMinutes: goal, doneMinutes, remainingMinutes, goalMet: doneMinutes >= goal, items, upcoming, stats };
}

/** retentionForecast(row, today, days) → [{ date, value }] estimated retention (%) from today on. */
export function retentionForecast(row, today = dateKey(), days = 30) {
  if (!row?.stability) return [];
  return Array.from({ length: days + 1 }, (_, i) => {
    const date = shiftDate(today, i);
    return { date, value: Math.round(retrievability(daysBetween(row.lastDate, date), row.stability) * 1000) / 10 };
  });
}
