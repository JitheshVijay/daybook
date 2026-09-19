// Executes assistant tool calls against the local store. Pure JS: no React, no network
// (except the optional cover lookup callback). Every failure becomes a tool result the
// model can read, so it asks the user instead of guessing; nothing is half-saved.
import {
  bookProgress,
  completed,
  dateKey,
  entryDetail,
  entryTitle,
  LABELS,
  num,
  parseDate,
  shiftDate,
  sum,
  upsertEntry,
  validateState,
} from "./domain.js";
import {
  assertSchema,
  draftIssues,
  applyImport,
  prepareImport,
  importCollision,
  PART_KEY,
  isPartComplete,
  partQuestions,
} from "./day-import.js";
import { TOOL_SCHEMAS } from "./chat-schema.js";
import { extractionSchema, findBook, findSong } from "./day-import.js";
import { BOOK_STATUSES, EXERCISES, GUITAR_RATINGS, SONG_STATUSES } from "./domain.js";
import { MODEL_NAME, TARGET_RETENTION, dueLabel, practicePlan as buildPracticePlan, ratingLabel } from "./practice.js";
import { applyEstimate, estimateNutrition, needsNutrition } from "./nutrition.js";
import { computeSeries, rangeDates, resolveChartRequest, RANGE_LABELS } from "./insights.js";
import { stableId } from "./grounding.js";

const nowTime = () => new Date().toTimeString().slice(0, 5);

function fail(message, hint = "Ask the user rather than guessing.") {
  return { result: { error: message, hint }, effects: { error: true } };
}

// Fields worth re-sending so the model can rebuild a pending entry.
function knownFields(raw) {
  return Object.fromEntries(
    Object.entries(raw).filter(
      ([k, v]) =>
        !["source", "questions", "resolves"].includes(k) &&
        v !== null &&
        v !== "" &&
        !(Array.isArray(v) && !v.length),
    ),
  );
}

export function summarizeEntry(entry, state) {
  let detail = "";
  try {
    detail = entryDetail(entry);
  } catch {
    detail = "";
  }
  return {
    id: entry.id,
    type: entry.type,
    date: entry.date,
    time: entry.time,
    status: entry.status,
    title: entryTitle(entry, state),
    detail,
    estimated: Boolean(entry.items?.some((i) => i.estimated)),
  };
}

const TYPE_FIELDS = {
  workout: ["title", "minutes", "exercises"],
  reading: ["pages", "chapters", "minutes"],
  food: ["title", "items"],
  guitar: ["minutes", "quality", "bpm", "section"],
  meditation: ["title", "minutes", "quality", "mood"],
  dream: ["title", "quality", "mood", "lucid"],
  screentime: ["minutes"],
  steps: ["steps"],
  cardio: ["title", "minutes", "distance"],
  habit: ["value", "unit"],
  sleep: ["minutes"],
};

// Exact editable values of a saved entry (no notes), so the model can correct it.
export function entryFields(entry, state) {
  const fields = {};
  for (const key of TYPE_FIELDS[entry.type] || []) {
    const value = entry[key];
    if (value === undefined || value === "" || (Array.isArray(value) && !value.length)) continue;
    fields[key] =
      key === "items"
        ? value.map(({ name, servings, calories, protein, carbs, fat, estimated }) => ({
            name,
            servings,
            calories,
            protein,
            carbs,
            fat,
            ...(estimated ? { estimated: true } : {}),
          }))
        : value;
  }
  if (entry.type === "reading") fields.bookTitle = state.books.find((b) => b.id === entry.bookId)?.title;
  if (entry.type === "guitar" && entry.songId) fields.songTitle = state.songs.find((s) => s.id === entry.songId)?.title;
  if (entry.type === "habit") fields.habitName = state.habits.find((h) => h.id === entry.habitId)?.name;
  return fields;
}

// A saved entry expressed in the tool's entry shape (the reverse of prepareImport).
function entryToRaw(entry, state) {
  const book = state.books.find((b) => b.id === entry.bookId);
  const song = state.songs.find((s) => s.id === entry.songId);
  const habit = state.habits.find((h) => h.id === entry.habitId);
  const numberOrNull = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  return {
    type: entry.type,
    date: entry.date,
    time: entry.time,
    endTime: null,
    fromPage: null,
    toPage: null,
    chaptersFinished: null,
    status: entry.status,
    title: entry.title || "",
    notes: (entry.notes || "")
      .split("\n")
      .filter((line) => !line.startsWith("Nutrition estimate:"))
      .join("\n"),
    source: "",
    questions: [],
    minutes: numberOrNull(entry.minutes),
    pages: numberOrNull(entry.pages),
    chapters: numberOrNull(entry.chapters),
    steps: numberOrNull(entry.steps),
    distance: numberOrNull(entry.distance),
    bpm: numberOrNull(entry.bpm),
    value: numberOrNull(entry.value),
    quality: ["meditation", "dream"].includes(entry.type) || (entry.type === "guitar" && Number.isInteger(entry.quality) && entry.quality >= 1 && entry.quality <= 4) ? numberOrNull(entry.quality) : null,
    mood: entry.mood || null,
    lucid: typeof entry.lucid === "boolean" ? entry.lucid : null,
    section: entry.section || null,
    bookTitle: book?.title || null,
    author: book?.author || null,
    totalPages: null,
    totalChapters: null,
    songTitle: song?.title || null,
    artist: song?.artist || null,
    habitName: habit?.name || null,
    unit: entry.unit || null,
    exercises: (entry.exercises || []).map((x) => ({
      name: x.name,
      muscle: x.muscle || null,
      sets: x.sets.map((s) => ({ weight: s.weight, reps: s.reps, done: s.done })),
    })),
    items: (entry.items || []).map((i) => ({
      name: i.name,
      servings: i.servings,
      calories: i.calories,
      protein: i.protein,
      carbs: i.carbs,
      fat: i.fat,
      estimated: Boolean(i.estimated),
      estimateNote: i.estimateNote || "",
    })),
  };
}

const MEAL_TIMES = [
  [/breakfast|brunch/i, "08:00"],
  [/lunch/i, "13:00"],
  [/dinner|supper/i, "19:00"],
];
function defaultTime(raw) {
  if (raw.time || raw.type !== "food") return raw.time;
  return MEAL_TIMES.find(([pattern]) => pattern.test(raw.title || ""))?.[1] ?? raw.time;
}

const capitalize = (text) =>
  typeof text === "string" && text ? text[0].toUpperCase() + text.slice(1).toLowerCase() : text;
const GENERIC_TITLES = /^(reading|read|guitar( practice)?|practice|habit)$/i;

// Repair common, unambiguous model slips before the app judges completeness.
export function tidyRaw(raw) {
  const tidy = { ...raw, time: defaultTime(raw), mood: capitalize(raw.mood) };
  const linked = tidy.type === "reading" ? tidy.bookTitle : tidy.type === "guitar" ? tidy.songTitle : tidy.type === "habit" ? tidy.habitName : null;
  if (linked || tidy.type === "reading" || tidy.type === "habit") {
    const title = (tidy.title || "").trim().toLowerCase();
    const name = (linked || "").trim().toLowerCase();
    const redundant = !title || GENERIC_TITLES.test(title) || (name && title.includes(name));
    if (redundant) tidy.title = "";
  }
  if (tidy.type === "food")
    tidy.items = (tidy.items || []).map((item) =>
      // An estimate priced for the whole described portion ("2 slices, ~160 kcal").
      item.estimated && item.servings === null && item.calories !== null
        ? { ...item, servings: 1 }
        : item,
    );
  return tidy;
}

const low = (v) => (typeof v === "string" ? v.trim().toLowerCase() : v ?? "");
// Identity of an activity independent of generated ids, for de-duplication within a turn.
export function activitySignature(raw, date) {
  const base = [raw.type, date, raw.status, raw.time || "", low(raw.bookTitle), low(raw.songTitle), low(raw.habitName)];
  const amounts = [raw.minutes, raw.pages, raw.chapters, raw.steps, raw.distance, raw.bpm, raw.value, raw.quality].map((v) => v ?? "");
  const exercises = (raw.exercises || []).map((x) => `${low(x.name)}:${x.sets.map((s) => `${s.weight}x${s.reps}`).join(",")}`);
  const items = (raw.items || []).map((i) => `${low(i.name)}:${i.servings ?? ""}`);
  return JSON.stringify([...base, ...amounts, exercises, items, raw.type === "food" || raw.type === "workout" || raw.type === "cardio" ? low(raw.title) : ""]);
}
// Identity of a still-incomplete activity: what it is, not the details still missing.
function pendingSignature(raw, date) {
  const name = low(raw.bookTitle) || low(raw.songTitle) || low(raw.habitName) || low(raw.title) || (raw.items || []).map((i) => low(i.name)).join("+");
  return JSON.stringify([raw.type, date, raw.status, name]);
}
const blankValue = (v) => v === "" || v === null || v === undefined;
const VAGUE_AMOUNT = /\b(some|a bit|a little|a few|snacks?|stuff|things|leftovers|a lot)\b/i;

// "Deadlifts" and "deadlift" name the same exercise.
const nameKey = (v) => low(v).replace(/[^a-z0-9]/g, "").replace(/e?s$/, "");
const GENERIC_WORKOUT_TITLE = /^(workout|gym|gym session|training|exercise|session|strength( training)?)$/i;

// Join parts with the same name (e.g. two "Leg press" rows) and append the rest.
function mergeParts(type, base, extra, { replace = false } = {}) {
  const out = base.map((p) => ({ ...p }));
  for (const part of extra) {
    const key = nameKey(part.name);
    const at = out.findIndex((p) => nameKey(p.name) === key);
    if (at < 0) out.push({ ...part });
    else if (replace) out[at] = { ...part };
    else if (type === "workout")
      out[at] =
        JSON.stringify(out[at].sets) === JSON.stringify(part.sets)
          ? { ...out[at], muscle: out[at].muscle || part.muscle } // an identical copy, not more sets
          : { ...out[at], muscle: out[at].muscle || part.muscle, sets: [...out[at].sets, ...part.sets] };
    else out[at] = { ...part };
  }
  return out;
}

// Repair how models commonly shape a gym session before the app judges it:
// exercises smuggled into a cardio entry become a workout, and several workout
// entries for the same session (one per exercise) become one workout.
const FUTURE_INTENT = /\b(will|going to|gonna|plan|plans|planning|planned|tomorrow|tonight|later|next|upcoming|schedule|scheduled|want to|intend|this evening)\b|['’]ll\b/i;
// A past-tense report is not a plan, whatever status the model picked.
function fixStatus(raw, logDate) {
  if (raw.status !== "planned") return raw;
  const notFuture = !raw.date || (/^\d{4}-\d{2}-\d{2}$/.test(raw.date) && (!logDate || raw.date <= logDate));
  return notFuture && !FUTURE_INTENT.test(raw.source || "") ? { ...raw, status: "done" } : raw;
}

export function normalizeEntries(entries, logDate) {
  const expanded = [];
  for (const entry of entries) {
    const { resolves = null, ...given } = entry;
    const raw = fixStatus(given, logDate);
    if (raw.type !== "workout" && raw.exercises?.length) {
      const moved = raw.exercises.filter((x) => x.sets?.length && low(x.name) !== low(raw.type) && low(x.name) !== low(raw.title));
      if (moved.length)
        expanded.push({
          resolves: null,
          raw: { ...raw, type: "workout", title: "", notes: "", minutes: null, distance: null, items: [], exercises: moved },
        });
      expanded.push({ resolves, raw: { ...raw, exercises: [] } });
    } else expanded.push({ resolves, raw: { ...raw } });
  }
  const merged = [];
  for (const item of expanded) {
    const { raw } = item;
    const target =
      raw.type === "workout" &&
      !item.resolves &&
      merged.find(
        (m) =>
          m.raw.type === "workout" &&
          !m.resolves &&
          (m.raw.date ?? null) === (raw.date ?? null) &&
          m.raw.status === raw.status &&
          (!m.raw.time || !raw.time || m.raw.time === raw.time),
      );
    if (!target) {
      merged.push({ resolves: item.resolves, raw: { ...raw, exercises: [...(raw.exercises || [])] }, count: 1 });
      continue;
    }
    const t = target.raw;
    const names = new Set([...t.exercises, ...raw.exercises].map((x) => nameKey(x.name)));
    const titleOf = (r) => (r.title && !names.has(nameKey(r.title)) && !GENERIC_WORKOUT_TITLE.test(r.title.trim()) ? r.title : "");
    t.title = titleOf(t) || titleOf(raw) || "";
    t.exercises = mergeParts("workout", t.exercises, raw.exercises);
    t.minutes = t.minutes !== null && raw.minutes !== null ? t.minutes + raw.minutes : (t.minutes ?? raw.minutes);
    t.time = t.time || raw.time;
    t.notes = [t.notes, raw.notes].filter(Boolean).join("\n");
    t.source = [t.source, raw.source].filter(Boolean).join(" … ").slice(0, 2000);
    target.count += 1;
  }
  for (const m of merged)
    if (m.raw.type === "workout" && m.count > 1 && m.raw.exercises.some((x) => nameKey(x.name) === nameKey(m.raw.title))) m.raw.title = "";
  return merged.map(({ resolves, raw }) => ({ resolves, raw }));
}

function pendingTitle(p) {
  return p.known?.bookTitle || p.known?.songTitle || p.known?.habitName || p.known?.title || LABELS[p.type];
}
const GENERIC_MEAL = /^(food|foods|meal|meals|today|)$/i;
// Bump when completeness rules change; waiting items from older rules are re-checked on load.
export const RULES_VERSION = 3;
const FILLER_WORDS = new Set(["set", "sets", "rep", "reps", "with", "and", "the", "fried", "boiled", "machine", "cable", "dumbbell", "barbell"]);
const AMOUNT_HINT = /\d|\b(a|an|one|two|three|half|cup|cups|bowl|plate|piece|pieces|slice|slices|glass|medium|small|large|big|handful|spoon|grams?|kg)\b/i;
const stem = (word) => word.replace(/e?s$/, "");
// Does the user's message mention this exercise or food (plural-insensitive)?
export function mentions(text, name) {
  const words = new Set((String(text).toLowerCase().match(/[a-z0-9]+/g) || []).map(stem));
  const wanted = (String(name).toLowerCase().match(/[a-z0-9]+/g) || []).filter((w) => w.length > 2 && !FILLER_WORDS.has(w));
  return wanted.length > 0 && wanted.every((w) => words.has(stem(w)));
}

const WORD_NUMBERS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90, hundred: 100, dozen: 12 };
export function numbersIn(text) {
  const out = [];
  for (const [token] of String(text || "").toLowerCase().matchAll(/\d+(?:\.\d+)?|[a-z]+/g)) {
    if (/^\d/.test(token)) out.push(Number(token));
    else if (WORD_NUMBERS[token] !== undefined) out.push(WORD_NUMBERS[token]);
  }
  return out;
}
const SHARED_ANSWER = /\b(same|both|ditto|as well|too)\b/i;
const wordsOf = (text) => (String(text || "").toLowerCase().match(/[a-z0-9]+/g) || []).map(stem);
// Is this exercise or food named in the clause? Its full name, or a long word only it has
// ("abduction" for Hip abduction). A longer name wins: "Romanian deadlift" is not "Deadlift".
function editDistance(a, b) {
  if (Math.abs(a.length - b.length) > 2) return 3;
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) row[j] = Math.min(previous[j] + 1, row[j - 1] + 1, previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    previous = row;
  }
  return previous[b.length];
}
// Every word of the name is in the clause, allowing a typo in long words ("deadlisfts",
// "extention") unless the typed word is exactly a word of another exercise ("abduction" is
// never read as "adduction").
const EXERCISE_WORDS = new Set([...EXERCISES.map((e) => e.name), "abduction adduction extension flexion rotation raise press row fly pulldown pushdown"].flatMap(wordsOf));
function mentionsLoose(clause, name, names) {
  const have = wordsOf(clause);
  // A typed word that is itself a real exercise word is never a typo for another one.
  const otherWords = new Set([...names.filter((n) => nameKey(n) !== nameKey(name)).flatMap(wordsOf), ...EXERCISE_WORDS]);
  const wanted = wordsOf(name).filter((w) => w.length > 2 && !FILLER_WORDS.has(w));
  return (
    wanted.length > 0 &&
    wanted.every((w) => have.includes(w) || (w.length >= 6 && have.some((h) => !otherWords.has(h) && !wanted.includes(h) && editDistance(h, w) <= (w.length >= 9 ? 2 : 1))))
  );
}
function namedIn(clause, names) {
  const have = new Set(wordsOf(clause));
  const hit = names.filter((name) => {
    if (mentions(clause, name) || mentionsLoose(clause, name, names)) return true;
    const others = names.filter((n) => nameKey(n) !== nameKey(name)).map(wordsOf);
    return wordsOf(name).some((w) => w.length >= 5 && !FILLER_WORDS.has(w) && have.has(w) && others.every((o) => !o.includes(w)));
  });
  return hit.filter((n) => !hit.some((m) => nameKey(m) !== nameKey(n) && wordsOf(m).length > wordsOf(n).length && wordsOf(n).every((w) => wordsOf(m).includes(w))));
}
/**
 * numbersForPart(text, name, names) → the numbers in the user's words that belong to this
 * exercise or food. The message is read clause by clause (lines, sentences, ", word"):
 * numbers go to the parts named in their clause, or to the part named just before.
 * "same"/"both" also shares the numbers of the part named before. A part the message
 * doesn't name gets the numbers written before any name, or every number when the
 * message names nothing at all.
 */
export function numbersForPart(text, name, names = []) {
  const all = [...new Map([name, ...names].filter(Boolean).map((n) => [nameKey(n), n])).values()];
  const key = nameKey(name);
  const clauses = String(text || "")
    .split(/\n|[.?!;](?=\s|$)|,(?=\s*[a-z])/i)
    .map((clause) => ({ nums: numbersIn(clause), named: namedIn(clause, all), shared: SHARED_ANSWER.test(clause) }));
  if (!clauses.some((c) => c.named.length)) return numbersIn(text);
  const named = clauses.some((c) => c.named.some((n) => nameKey(n) === key));
  const mine = [];
  const leading = [];
  let current = [];
  let lastNamed = [];
  let previous = [];
  for (const c of clauses) {
    if (c.named.length) {
      previous = lastNamed;
      current = c.named;
      lastNamed = [...c.nums];
    } else if (current.length) lastNamed.push(...c.nums);
    else leading.push(...c.nums);
    if (current.some((n) => nameKey(n) === key)) {
      mine.push(...c.nums);
      if (c.named.length && c.shared) mine.push(...previous);
    }
  }
  return named ? mine : leading;
}
const CLAUSE_SPLIT = /\n|[.?!;](?=\s|$)|,(?=\s*[a-z])/i;
// The clauses of the message about this part: its named clauses and the unnamed ones after them.
export function clausesForPart(text, name, names = []) {
  const all = [...new Map([name, ...names].filter(Boolean).map((n) => [nameKey(n), n])).values()];
  const key = nameKey(name);
  let current = [];
  const mine = [];
  for (const clause of String(text || "").split(CLAUSE_SPLIT)) {
    const named = namedIn(clause, all);
    if (named.length) current = named;
    if (current.some((n) => nameKey(n) === key)) mine.push(clause);
  }
  return mine;
}

const COUNT_WORDS = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6 };
const KG = "(?:kg|kgs|kilos?|kilograms?)";
const AMOUNT = "(\\d+(?:\\.\\d+)?)";
const CHANGE = new RegExp(
  `\\b(added|add|adding|put on|plus|increased by|went up by|removed|took off|dropped|minus|reduced by|lowered by)\\s+(?:another\\s+)?(?:(\\d+|a|an|one|two|three|four|five|six)\\s*(?:more\\s*)?(?:x\\s*)?plates?\\s*(?:of\\s*)?${AMOUNT}\\s*${KG}?|${AMOUNT}\\s*${KG}(?:\\s*plates?)?)(\\s*(?:on\\s*)?(?:each|per)\\s*side)?`,
  "gi",
);
const ABSOLUTE = new RegExp(`${AMOUNT}\\s*${KG}\\b`, "gi");
/**
 * statedWeights(text, name, names) → { progression, single }
 * progression: set-by-set weights when the user builds on a first weight ("1st set of 40 kg, 2nd
 * I added 2 plates 15kg, …" → 40, 70, 90). "Added 2 plates 15kg" is two 15 kg plates (+30 kg);
 * "each side" doubles it. single: the one weight stated for the exercise ("with 60kg").
 */
export function statedWeights(text, name, names = []) {
  const said = clausesForPart(text, name, names).join(" . ");
  if (!said || !mentionsLoose(String(text), name, names) && !namedIn(String(text), [name, ...names]).some((n) => nameKey(n) === nameKey(name))) return { progression: null, single: null };
  const changes = [...said.matchAll(CHANGE)].map((m) => {
    const count = m[2] === undefined ? 1 : /^\d/.test(m[2]) ? Number(m[2]) : COUNT_WORDS[m[2].toLowerCase()];
    const each = Number(m[3] ?? m[4]);
    const sign = /removed|took off|dropped|minus|reduced|lowered/i.test(m[1]) ? -1 : 1;
    return { index: m.index, end: m.index + m[0].length, delta: sign * count * each * (m[5] ? 2 : 1) };
  });
  const absolutes = [...said.matchAll(ABSOLUTE)].filter((m) => !changes.some((c) => m.index >= c.index && m.index < c.end)).map((m) => ({ index: m.index, value: Number(m[1]) }));
  if (changes.length) {
    const base = absolutes.find((a) => a.index < changes[0].index);
    if (!base) return { progression: null, single: null };
    const progression = [base.value];
    for (const change of changes) {
      if (absolutes.some((a) => a.index > base.index && a.index < change.index)) break; // a new absolute weight: not a simple build-up
      progression.push(Math.round((progression.at(-1) + change.delta) * 100) / 100);
    }
    return { progression: progression.length >= 2 && progression.every((w) => w > 0) ? progression : null, single: null };
  }
  // "40, 70, 90 and 100 kg" lists several weights with one unit: not a single weight.
  const listed = absolutes.some((a) => /\d+(?:\.\d+)?\s*(?:kg\s*)?(?:,|\band\b|\/|\bthen\b)\s*$/i.test(said.slice(Math.max(0, a.index - 40), a.index)));
  const distinct = [...new Set(absolutes.map((a) => a.value))];
  return { progression: null, single: !listed && distinct.length === 1 ? distinct[0] : null };
}

const SET_COUNT = /\b(\d+|two|three|four|five|six|seven|eight|nine|ten)\s+sets?\b/gi;
// "leg press of 4 sets" → 4, when the exercise's clauses state one set count.
export function statedSetCount(text, name, names = []) {
  const said = clausesForPart(text, name, names).join(" . ");
  const counts = [...new Set([...said.matchAll(SET_COUNT)].map((m) => (/^\d/.test(m[1]) ? Number(m[1]) : WORD_NUMBERS[m[1].toLowerCase()])))];
  return counts.length === 1 && counts[0] > 0 ? counts[0] : null;
}
const MORE_SETS = /\b(more|extra|another|additional|added)\s+(\d+\s+)?sets?\b|\b\d+\s+more\b/i;
// Drop later sets that repeat an earlier one exactly until the exercise has `target` sets.
export function dropRepeatedSets(sets, target) {
  const out = sets.slice();
  for (let i = out.length - 1; i > 0 && out.length > target; i--) {
    const set = out[i];
    if (out.slice(0, i).some((x) => sameNumber(x.weight, set.weight) && sameNumber(x.reps, set.reps))) out.splice(i, 1);
  }
  return out;
}

/**
 * applyStatedWeights(exercises, ctx) → { exercises, computed }
 * Weights the user described set by set are worked out by the app instead of the model, and a
 * single stated weight fills sets the model left without one.
 */
export function applyStatedWeights(exercises, ctx) {
  const latest = ctx.latestUserText;
  if (typeof latest !== "string" || !latest.trim() || !Array.isArray(exercises)) return { exercises, computed: [] };
  const names = exercises.map((x) => x.name).filter(Boolean);
  const computed = [];
  const next = exercises.map((given) => {
    let exercise = given;
    const { progression, single } = statedWeights(latest, exercise.name, names);
    const count = statedSetCount(latest, exercise.name, names) || progression?.length || null;
    let sets = exercise.sets || [];
    // The model sometimes repeats sets ("4 sets" arriving as 6): extra exact repeats go.
    if (count && sets.length > count) {
      const trimmed = dropRepeatedSets(sets, count);
      if (trimmed.length !== sets.length) {
        computed.push(`${exercise.name}: ${count} sets`);
        sets = trimmed;
        exercise = { ...exercise, sets };
      }
    }
    const unweighted = sets.every((set) => set.weight === null || set.weight === undefined || set.weight === "");
    if (progression && (sets.length === progression.length || (sets.length < progression.length && unweighted))) {
      const rebuilt = progression.map((weight, i) => ({ weight, reps: sets[i]?.reps ?? (sets.length === 1 ? sets[0].reps : null) ?? null, done: sets[i]?.done ?? true }));
      const same = sets.length === rebuilt.length && sets.every((set, i) => sameNumber(set.weight, rebuilt[i].weight));
      if (same) return exercise;
      computed.push(`${exercise.name}: ${progression.join(", ")} kg`);
      return { ...exercise, sets: rebuilt };
    }
    if (single !== null && sets.some((set) => set.weight === null || set.weight === undefined || set.weight === "")) {
      computed.push(`${exercise.name}: ${single} kg`);
      return { ...exercise, sets: sets.map((set) => (set.weight === null || set.weight === undefined || set.weight === "" ? { ...set, weight: single } : set)) };
    }
    return exercise;
  });
  return { exercises: next, computed };
}
const sameNumber = (a, b) => Math.abs(Number(a) - Number(b)) < 0.01;
const isAmount = (v) => typeof v === "number" && Number.isFinite(v) && v > 0;

/**
 * groundExercises(exercises, ctx, pending) → { exercises, dropped }
 * Reps and weights must come from the user. For an exercise the app is waiting on, the
 * number must be in the part of the latest message about that exercise (or already known
 * from earlier); for anything else, anywhere in the user's recent messages. Other values
 * were made up by the model: they are cleared so the app asks instead of saving a guess.
 */
export function groundExercises(exercises, ctx, pending = [], { saved = [] } = {}) {
  const latest = ctx.latestUserText;
  if (typeof latest !== "string" || !latest.trim() || !Array.isArray(exercises)) return { exercises, dropped: [] };
  const waitingParts = pending.filter((p) => p.type === "workout").flatMap((p) => p.draft?.entry?.exercises || []);
  const names = [...exercises.map((x) => x.name), ...waitingParts.map((x) => x.name)].filter(Boolean);
  const recent = ctx.userText || latest;
  const pounds = /\b(lb|lbs|pounds?)\b/i.test(recent);
  const dropped = [];
  const grounded = exercises.map((exercise) => {
    const known = waitingParts.filter((p) => nameKey(p.name) === nameKey(exercise.name));
    const knownSets = known.flatMap((p) => p.sets || []);
    const savedSets = saved.filter((p) => nameKey(p.name) === nameKey(exercise.name)).flatMap((p) => p.sets || []);
    const stated = statedWeights(latest, exercise.name, names);
    const said = [...(known.length ? numbersForPart(latest, exercise.name, names) : numbersIn(recent)), ...(stated.progression || []), ...(stated.single !== null ? [stated.single] : [])];
    const fromUser = (value, field, index) =>
      !isAmount(value) ||
      knownSets.some((set) => sameNumber(set[field], value)) ||
      (savedSets[index] && sameNumber(savedSets[index][field], value)) ||
      said.some((n) => sameNumber(n, value) || (field === "weight" && pounds && Math.abs(n * 0.4536 - value) <= 1));
    let changed = false;
    let reverted = false;
    const sets = (exercise.sets || []).map((set, index) => {
      const next = { ...set };
      for (const field of ["reps", "weight"])
        if (!fromUser(set[field], field, index)) {
          if (isAmount(savedSets[index]?.[field])) {
            next[field] = savedSets[index][field]; // a correction the user didn't make
            reverted = true;
          } else {
            next[field] = null;
            changed = true;
          }
        }
      return next;
    });
    if (changed && !dropped.includes(exercise.name)) dropped.push(exercise.name);
    return changed || reverted ? { ...exercise, sets } : exercise;
  });
  return { exercises: grounded, dropped };
}

const WEEKDAY_NAMES = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const EXPLICIT_DATE = /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\b|\b\d{1,2}(st|nd|rd|th)\b|\b\d{4}-\d{2}-\d{2}\b|\b\d{1,2}\/\d{1,2}\b/i;
/**
 * statedDay(text, today, now) → the one day a message names with a relative word, or null.
 * "Yesterday", "today", "last night" and weekday names count from the real date (until 4 am,
 * the day that just ended), never from the date picked in the composer. A message with an
 * explicit date, "tomorrow", or several different days is left to the model.
 */
export function statedDay(text, today, now = "") {
  const words = low(text);
  if (!words || EXPLICIT_DATE.test(words) || /\b(tomorrow|next|later|ago)\b/.test(words)) return null;
  const base = now && now < "04:00" ? shiftDate(today, -1) : today;
  const days = new Set();
  const lateNight = Boolean(now && now < "04:00");
  if (/\bday before yesterday\b/.test(words)) days.add(shiftDate(base, -2));
  else if (/\byesterday\b/.test(words)) days.add(shiftDate(base, -1));
  if (/\blast night\b/.test(words)) days.add(lateNight ? base : shiftDate(base, -1)); // at 1 am, "last night" is the evening that just ended
  if (/\btoday\b|\btonight\b|\bthis (morning|afternoon|evening)\b/.test(words)) days.add(base);
  const weekday = parseDate(base).getDay();
  for (const [index, name] of WEEKDAY_NAMES.entries()) {
    const match = words.match(new RegExp(`\\b(last\\s+)?${name}\\b`));
    if (!match) continue;
    let back = (weekday - index + 7) % 7;
    if (match[1] && back === 0) back = 7;
    days.add(shiftDate(base, -back));
  }
  return days.size === 1 ? [...days][0] : null;
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
/** dayFromPhrase("September 12th" | "the 12th" | "sept 12" | "yesterday" | "saturday", today, now) → YYYY-MM-DD or null */
export function dayFromPhrase(phrase, today, now = "") {
  const words = low(phrase);
  const month = words.match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b/);
  const day = words.match(/\b(\d{1,2})(st|nd|rd|th)?\b/);
  if (day) {
    const n = Number(day[1]);
    if (n < 1 || n > 31) return null;
    const base = parseDate(today);
    let year = base.getFullYear();
    let m = month ? MONTHS.indexOf(month[1]) : base.getMonth();
    if (!month && n > base.getDate()) m -= 1; // "the 28th" said on the 14th is last month
    if (m < 0) {
      m += 12;
      year -= 1;
    }
    let candidate = new Date(year, m, n, 12);
    if (candidate.getMonth() !== m) return null;
    if (month && dateKey(candidate) > today) candidate = new Date(year - 1, m, n, 12);
    return dateKey(candidate);
  }
  const cleaned = words.replace(EXPLICIT_DATE, "");
  return statedDay(cleaned, today, now);
}
/** moveRequest(text, today, now) → { from, to } when the message asks to move something between days. */
export function moveRequest(text, today, now = "") {
  const match = low(text).match(/\b(move|moved|shift|put|change)\b(.*?)\bfrom\b(.+?)\bto\b(.+)$/);
  if (!match) return null;
  const from = dayFromPhrase(match[3], today, now);
  const to = dayFromPhrase(match[4], today, now);
  return from && to && from !== to ? { from, to } : null;
}

/**
 * readingFromPosition(raw, state, { excludeId }) → { raw, bookStart }
 * People say where they are in a book ("till page 51", "from page 29 to 40", "finished 11
 * chapters"); the app stores how much each session read on top of the book's starting point.
 * The session's pages and chapters are worked out from the book's progress before it, and the
 * starting point moves when the stated position shows reading the app didn't know about (or
 * less than it recorded), so the book ends up exactly where the user said.
 */
export function readingFromPosition(raw, state, { excludeId = null } = {}) {
  const stated = (v) => typeof v === "number" && Number.isFinite(v);
  if (raw.type !== "reading" || !raw.bookTitle || (!stated(raw.toPage) && !stated(raw.chaptersFinished))) return { raw, bookStart: null };
  const book = findBook(state.books, raw.bookTitle, raw.author);
  const sessions = book ? completed(state.entries).filter((e) => e.type === "reading" && e.bookId === book.id && e.id !== excludeId) : [];
  const startPages = num(book?.startPages);
  const startChapters = num(book?.startChapters);
  const next = { ...raw, fromPage: null, toPage: null, chaptersFinished: null };
  const bookStart = {};
  if (stated(raw.toPage)) {
    const before = startPages + sum(sessions, (e) => e.pages);
    if (stated(raw.fromPage) && raw.fromPage >= 1 && raw.toPage >= raw.fromPage) {
      next.pages = raw.toPage - raw.fromPage + 1; // both pages count: 29 to 40 is 12 pages
      if (before !== raw.fromPage - 1) bookStart.startPages = Math.max(0, startPages + (raw.fromPage - 1 - before));
    } else if (raw.toPage >= before) next.pages = raw.toPage - before;
    else {
      next.pages = 0;
      bookStart.startPages = Math.max(0, startPages - (before - raw.toPage));
    }
  }
  if (stated(raw.chaptersFinished)) {
    const before = startChapters + sum(sessions, (e) => e.chapters);
    if (raw.chaptersFinished >= before) next.chapters = raw.chaptersFinished - before;
    else {
      next.chapters = 0;
      bookStart.startChapters = Math.max(0, startChapters - (before - raw.chaptersFinished));
    }
  }
  return { raw: next, bookStart: Object.keys(bookStart).length ? bookStart : null };
}
// Apply starting-point changes to the book a session belongs to; returns the books as they were.
function moveBookStart(state, bookId, bookStart) {
  const book = state.books.find((b) => b.id === bookId);
  if (!book || !bookStart) return { state, before: [] };
  return { state: { ...state, books: state.books.map((b) => (b.id === bookId ? { ...b, ...bookStart } : b)) }, before: [book] };
}

// A workout or meal already saved for the same day that new parts should join:
// one logged earlier in this message, or one that is still waiting for details.
const CORRECTION_CUE = /\b(i meant|meaning|not (on )?(the )?(\d{1,2}(st|nd|rd|th)?|yesterday|today|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b|instead of|wrong (day|date)|should (be|have been) (on )?(the )?\d)/i;
const MORE_OF = /\b(one more|another|extra|more|again|second|additional|also had)\b/i;
function autoAttachTarget(entry, state, turnTargets, pending, { overlap = true } = {}) {
  const sameMeal = (a, b) => GENERIC_MEAL.test((a || "").trim()) || GENERIC_MEAL.test((b || "").trim()) || nameKey(a) === nameKey(b);
  const fits = (target) =>
    target &&
    target.type === entry.type &&
    target.date === entry.date &&
    target.status === entry.status &&
    (entry.type !== "food" || sameMeal(target.title, entry.title));
  for (const t of turnTargets) {
    const target = state.entries.find((e) => e.id === t.id);
    if (fits(target)) return target.id;
  }
  for (const p of pending) {
    if (!p.attachTo) continue;
    const target = state.entries.find((e) => e.id === p.attachTo);
    if (fits(target)) return target.id;
  }
  // A re-sent session: any saved workout or meal that day sharing an exercise or food.
  if (!overlap) return null;
  const key = PART_KEY[entry.type];
  const names = new Set((entry[key] || []).map((p) => nameKey(p.name)));
  const overlapping = state.entries.filter((e) => fits(e) && (e[key] || []).some((p) => names.has(nameKey(p.name))));
  overlapping.sort((a, b) => (b[key] || []).length - (a[key] || []).length);
  return overlapping[0]?.id || null;
}

// The amounts that identify an activity; details like distance or mood may be filled in differently.
const PRIMARY_FIELDS = {
  cardio: ["minutes"],
  reading: ["bookId", "pages", "chapters"],
  guitar: ["songId", "minutes"],
  meditation: ["minutes"],
  sleep: ["minutes"],
  steps: ["steps"],
  screentime: ["minutes"],
  habit: ["habitId", "value"],
  dream: ["notes"],
};
function alreadySaved(entry, raw, state, { repeatedMessage = false } = {}) {
  if (PART_KEY[entry.type]) return false;
  const words = (t) => new Set((low(t).match(/[a-z]+/g) || []).map((w) => w.replace(/e?s$/, "")));
  const generic = (t) => !t || nameKey(t) === nameKey(LABELS[entry.type]) || [...words(t)].some((w) => words(LABELS[entry.type]).has(w));
  const sameTitle = (a, b) => generic(a) || generic(b) || nameKey(a) === nameKey(b);
  const same = (a, b) => (a === "" || a === undefined || a === null ? 0 : a) === (b === "" || b === undefined || b === null ? 0 : b);
  return state.entries.some(
    (e) =>
      e.type === entry.type &&
      e.date === entry.date &&
      e.status === entry.status &&
      (!raw.time || e.time === entry.time) &&
      sameTitle(e.title, entry.title) &&
      // Resending the same message: an activity of that kind already saved that day is the same one.
      (repeatedMessage || (PRIMARY_FIELDS[entry.type] || []).every((k) => same(e[k], entry[k]))),
  );
}

function logEntries(args, ctx) {
  const { state, commit, today, turnId, callId, pending = [] } = ctx;
  const logDate = ctx.logDate || today;
  const batchId = stableId(`${today}|${turnId}|${callId}`);
  const turnTargets = ctx.turnTargets || [];
  const turnSeen = ctx.turnSignatures || new Set();
  let normalized = normalizeEntries(args.entries, logDate);
  const skippedOutOfScope = ctx.allowTypes ? normalized.filter((n) => !ctx.allowTypes.includes(n.raw.type)).length : 0;
  if (ctx.allowTypes) normalized = normalized.filter((n) => ctx.allowTypes.includes(n.raw.type));
  if (!normalized.length)
    return skippedOutOfScope
      ? { result: { logged: [], needsDetails: [], note: `Only ${ctx.allowTypes.join(", ")} entries were accepted in this step; the other activities are already logged.` }, effects: {} }
      : fail("No entries were provided.", "Ask what the user did.");
  const notFromUser = [];
  const weightsComputed = [];
  normalized = normalized.map((n) => {
    if (n.raw.type !== "workout") return n;
    const stated = applyStatedWeights(n.raw.exercises, ctx);
    weightsComputed.push(...stated.computed);
    const { exercises, dropped } = groundExercises(stated.exercises, ctx, pending);
    notFromUser.push(...dropped.filter((name) => !notFromUser.some((x) => nameKey(x) === nameKey(name))));
    return dropped.length || stated.computed.length ? { ...n, raw: { ...n.raw, exercises } } : n;
  });
  normalized = normalized.map((n) => {
    if (n.raw.type !== "food") return n;
    const amounts = weightsAsAmounts(n.raw.items, `${n.raw.source || ""}\n${ctx.latestUserText || ""}`);
    return amounts.changed ? { ...n, raw: { ...n.raw, items: amounts.items } } : n;
  });
  // A day the user named ("yesterday") counts from the real date, not the composer's date.
  const redated = [];
  normalized = normalized.map((n) => {
    const day = statedDay(n.raw.source, today, ctx.now) || statedDay(ctx.latestUserText, today, ctx.now);
    if (!day || n.raw.status === "planned" || n.raw.date === day || (!n.raw.date && logDate === day)) return n;
    redated.push(day);
    return { ...n, raw: { ...n.raw, date: day } };
  });
  // "I meant the 13th, not the 12th": something just logged on the wrong day is moved, not logged again.
  const moves = [];
  const said = ctx.latestUserText || "";
  const asked = moveRequest(said, today, ctx.now);
  if (asked || (CORRECTION_CUE.test(said) && ctx.recentLoggedIds?.length)) {
    normalized = normalized.filter((n) => {
      const target = asked ? asked.to : n.raw.date || logDate;
      const described = [n.raw.title, n.raw.bookTitle, n.raw.songTitle, n.raw.habitName, ...(n.raw.items || []).map((i) => i.name), ...(n.raw.exercises || []).map((x) => x.name)].filter(Boolean).join(" ") || LABELS[n.raw.type];
      const candidates = state.entries.filter(
        (e) =>
          e.type === n.raw.type &&
          e.status === "done" &&
          e.date !== target &&
          (asked ? e.date === asked.from && namesEntry(said, e, state) : ctx.recentLoggedIds.includes(e.id) && namesEntry(described, e, state)),
      );
      if (candidates.length !== 1 || moves.some((m) => m.entry.id === candidates[0].id)) return true;
      moves.push({ entry: candidates[0], date: target });
      return false;
    });
    if (moves.length) {
      try {
        commit((current) => validateState({ ...current, entries: current.entries.map((e) => moves.find((m) => m.entry.id === e.id) ? { ...e, date: moves.find((m) => m.entry.id === e.id).date } : e) }));
      } catch (error) {
        return fail(`Nothing was moved: ${error.message}`);
      }
    }
  }
  if (moves.length && !normalized.length) {
    const moved = moves.map(({ entry, date }) => ({ ...entry, date }));
    const batchId = stableId(`${today}|${turnId}|${callId}|move`);
    const changes = moves.map(({ entry, date }) => `${entryTitle(entry, state)}: date ${entry.date} → ${date}`);
    return {
      result: {
        moved: moves.map(({ entry, date }) => ({ id: entry.id, title: entryTitle(entry, state), from: entry.date, to: date })),
        logged: [],
        needsDetails: [],
        replyGuidance: `The user was correcting a day, so the entry already saved was moved (${changes.join("; ")}) and nothing new was logged. Say that in one short sentence.`,
      },
      effects: {
        card: { kind: "logged", mode: "updated", batchId, date: moves[0].date, entries: moved.map((e) => summarizeEntry(e, state)), previous: moves.map(({ entry }) => summarizeEntry(entry, state)), changes, replaced: moves.map(({ entry }) => entry), newLibrary: { books: [], songs: [], habits: [] }, pendingIds: [], undone: false },
      },
    };
  }
  const bookStarts = new Map(); // entry index → starting-point change for its book
  normalized = normalized.map((n, index) => {
    const read = readingFromPosition(n.raw, state);
    if (read.bookStart) bookStarts.set(index, read.bookStart);
    return read.raw === n.raw ? n : { ...n, raw: read.raw };
  });
  let replacedBooks = [];
  const raws = normalized.map(({ raw }) => {
    const { questions, ...rest } = raw;
    return { ...tidyRaw(rest), questions: [] }; // completeness is decided by the app, not the model
  });
  const batch = prepareImport({ message: "", entries: raws }, state, { date: logDate, time: ctx.now || nowTime(), batchId });

  const saves = []; // { draft, index, attachTo, openParts }
  const incomplete = []; // whole activities still missing details (not attached to a saved one)
  const rejected = [];
  const warnings = [];
  const duplicates = [];
  const pendingByShape = new Map(pending.filter((p) => p.signature).map((p) => [p.signature, p]));
  const explicitResolves = new Set();

  batch.drafts.forEach((original, index) => {
    let draft = original;
    const type = draft.entry.type;
    const key = PART_KEY[type];
    const resolving = pending.find((p) => p.id === normalized[index].resolves);
    // Completed earlier in this reply (the model sent the same item twice): don't save it again.
    if (!resolving && ctx.turnResolved?.has(normalized[index].resolves)) return duplicates.push(draft.entry.id);
    if (resolving) explicitResolves.add(resolving.id);
    let attachTo = resolving?.attachTo && state.entries.some((e) => e.id === resolving.attachTo) ? resolving.attachTo : null;
    if (!attachTo && key) attachTo = autoAttachTarget(draft.entry, state, turnTargets, pending, { overlap: !MORE_OF.test(ctx.latestUserText || "") });
    if (attachTo) {
      // Only parts the saved workout or meal doesn't have yet are added; saved values stay.
      const target = state.entries.find((e) => e.id === attachTo);
      const have = new Set(target[key].map((p) => nameKey(p.name)));
      const fresh = draft.entry[key].filter((p) => !have.has(nameKey(p.name)));
      if (!fresh.length) return duplicates.push(draft.entry.id);
      const entry = { ...draft.entry, [key]: fresh };
      draft = { ...draft, entry, questions: partQuestions(entry) };
    }
    const collision = importCollision(draft.entry, state);
    const signature = activitySignature(raws[index], draft.entry.date);
    if (!attachTo && (collision.startsWith("This entry was already saved") || turnSeen.has(signature) || alreadySaved(draft.entry, raws[index], state, { repeatedMessage: ctx.repeatedMessage }))) {
      duplicates.push(draft.entry.id);
      return;
    }
    for (const w of draft.warnings)
      if (!/^Time wasn’t mentioned|doesn’t match your paragraph/.test(w)) warnings.push(`${LABELS[type]}: ${w}`);
    const issues = draftIssues(draft, today);
    const missing = issues.filter((q) => draft.questions.includes(q));
    const invalid = issues.filter((q) => !draft.questions.includes(q));
    if (!missing.length && invalid.length) return rejected.push({ index, type, reason: invalid[0] });
    if (!missing.length) {
      saves.push({ draft, index, attachTo, openParts: [] });
      turnSeen.add(signature);
      if (collision && !attachTo) warnings.push(`${LABELS[type]}: ${collision}`);
      return;
    }
    // Save the complete exercises or foods now; keep only the rest waiting.
    const parts = key ? draft.entry[key] : [];
    const done = parts.filter((p) => isPartComplete(type, p));
    const open = parts.filter((p) => !isPartComplete(type, p));
    const partOnly = key && parts.length && missing.every((q) => partQuestions(draft.entry).includes(q));
    if (partOnly && done.length) {
      const doneDraft = { ...draft, entry: { ...draft.entry, [key]: done }, questions: [] };
      if (!draftIssues(doneDraft, today).length) {
        saves.push({ draft: doneDraft, index, attachTo, openParts: open });
        turnSeen.add(signature);
        return;
      }
    }
    if (partOnly && attachTo) {
      saves.push({ draft: null, index, attachTo, openParts: open, type });
      return;
    }
    const shape = pendingSignature(raws[index], draft.entry.date);
    if (incomplete.some((p) => p.shape === shape)) return duplicates.push(draft.entry.id);
    // A fragment of an activity already saved in this message (e.g. "then 2 minutes at incline 12").
    const genericTitle = (t) => !t || nameKey(t) === nameKey(LABELS[type]);
    const sameActivity = (e) => e.type === type && e.date === draft.entry.date && e.status === draft.entry.status && (genericTitle(e.title) || genericTitle(draft.entry.title) || nameKey(e.title) === nameKey(draft.entry.title));
    if (!key && !resolving && (saves.some((x) => x.draft && sameActivity(x.draft.entry)) || turnTargets.some((t) => sameActivity(state.entries.find((e) => e.id === t.id) || {}))))
      return duplicates.push(draft.entry.id);
    incomplete.push({ draft, index, questions: missing, shape, existing: resolving || pendingByShape.get(shape) });
  });

  let replaced = [];
  const newLibrary = { books: [], songs: [], habits: [] };
  let nextState = state;
  const writes = saves.filter((s) => s.draft);
  if (writes.length) {
    try {
      commit((current) => {
        const fresh = writes.filter((s) => !s.attachTo);
        const attached = writes.filter((s) => s.attachTo);
        replaced = current.entries.filter(
          (e) =>
            fresh.some(
              ({ draft: d }) =>
                ["steps", "screentime"].includes(d.entry.type) &&
                e.type === d.entry.type &&
                e.date === d.entry.date &&
                e.status === d.entry.status &&
                e.id !== d.entry.id,
            ) || attached.some((s) => s.attachTo === e.id),
        );
        let next = fresh.length
          ? applyImport(current, { ...batch, drafts: fresh.map(({ draft }) => ({ ...draft, included: true, reviewed: false })) }, today)
          : current;
        for (const { draft, attachTo } of attached) {
          const target = next.entries.find((e) => e.id === attachTo);
          const key = PART_KEY[draft.entry.type];
          next = upsertEntry(next, {
            ...target,
            [key]: mergeParts(draft.entry.type, target[key], draft.entry[key], { replace: true }),
            minutes: target.minutes || draft.entry.minutes || 0,
            ...(draft.entry.nutritionEstimated ? { nutritionEstimated: true } : {}),
          });
        }
        for (const s of fresh) {
          const bookStart = bookStarts.get(s.index);
          const saved = next.entries.find((e) => e.id === s.draft.entry.id);
          if (!bookStart || !saved?.bookId) continue;
          const moved = moveBookStart(next, saved.bookId, bookStart);
          next = moved.state;
          replacedBooks.push(...moved.before.filter((b) => current.books.some((c) => c.id === b.id) && !replacedBooks.some((r) => r.id === b.id)));
        }
        next = validateState(next);
        for (const k of ["books", "songs", "habits"])
          newLibrary[k] = next[k].filter((x) => !current[k].some((c) => c.id === x.id)).map((x) => x.id);
        nextState = next;
        return next;
      });
    } catch (error) {
      return fail(`Nothing was saved: ${error.message}`);
    }
    for (const s of writes) if (!s.attachTo) turnTargets.push({ id: s.draft.entry.id, type: s.draft.entry.type });
  }
  const savedIds = [];
  for (const s of writes) {
    const id = s.attachTo || s.draft.entry.id;
    if (!savedIds.includes(id)) savedIds.push(id);
  }
  const saved = savedIds.map((id) => nextState.entries.find((e) => e.id === id)).filter(Boolean);

  // One waiting item per workout or meal: its earlier gaps (minus parts now saved) plus new ones.
  const pendingAdd = [];
  const resolved = new Set();
  const byTarget = new Map();
  const touchTarget = (targetId, type) => {
    if (!byTarget.has(targetId)) {
      const existing = pending.find((p) => p.attachTo === targetId);
      byTarget.set(targetId, { type, existing, parts: existing ? [...(existing.draft?.entry?.[PART_KEY[type]] || [])] : [], index: null });
    }
    return byTarget.get(targetId);
  };
  for (const s of saves) {
    const type = s.draft?.entry.type || s.type;
    const attachId = s.attachTo || s.draft.entry.id;
    if (!s.attachTo && !s.openParts.length) continue;
    const group = touchTarget(attachId, type);
    group.index ??= s.index;
    for (const part of s.openParts) {
      group.parts = group.parts.filter((p) => nameKey(p.name) !== nameKey(part.name));
      group.parts.push(part);
    }
  }
  for (const [targetId, group] of byTarget) {
    const key = PART_KEY[group.type];
    const target = nextState.entries.find((e) => e.id === targetId);
    const have = new Set((target?.[key] || []).map((p) => nameKey(p.name)));
    const open = group.parts.filter((p) => !have.has(nameKey(p.name)));
    if (!open.length) {
      if (group.existing) resolved.add(group.existing.id);
      continue;
    }
    const openEntry = { ...(target || {}), type: group.type, date: target?.date || logDate, id: `${targetId}-more`, [key]: open };
    pendingAdd.push({
      id: group.existing ? group.existing.id : `p-${batchId.slice(0, 6)}-${(group.index ?? 0) + 1}`,
      signature: `attach:${targetId}`,
      rulesVersion: RULES_VERSION,
      attachTo: targetId,
      type: group.type,
      date: openEntry.date,
      known: { title: target ? entryTitle(target, nextState) : LABELS[group.type], [key]: open.map((p) => ({ ...p })) },
      questions: partQuestions(openEntry),
      draft: { entry: openEntry, libraries: batch.libraries },
      turnsOpen: 0,
    });
  }
  for (const item of incomplete) {
    pendingAdd.push({
      id: item.existing ? item.existing.id : `p-${batchId.slice(0, 6)}-${item.index + 1}`,
      signature: item.shape,
      rulesVersion: RULES_VERSION,
      type: item.draft.entry.type,
      date: item.draft.entry.date,
      known: knownFields(raws[item.index]),
      questions: item.questions,
      draft: { entry: item.draft.entry, libraries: batch.libraries },
      turnsOpen: 0,
    });
  }
  const stillOpen = new Set(pendingAdd.map((p) => p.id));
  for (const id of explicitResolves) if (!pending.find((p) => p.id === id)?.attachTo) resolved.add(id);
  const shapeWithoutDate = (signature) => {
    try {
      const [type, , status, name] = JSON.parse(signature);
      return JSON.stringify([type, status, name]);
    } catch {
      return "";
    }
  };
  for (const s of writes) {
    const shaped = pendingByShape.get(pendingSignature(raws[s.index], s.draft.entry.date));
    if (shaped && !shaped.attachTo) resolved.add(shaped.id);
    else if (!shaped && !normalized[s.index].resolves && !PART_KEY[s.draft.entry.type]) {
      // The same activity sent again with another date or time: the one waiting is done.
      const shape = shapeWithoutDate(pendingSignature(raws[s.index], s.draft.entry.date));
      const same = pending.filter((p) => !p.attachTo && p.signature && shapeWithoutDate(p.signature) === shape);
      if (same.length === 1) resolved.add(same[0].id);
    }
  }
  const pendingResolve = [...resolved].filter((id) => !stillOpen.has(id));

  const summaries = saved.map((e) => summarizeEntry(e, nextState));
  const newPending = pendingAdd.filter((p) => !pending.some((x) => x.id === p.id));
  const card =
    saved.length || newPending.length
      ? { kind: "logged", batchId, date: logDate, entries: summaries, pendingIds: newPending.map((p) => p.id), replaced, newLibrary, ...(replacedBooks.length ? { replacedBooks } : {}), undone: false }
      : null;
  if (saved.length && ctx.onNewBooks && newLibrary.books.length)
    ctx.onNewBooks(nextState.books.filter((b) => newLibrary.books.includes(b.id)));
  if (saved.length && ctx.onNewSongs) {
    const songIds = new Set([...newLibrary.songs, ...saved.filter((e) => e.type === "guitar" && e.songId).map((e) => e.songId)]);
    const needCovers = nextState.songs.filter((s) => songIds.has(s.id) && !s.cover);
    if (needCovers.length) ctx.onNewSongs(needCovers);
  }
  const unrated = saved.filter((e) => e.type === "guitar" && e.songId && !(Number.isInteger(e.quality) && e.quality >= 1 && e.quality <= 4));

  const needsDetails = pendingAdd.map((p) => ({ id: p.id, type: p.type, title: pendingTitle(p), questions: p.questions, ...(p.attachTo ? { partOf: p.attachTo } : {}) }));
  // Retries the model is asked to make once: estimate foods without calories, fill a meal
  // that arrived without foods, or include details the user just gave for a waiting item.
  const estimableFoods = pendingAdd.filter(
    (p) =>
      !ctx.autoNutrition &&
      p.type === "food" &&
      (p.draft.entry.items || []).some((i) => i.name && blankValue(i.calories)) &&
      !VAGUE_AMOUNT.test(normalized.map((n) => n.raw).filter((r) => r.type === "food").map((r) => r.source).join(" ")),
  );
  const emptyMeals = incomplete.filter(
    (x) => x.draft.entry.type === "food" && !(x.draft.entry.items || []).length && (normalized[x.index].raw.source || "").trim(),
  );
  const latest = ctx.latestUserText || "";
  const skippedAnswers = pendingAdd
    .filter((p) => pending.some((x) => x.id === p.id))
    .map((p) => ({ p, names: (p.draft.entry[PART_KEY[p.type]] || []).map((part) => part.name).filter((name) => mentions(latest, name) && !notFromUser.some((x) => nameKey(x) === nameKey(name))) }))
    .filter(({ names }) => names.length && AMOUNT_HINT.test(latest));
  const hints = [
    skippedAnswers.length
      ? `The user's latest message gives details for ${skippedAnswers.flatMap((x) => x.names).join(", ")}. Call log_entries again now with ONLY those parts, filled in from the user's words, and resolves set to ${[...new Set(skippedAnswers.map((x) => x.p.id))].join(", ")}.`
      : "",
    emptyMeals.length
      ? "A food entry had no foods in it. Call log_entries again with that meal's foods as items (name, servings, estimated per-serving calories, protein, carbs and fat, estimated: true, estimateNote) and resolves set to its needsDetails id."
      : "",
    estimableFoods.length
      ? `Some foods have no calories. A named food with a stated or typical amount can be estimated. Unless the amount is genuinely vague, call log_entries again now with ONLY one food entry containing just those foods (${estimableFoods.flatMap((p) => p.draft.entry.items.filter((i) => blankValue(i.calories)).map((i) => i.name)).join(", ")}): servings (1 if not stated), estimated per-serving calories, protein, carbs and fat, estimated: true, an estimateNote with the assumed portion, and resolves set to the needsDetails id. Do not include any other activity.`
      : "",
  ].filter(Boolean);
  const retryTypes = [
    ...new Set([...(estimableFoods.length || emptyMeals.length ? ["food"] : []), ...skippedAnswers.map((x) => x.p.type)]),
  ];

  const guidance = [
    summaries.length ? `Saved now: ${summaries.map((s) => s.title).join(", ")}.` : "Nothing new was saved by this call.",
    needsDetails.length
      ? `NOT saved yet (${needsDetails.map((n) => `${n.title}: ${n.questions.join(" ")}`).join(" | ")}). Ask for exactly these details in one short message, grouped; do not ask about anything else and do not say everything is complete.`
      : "",
    notFromUser.length
      ? `The user's message has no number for ${notFromUser.join(", ")}, so the values you sent for it were not saved. Tell the user plainly that you still need them.`
      : "",
    skippedOutOfScope ? `The other activities in this call were ignored because they are already logged.` : "",
    duplicates.length ? `${duplicates.length} of these were already saved earlier and were not saved again; don't mention them as new.` : "",
    unrated.length
      ? `The user didn't say how ${unrated.map((e) => entryTitle(e, nextState)).join(" and ")} went. Unless you are asking for needsDetails, call ask_user as the only tool call: "How did ${entryTitle(unrated[0], nextState)} go?" with options ${JSON.stringify(GUITAR_RATINGS)}, then save the answer with update_entry quality 1–4 (in that order). The rating schedules the song's next review.`
      : "",
    "Do not say anything else was saved, and do not list the saved details (the app shows them).",
  ]
    .filter(Boolean)
    .join(" ");

  return {
    result: {
      batchId,
      logged: summaries.map(({ id, type, date, time, title, detail, estimated }) => ({ id, type, date, time, title, detail, ...(estimated ? { estimated } : {}) })),
      needsDetails,
      rejected,
      duplicates: duplicates.length,
      warnings,
      ...(notFromUser.length ? { notInUserMessage: notFromUser } : {}),
      ...(weightsComputed.length ? { weightsWorkedOut: weightsComputed } : {}),
      ...(redated.length ? { datedFromTheirWords: [...new Set(redated)] } : {}),
      ...(unrated.length ? { ratingNeeded: unrated.map((e) => ({ id: e.id, title: entryTitle(e, nextState) })) } : {}),
      replyGuidance: guidance,
      ...(hints.length ? { hint: hints.join(" ") } : {}),
    },
    effects: {
      card,
      pendingAdd,
      pendingResolve,
      ...(retryTypes.length ? { retry: { tool: "log_entries", types: retryTypes } } : {}),
      error: !saved.length && !pendingAdd.length && (rejected.length > 0 || !duplicates.length),
    },
  };
}

const setsText = (sets) => {
  const done = sets.filter((s) => s.done);
  if (!done.length) return "no completed sets";
  const same = done.every((s) => s.weight === done[0].weight && s.reps === done[0].reps);
  return same ? `${done.length}×${done[0].reps} @ ${done[0].weight} kg` : done.map((s) => `${s.reps}@${s.weight}`).join(", ");
};
const FIELD_NAMES = { minutes: "minutes", pages: "pages", chapters: "chapters", steps: "steps", distance: "km", bpm: "BPM", value: "amount", quality: "rating", mood: "mood", title: "title", section: "section", unit: "unit", lucid: "lucid", date: "date", time: "time", status: "status" };
const describeProgress = (before, after, book) => {
  const out = [];
  if (before && before.pages !== after.pages) out.push(`book progress ${before.pages} → ${after.pages}${book.totalPages ? ` / ${book.totalPages}` : ""} pages`);
  if (before && before.chapters !== after.chapters) out.push(`book progress ${before.chapters} → ${after.chapters}${book.totalChapters ? ` / ${book.totalChapters}` : ""} chapters`);
  return out;
};
export function describeChanges(before, after) {
  const changes = [];
  // Only fields this kind of entry uses (a food entry has no rating or mood).
  const used = new Set(["date", "time", "status", "title", ...(TYPE_FIELDS[before.type] || [])]);
  for (const [key, label] of Object.entries(FIELD_NAMES)) {
    if (!used.has(key)) continue;
    const a = before[key] ?? "";
    const b = after[key] ?? "";
    if (a !== b && !(a === "" && b === 0) && !(a === 0 && b === "")) changes.push(`${label} ${a === "" ? "—" : a} → ${b === "" ? "—" : b}`);
  }
  if (before.type === "workout") {
    const names = new Set([...(before.exercises || []), ...(after.exercises || [])].map((x) => x.name));
    for (const name of names) {
      const x = before.exercises?.find((e) => e.name === name);
      const y = after.exercises?.find((e) => e.name === name);
      const from = x ? setsText(x.sets) : "not logged";
      const to = y ? setsText(y.sets) : "removed";
      if (from !== to) changes.push(`${name}: ${from} → ${to}`);
    }
  }
  if (before.type === "food") {
    const kcal = (e) => Math.round((e.items || []).reduce((t, i) => t + i.calories * i.servings, 0));
    if (kcal(before) !== kcal(after)) changes.push(`calories ${kcal(before)} → ${kcal(after)} kcal`);
    const names = (e) => (e.items || []).map((i) => `${i.servings}× ${i.name}`).join(", ");
    if (names(before) !== names(after)) changes.push(`foods: ${names(after)}`);
  }
  if (before.bookId !== after.bookId || before.songId !== after.songId || before.habitId !== after.habitId) changes.push("linked item changed");
  return changes;
}

function updateEntry(args, ctx) {
  const { state, commit, today, turnId, callId } = ctx;
  const existing = state.entries.find((e) => e.id === args.id);
  if (!existing && ctx.turnResolved?.has(args.id))
    return {
      result: { alreadySaved: ctx.turnResolved.get(args.id), note: "That waiting item was already saved by an earlier call in this reply. Nothing else to do; don't log it again." },
      effects: {},
    };
  const waiting = !existing && (ctx.pending || []).find((p) => p.id === args.id);
  if (waiting) {
    // The model aimed a correction at something still waiting for details: complete it instead.
    const entry = pendingToRaw(waiting, state);
    for (const [key, value] of Object.entries(args.changes)) {
      if (["type", "questions", "resolves"].includes(key)) continue;
      if (value === null || value === "" || (Array.isArray(value) && !value.length)) continue;
      entry[key] = value;
    }
    const out = logEntries({ entries: [{ ...entry, resolves: waiting.id }] }, ctx);
    return { ...out, result: { ...out.result, note: "That id belonged to an item still waiting for details, so it was completed and saved with these details." } };
  }
  if (!existing)
    return fail(
      "No saved entry has that id. Pending items are not saved yet.",
      "To complete a pending item, call log_entries with the full entry and resolves set to its pending id.",
    );
  const asked = typeof ctx.latestUserText === "string" ? moveRequest(ctx.latestUserText, today, ctx.now) : null;
  if (asked) {
    if (existing.date !== asked.from) {
      const meant = state.entries.filter((e) => e.date === asked.from && namesEntry(ctx.latestUserText, e, state));
      return fail(
        `Not updated: the user asked to move something from ${asked.from}, but this entry (${entryTitle(existing, state)}) is on ${existing.date}. Nothing was changed.`,
        meant.length
          ? `Move this entry instead: ${meant.map((e) => `id ${e.id} (${entryTitle(e, state)}: ${entryDetail(e)})`).join("; ")}, with update_entry changes.date ${asked.to} and nothing else.`
          : `Find the entry on ${asked.from} with list_entries, then change only its date.`,
      );
    }
    // Moving changes the day only; items, titles and amounts stay as they are.
    const onlyDate = Object.fromEntries(Object.entries(args.changes).map(([key, value]) => [key, key === "type" ? value : Array.isArray(value) ? [] : null]));
    args = { ...args, replaceList: false, changes: { ...onlyDate, date: asked.to } };
  }
  if (args.changes.type && args.changes.type !== existing.type)
    return fail(
      `That id belongs to a ${existing.type} entry, not ${args.changes.type}. Nothing was changed.`,
      "Use the id of the entry you mean. To complete a pending item, call log_entries with resolves.",
    );
  let merged = entryToRaw(existing, state);
  let notFromUser = [];
  const listKey = PART_KEY[existing.type];
  if (args.replaceList && listKey && Array.isArray(args.changes[listKey])) {
    // Restating some of the saved exercises or foods is a partial correction, not the whole list.
    const savedNames = (existing[listKey] || []).map((p) => nameKey(p.name));
    const given = args.changes[listKey];
    if (given.length < savedNames.length && given.every((p) => savedNames.includes(nameKey(p.name)))) args = { ...args, replaceList: false };
  }
  if (existing.type === "workout" && Array.isArray(args.changes.exercises) && args.changes.exercises.length) {
    const latest = typeof ctx.latestUserText === "string" ? ctx.latestUserText : "";
    const allNames = [...args.changes.exercises, ...existing.exercises].map((x) => x.name);
    const keepCounts = args.changes.exercises.map((x) => {
      const before = existing.exercises.find((p) => nameKey(p.name) === nameKey(x.name));
      if (!before || !latest || (x.sets || []).length <= before.sets.length || MORE_SETS.test(latest) || statedSetCount(latest, x.name, allNames)) return x;
      return { ...x, sets: dropRepeatedSets(x.sets, before.sets.length) };
    });
    args = { ...args, changes: { ...args.changes, exercises: keepCounts } };
    const stated = applyStatedWeights(args.changes.exercises, { ...ctx, latestUserText: latest });
    const { exercises, dropped } = groundExercises(stated.exercises, ctx, ctx.pending || [], { saved: existing.exercises || [] });
    notFromUser = dropped;
    args = { ...args, changes: { ...args.changes, exercises: exercises.filter((x) => !dropped.includes(x.name)) } };
    const otherChanges = Object.entries(tidyRaw(args.changes)).some(
      ([k, v]) => !["type", "source", "questions", "resolves", "exercises", "time"].includes(k) && v !== null && v !== "" && !(Array.isArray(v) && !v.length) && JSON.stringify(v) !== JSON.stringify(merged[k]),
    ) || (args.changes.time && args.changes.time !== merged.time);
    if (dropped.length && !args.changes.exercises.length && !otherChanges)
      return fail(
        `Not updated: the user's message has no number for ${dropped.join(", ")}.`,
        "Ask the user for the missing numbers instead of guessing.",
      );
  }
  // Corrections never invent a default time; only an explicit time changes it.
  const echoed = (key, value) =>
    (key === "notes" && String(value).trim() === entryDetail(existing)) || // the card's summary copied into notes
    (key === "title" && (nameKey(value) === nameKey(LABELS[existing.type]) || /^(meal|meals|entry|activity)$/i.test(String(value).trim()))); // generic titles never replace a name
  for (const [key, value] of Object.entries({ ...tidyRaw(args.changes), time: args.changes.time })) {
    if (["type", "source", "questions", "resolves"].includes(key) || echoed(key, value)) continue;
    if (value === null || value === "" || (Array.isArray(value) && !value.length)) continue;
    // Exercises and foods named in a correction replace their namesakes; the rest stay.
    merged[key] = key === PART_KEY[existing.type] ? (args.replaceList ? value : mergeParts(existing.type, merged[key], value, { replace: true })) : value;
  }
  const read = readingFromPosition(merged, state, { excludeId: existing.id });
  merged = read.raw;
  const batchId = stableId(`${today}|${turnId}|${callId}`);
  const batch = prepareImport({ message: "", entries: [merged] }, state, {
    date: existing.date,
    time: existing.time,
    batchId,
  });
  const draft = batch.drafts[0];
  draft.entry.id = existing.id;
  if (existing.sourceBatch) draft.entry.sourceBatch = existing.sourceBatch;
  const issues = draftIssues(draft, today);
  if (issues.length) return fail(`Not updated: ${issues[0]}`);
  let next = state;
  const newLibrary = { books: [], songs: [], habits: [] };
  let replacedBooks = [];
  try {
    commit((current) => {
      let updated = applyImport(current, { ...batch, drafts: [{ ...draft, included: true }] }, today, { replace: true });
      const savedBookId = updated.entries.find((e) => e.id === existing.id)?.bookId;
      if (read.bookStart && savedBookId) {
        const moved = moveBookStart(updated, savedBookId, read.bookStart);
        updated = validateState(moved.state);
        replacedBooks = moved.before;
      }
      for (const key of ["books", "songs", "habits"])
        newLibrary[key] = updated[key].filter((x) => !current[key].some((c) => c.id === x.id)).map((x) => x.id);
      next = updated;
      return updated;
    });
  } catch (error) {
    return fail(`Not updated: ${error.message}`);
  }
  const after = next.entries.find((e) => e.id === existing.id);
  const summary = summarizeEntry(after, next);
  const bookBefore = existing.bookId && state.books.find((b) => b.id === existing.bookId);
  const bookAfter = after.bookId && next.books.find((b) => b.id === after.bookId);
  const progressChanges = bookAfter ? describeProgress(bookBefore ? bookProgress(bookBefore, state.entries) : null, bookProgress(bookAfter, next.entries), bookAfter) : [];
  const changes = [...describeChanges(existing, after), ...progressChanges];
  if (!changes.length)
    return {
      result: { updated: { ...summary, estimated: undefined }, changes: [], nothingChanged: true, note: "The entry already had these values, so nothing changed. Tell the user that plainly; don't say it was updated." },
      effects: {},
    };
  // Waiting questions for this workout or meal that the correction answered.
  const partKey = PART_KEY[existing.type];
  const pendingAdd = [];
  const pendingResolve = [];
  for (const p of (ctx.pending || []).filter((x) => x.attachTo === existing.id && partKey)) {
    const have = new Set(after[partKey].map((part) => nameKey(part.name)));
    const open = (p.draft?.entry?.[partKey] || []).filter((part) => !have.has(nameKey(part.name)));
    if (!open.length) pendingResolve.push(p.id);
    else if (open.length !== (p.draft?.entry?.[partKey] || []).length) {
      const openEntry = { ...p.draft.entry, [partKey]: open };
      pendingAdd.push({ ...p, known: { ...p.known, [partKey]: open }, questions: partQuestions(openEntry), draft: { ...p.draft, entry: openEntry } });
    }
  }
  return {
    result: {
      updated: { ...summary, estimated: undefined },
      changes,
      batchId,
      ...(pendingAdd.length ? { stillNeeded: pendingAdd.map((p) => ({ id: p.id, questions: p.questions })) } : {}),
      ...(notFromUser.length ? { notInUserMessage: notFromUser, note: `The user's message has no number for ${notFromUser.join(", ")}, so it was not changed. Ask for it.` } : {}),
    },
    effects: {
      pendingAdd,
      pendingResolve,
      card: {
        kind: "logged",
        mode: "updated",
        batchId,
        date: existing.date,
        entries: [summary],
        previous: [summarizeEntry(existing, state)],
        changes,
        replaced: [existing],
        ...(replacedBooks.length ? { replacedBooks } : {}),
        newLibrary,
        pendingIds: [],
        undone: false,
      },
    },
  };
}

const DELETE_INTENT = /\b(delete|deleted|remove|removed|erase|undo|get rid of|take (it|that|this|them) (off|out|away)|drop (it|that|this|them)|scrap|cancel|by mistake|wrongly|shouldn'?t have (logged|added|saved)|didn'?t (have|eat|do|go|drink|read|play|sleep|practice|meditate))\b/i;
const STOP_WORDS = new Set(["the", "and", "for", "that", "this", "with", "from", "have", "had", "was", "were", "one", "my", "entry", "entries", "log", "logged", "delete", "remove", "please", "today", "yesterday"]);
const wordStems = (text) => (String(text || "").toLowerCase().match(/[a-z]+/g) || []).filter((w) => w.length > 2 && !STOP_WORDS.has(w)).map((w) => w.replace(/(ies|es|s)$/, ""));
// Does the user's message name this entry: its kind, title, meal, foods, exercises, book, song or habit?
export function namesEntry(text, entry, state) {
  const said = new Set(wordStems(text));
  const book = state.books.find((b) => b.id === entry.bookId);
  const song = state.songs.find((s) => s.id === entry.songId);
  const habit = state.habits.find((h) => h.id === entry.habitId);
  const own = [LABELS[entry.type], entry.type === "food" ? "meal food ate eat" : "", entry.type === "sleep" ? "nap slept" : "", entry.title, book?.title, song?.title, habit?.name, ...(entry.items || []).map((i) => i.name), ...(entry.exercises || []).map((x) => x.name)].join(" ");
  return wordStems(own).some((w) => said.has(w));
}

function deleteEntries(args, ctx) {
  const { state, commit, today, turnId, callId } = ctx;
  const ids = [...new Set(args.ids)];
  const targets = state.entries.filter((e) => ids.includes(e.id));
  if (!targets.length)
    return fail("None of those ids match saved entries.", "Call list_entries to find the right entries.");
  // Nothing is deleted unless the user asked to delete it, in words that name it (or it was just logged).
  const said = ctx.latestUserText;
  if (typeof said === "string" && said.trim()) {
    if (!DELETE_INTENT.test(said))
      return fail(
        "Not deleted: the user didn't ask to delete anything.",
        "To move an entry to another day or change it, call update_entry on that entry's id with the new date or values. Never delete and re-log.",
      );
    const unnamed = targets.filter((e) => !namesEntry(said, e, state) && !(ctx.recentLoggedIds || []).includes(e.id));
    if (unnamed.length)
      return fail(
        `Not deleted: ${unnamed.map((e) => `${entryTitle(e, state)} on ${e.date}`).join(", ")} doesn't match what the user asked to delete.`,
        "Find the entry they mean in context.entriesOnLogDate, context.recentEntries or list_entries.",
      );
  }
  try {
    commit((current) => ({ ...current, entries: current.entries.filter((e) => !ids.includes(e.id)) }));
  } catch (error) {
    return fail(`Nothing was deleted: ${error.message}`);
  }
  const batchId = stableId(`${today}|${turnId}|${callId}`);
  const removed = targets.map((e) => summarizeEntry(e, state));
  return {
    result: { deleted: removed.map(({ id, type, title, detail }) => ({ id, type, title, detail })), missing: ids.length - targets.length, batchId },
    effects: {
      card: {
        kind: "logged",
        mode: "deleted",
        batchId,
        date: targets[0].date,
        entries: [],
        removed,
        replaced: targets,
        newLibrary: { books: [], songs: [], habits: [] },
        pendingIds: [],
        undone: false,
      },
    },
  };
}

function pendingToRaw(p, state) {
  const libraries = p.draft?.libraries || { books: [], songs: [], habits: [] };
  const withLibraries = {
    ...state,
    books: [...state.books, ...libraries.books.filter((b) => !state.books.some((x) => x.id === b.id))],
    songs: [...state.songs, ...libraries.songs.filter((b) => !state.songs.some((x) => x.id === b.id))],
    habits: [...state.habits, ...libraries.habits.filter((b) => !state.habits.some((x) => x.id === b.id))],
  };
  const orNull = (v) => (v === "" || v === undefined ? null : v);
  const raw = entryToRaw(p.draft.entry, withLibraries);
  return {
    ...raw,
    title: raw.title || p.known?.title || "",
    source: "",
    resolves: null,
    minutes: raw.minutes || null,
    exercises: raw.exercises.map((x) => ({ ...x, muscle: x.muscle || null, sets: x.sets.map((t) => ({ weight: orNull(t.weight), reps: orNull(t.reps), done: Boolean(t.done) })) })),
    items: raw.items.map((i) => ({ ...i, servings: orNull(i.servings), calories: orNull(i.calories), protein: orNull(i.protein), carbs: orNull(i.carbs), fat: orNull(i.fat) })),
  };
}

/**
 * recheckPending(chat, ctx) → null or { chat, card }
 * Waiting items from older rules are re-run as one log: complete ones save, workouts
 * and meals merge, and only real gaps come back as new waiting items.
 */
export function recheckPending(chat, ctx) {
  const stale = chat.pending.filter((p) => p.rulesVersion !== RULES_VERSION && p.draft?.entry);
  if (!stale.length) return null;
  const current = chat.pending.filter((p) => !stale.includes(p));
  // Gaps of a workout or meal that is already saved re-join that entry.
  const attached = stale.filter((p) => p.attachTo && ctx.state.entries.some((e) => e.id === p.attachTo));
  const entries = stale.map((p) => ({ ...pendingToRaw(p, ctx.state), resolves: attached.includes(p) ? p.id : null }));
  const callId = `recheck-${stale.map((p) => p.id).join("-").slice(0, 60)}`;
  const out = executeToolCall(
    { id: callId, type: "function", function: { name: "log_entries", arguments: JSON.stringify({ entries }) } },
    { ...ctx, turnId: callId, pending: [...current, ...attached], turnTargets: [], turnSignatures: new Set(), userText: "", latestUserText: "" },
  );
  return { stale, current, out, callId };
}

// An entry in the tool's shape with every field present.
export function blankRaw(type) {
  const base = Object.fromEntries(
    Object.entries(extractionSchema.properties.entries.items.properties).map(([key, sc]) => [
      key,
      Array.isArray(sc.type) && sc.type.includes("null") ? null : sc.type === "array" ? [] : sc.type === "boolean" ? false : "",
    ]),
  );
  return { ...base, type, status: "done", resolves: null };
}

// Combine a log with the follow-up log that filled in estimated nutrition.
export function mergeLogOutcomes(first, second) {
  if (!second) return first;
  const resolved = new Set(second.effects.pendingResolve || []);
  const reopened = new Set((second.effects.pendingAdd || []).map((p) => p.id));
  const byId = (list) => [...new Map(list.map((x) => [x.id, x])).values()];
  const logged = byId([...(first.result.logged || []), ...(second.result.logged || [])]);
  const needsDetails = [
    ...(first.result.needsDetails || []).filter((n) => !resolved.has(n.id) && !reopened.has(n.id)),
    ...(second.result.needsDetails || []),
  ];
  let card = first.effects.card || second.effects.card || null;
  if (first.effects.card && second.effects.card) {
    const a = first.effects.card;
    const b = second.effects.card;
    const created = new Set(a.entries.map((e) => e.id).filter((id) => !a.replaced.some((r) => r.id === id)));
    card = {
      ...a,
      entries: byId([...a.entries, ...b.entries]),
      pendingIds: [...a.pendingIds.filter((id) => !resolved.has(id)), ...b.pendingIds.filter((id) => !a.pendingIds.includes(id))],
      replaced: [...a.replaced, ...b.replaced.filter((r) => !created.has(r.id) && !a.replaced.some((x) => x.id === r.id))],
      newLibrary: Object.fromEntries(["books", "songs", "habits"].map((k) => [k, [...new Set([...a.newLibrary[k], ...b.newLibrary[k]])]])),
    };
  } else if (card) card = { ...card, pendingIds: card.pendingIds.filter((id) => !resolved.has(id)) };
  const titles = logged.map((e) => e.title);
  return {
    result: {
      ...first.result,
      logged,
      needsDetails,
      warnings: [...(first.result.warnings || []), ...(second.result.warnings || [])],
      nutrition: "Calories and macros for the foods were estimated automatically from what the user said.",
      replyGuidance: [
        titles.length ? `Saved now: ${titles.join(", ")}.` : "Nothing new was saved.",
        needsDetails.length
          ? `NOT saved yet (${needsDetails.map((n) => `${n.title}: ${n.questions.join(" ")}`).join(" | ")}). Ask for exactly these details in one short message, grouped.`
          : "",
        "Food values are estimates the app looked up; mention that briefly. Never ask the user for calories or portion sizes. Do not list saved details (the app shows them).",
      ]
        .filter(Boolean)
        .join(" "),
    },
    effects: {
      ...first.effects,
      card,
      pendingAdd: [...(first.effects.pendingAdd || []).filter((p) => !resolved.has(p.id) && !reopened.has(p.id)), ...(second.effects.pendingAdd || [])],
      pendingResolve: [...new Set([...(first.effects.pendingResolve || []), ...resolved])],
      error: Boolean(first.effects.error && second.effects.error),
    },
  };
}

/**
 * weightsAsAmounts(items, text) → { items, changed }
 * "250 gm broasted chicken" is one serving of 250 g, not 250 servings. A food whose servings
 * number appears in the user's words with a weight or volume right next to the food's name
 * becomes servings 1 with the amount in its name. Guessed numbers for it are cleared so the
 * app estimates the whole amount; numbers the user gave are kept.
 */
const AMOUNT_UNITS = { g: "g", gm: "g", gms: "g", gram: "g", grams: "g", gr: "g", kg: "kg", kgs: "kg", ml: "ml", l: "l", ltr: "l", litre: "l", litres: "l", liter: "l", liters: "l" };
export function weightsAsAmounts(items, text) {
  const said = String(text || "");
  if (!Array.isArray(items) || !said) return { items, changed: false };
  let changed = false;
  const next = items.map((item) => {
    const servings = Number(item?.servings);
    if (!item?.name || !(servings > 1) || /\d\s*(g|gm|kg|ml|l)\b/i.test(item.name)) return item;
    const words = low(item.name).split(/[^\p{L}]+/u).filter((w) => w.length >= 3);
    const pattern = new RegExp(`(?<![\\d.])${String(servings).replace(".", "\\.")}\\s*(${Object.keys(AMOUNT_UNITS).join("|")})\\b`, "gi");
    for (const match of said.matchAll(pattern)) {
      const after = low(said.slice(match.index + match[0].length, match.index + match[0].length + 40)).replace(/^\s*(of\s+)?/, "");
      const before = low(said.slice(Math.max(0, match.index - 30), match.index)).replace(/[\s:(,-]+$/, "");
      const near = words.some((w) => after.startsWith(w) || after.split(/[,.;]| and /)[0].includes(w) || before.endsWith(w));
      if (!near) continue;
      changed = true;
      const own = item.estimated === false && typeof item.calories === "number" && item.calories > 0;
      return {
        ...item,
        name: `${item.name}, ${servings} ${AMOUNT_UNITS[match[1].toLowerCase()]}`,
        servings: 1,
        ...(own ? {} : { calories: null, protein: null, carbs: null, fat: null, estimated: false, estimateNote: "" }),
      };
    }
    return item;
  });
  return { items: changed ? next : items, changed };
}

// Ask for estimates for these foods; null when the lookup fails.
async function estimateItems(items, { meal, description, fetchImpl, signal }) {
  try {
    const estimates = await estimateNutrition({
      foods: items.map((i) => ({ name: i.name, servings: Number(i.servings) > 0 && Number(i.servings) <= 100 ? Number(i.servings) : null })),
      meal: meal || "",
      description: description || "",
      fetchImpl,
      signal,
    });
    return estimates.length === items.length ? estimates : null;
  } catch {
    return null;
  }
}
const withEstimates = (items, targets, estimates) =>
  items.map((item) => {
    const at = targets.indexOf(item);
    return at < 0 ? item : applyEstimate(item, estimates[at]);
  });

/**
 * prefillNutrition(call, ctx) → { call, estimated }
 * Before a log or a meal correction runs, the app estimates nutrition for its foods: foods
 * with no numbers, and (in a log) foods the model guessed itself. Numbers the user gave are
 * kept. If the lookup fails the call runs unchanged.
 */
export async function prefillNutrition(call, ctx) {
  const name = call?.function?.name;
  if (name !== "update_entry" && name !== "log_entries") return { call, estimated: [] };
  let args;
  try {
    args = JSON.parse(call.function.arguments || "{}");
  } catch {
    return { call, estimated: [] };
  }
  const estimated = [];
  let converted = false;
  const fill = async (given, meal, pick) => {
    if (!Array.isArray(given)) return given;
    const amounts = weightsAsAmounts(given, ctx.description);
    converted ||= amounts.changed;
    const items = amounts.items;
    const targets = items.filter((i) => i?.name && pick(i));
    if (!targets.length) return items;
    const estimates = await estimateItems(targets, { meal, description: ctx.description, fetchImpl: ctx.fetchImpl, signal: ctx.signal });
    if (!estimates) return items;
    estimated.push(...targets.map((i) => i.name));
    return withEstimates(items, targets, estimates);
  };
  let next = args;
  if (name === "update_entry") {
    const target = ctx.state.entries.find((e) => e.id === args?.id);
    if (target?.type !== "food") return { call, estimated: [] };
    next = { ...args, changes: { ...args.changes, items: await fill(args.changes?.items, args.changes?.title || target.title, needsNutrition) } };
  } else {
    if (!Array.isArray(args?.entries)) return { call, estimated: [] };
    const entries = [];
    for (const entry of args.entries)
      entries.push(entry?.type === "food" ? { ...entry, items: await fill(entry.items, entry.title, (i) => needsNutrition(i) || i.estimated === true) } : entry);
    next = { ...args, entries };
  }
  if (!estimated.length && !converted) return { call, estimated: [] };
  return { call: { ...call, function: { ...call.function, arguments: JSON.stringify(next) } }, estimated };
}

// A meal with estimated foods, from the last two weeks, shown on a card in this conversation.
export function reestimateCandidate(entry, chat, from, today) {
  return (
    entry.type === "food" &&
    entry.date >= from &&
    entry.date <= today &&
    (entry.items || []).some((i) => i.estimated === true) &&
    chat.messages.some((m) => m.card?.kind === "logged" && !m.card.undone && m.card.entries?.some((x) => x.id === entry.id))
  );
}

/**
 * reestimateMeals({ state, chat, today, fetchImpl, skip }) → [{ before, after }]
 * Meals from the last two weeks whose foods carry estimates are estimated again with the
 * current estimator, using the words from the message that logged them. Foods with the
 * user's own numbers are kept. Meals whose lookup fails are left out.
 */
export async function reestimateMeals({ state, chat, today, fetchImpl, skip = [], days = 14, limit = 10 }) {
  const from = shiftDate(today, -days);
  const meals = state.entries
    .filter((e) => reestimateCandidate(e, chat, from, today) && !skip.includes(e.id))
    .slice(-limit);
  const results = [];
  for (const meal of meals) {
    const card = chat.messages.find((m) => m.card?.kind === "logged" && m.card.entries?.some((x) => x.id === meal.id));
    const said = card ? chat.messages.find((m) => m.role === "user" && m.turnId === card.turnId)?.content : "";
    const targets = meal.items.filter((i) => i.estimated === true);
    const description = said || meal.items.map((i) => `${i.servings} ${i.name}${i.estimateNote ? ` (${i.estimateNote})` : ""}`).join(", ");
    const estimates = await estimateItems(targets, { meal: meal.title, description, fetchImpl });
    if (!estimates) continue;
    results.push({ before: meal, after: { ...meal, items: withEstimates(meal.items, targets, estimates) } });
  }
  return results;
}

/**
 * fillFoodNutrition(outcome, ctx) → outcome with foods estimated and saved.
 * For every waiting meal item without calories or an amount, estimate nutrition and
 * log it into the same meal, so the user is never asked to count calories.
 * ctx.saidFor(p), when given, returns the user's words that created a waiting meal.
 */
export async function fillFoodNutrition(outcome, ctx) {
  const foods = (outcome?.effects?.pendingAdd || []).filter((p) => p.type === "food" && (p.draft?.entry?.items || []).some(needsNutrition));
  if (!foods.length) return outcome;
  const entries = [];
  for (const p of foods) {
    const said = ctx.saidFor?.(p) || ctx.description;
    const { items } = weightsAsAmounts(p.draft.entry.items, said);
    const missing = items.filter(needsNutrition);
    const estimates = await estimateItems(missing, { meal: p.draft.entry.title, description: said, fetchImpl: ctx.fetchImpl, signal: ctx.signal });
    if (!estimates) continue; // leave the question in place if the estimate can't be fetched
    entries.push({
      ...blankRaw("food"),
      date: p.draft.entry.date,
      time: p.draft.entry.time,
      status: p.draft.entry.status,
      title: p.draft.entry.title || "",
      source: "",
      resolves: p.id,
      items: withEstimates(items, missing, estimates).map((item) => ({
        name: item.name,
        servings: item.servings,
        calories: item.calories,
        protein: item.protein || 0,
        carbs: item.carbs || 0,
        fat: item.fat || 0,
        estimated: Boolean(item.estimated),
        estimateNote: item.estimateNote || "",
      })),
    });
  }
  if (!entries.length) return outcome;
  const pendingNow = [
    ...(ctx.pending || []).filter((p) => !(outcome.effects.pendingResolve || []).includes(p.id) && !(outcome.effects.pendingAdd || []).some((q) => q.id === p.id)),
    ...(outcome.effects.pendingAdd || []),
  ];
  const second = executeToolCall(
    { id: `${ctx.callId || "log"}-nutrition`, type: "function", function: { name: "log_entries", arguments: JSON.stringify({ entries }) } },
    { ...ctx, pending: pendingNow, userText: "", latestUserText: "", autoNutrition: true, allowTypes: undefined },
  );
  return mergeLogOutcomes(outcome, second);
}

export function undoBatch(state, card) {
  const ids = new Set(card.entries.map((e) => e.id));
  const kept = state.entries.filter((e) => !ids.has(e.id));
  if (card.replacedBooks?.length) state = { ...state, books: state.books.map((b) => card.replacedBooks.find((r) => r.id === b.id) || b) };
  const next = {
    ...state,
    entries: [...kept, ...card.replaced.filter((r) => !kept.some((e) => e.id === r.id))],
  };
  const referenced = (key, id) => next.entries.some((e) => e[key] === id);
  next.books = state.books.filter(
    (b) => !card.newLibrary.books.includes(b.id) || referenced("bookId", b.id),
  );
  next.songs = state.songs.filter(
    (s) => !card.newLibrary.songs.includes(s.id) || referenced("songId", s.id),
  );
  next.habits = state.habits.filter(
    (h) => !card.newLibrary.habits.includes(h.id) || referenced("habitId", h.id),
  );
  return next;
}

function queryData(args, ctx) {
  let request;
  try {
    request = resolveChartRequest(ctx.state, args, ctx.today);
  } catch (error) {
    return fail(error.message, "Pick a supported metric and range, or ask the user.");
  }
  const series = computeSeries(
    ctx.state,
    request.metric,
    { range: request.range, from: request.from, to: request.to, habitId: request.habitId, groupBy: request.groupBy },
    ctx.today,
  );
  const result = {
    metric: series.metric,
    label: series.label,
    unit: series.unit,
    range: RANGE_LABELS[request.range],
    from: series.from,
    to: series.to,
    total: series.summary.total,
    perLoggedDay: series.summary.perLoggedDay,
    daysWithData: series.summary.daysWithData,
    days: series.summary.days,
    best: series.summary.best,
    previousPeriod: series.summary.previous,
    goal: series.goal,
    note:
      series.summary.daysWithData < series.summary.days
        ? "Days without entries are missing, not zero."
        : undefined,
  };
  if (series.groupBy !== "total")
    result.points = series.points.map((p) => {
      const { label, ...rest } = p;
      return rest;
    });
  return {
    result,
    effects: {
      card:
        request.chart !== "none"
          ? { kind: "chart", spec: { ...request }, title: series.label }
          : null,
    },
  };
}

function addSongs(args, ctx) {
  const { state, commit, today, turnId, callId } = ctx;
  const batchId = stableId(`${today}|${turnId}|${callId}`);
  const added = [];
  const existing = [];
  const named = []; // songs saved without an artist that now have one
  const seen = [];
  for (const wanted of args.songs) {
    const title = String(wanted.title || "").trim();
    const artist = String(wanted.artist || "").trim();
    if (!title) continue;
    const found = findSong([...state.songs, ...added], title, artist);
    if (found) {
      if (artist && !found.artist && !added.includes(found)) named.push({ ...found, artist, cover: "" });
      else if (!seen.includes(found.id)) existing.push(found);
      seen.push(found.id);
      continue;
    }
    const song = { id: `song-${batchId.slice(0, 12)}-${added.length}`, title, artist, targetBpm: 0, status: SONG_STATUSES.includes(wanted.status) ? wanted.status : "Want to learn", cover: "", added: today };
    added.push(song);
    seen.push(song.id);
  }
  if (!added.length && !existing.length && !named.length) return fail("No song titles were given.", "Ask which song they mean.");
  if (added.length || named.length) {
    try {
      commit((current) =>
        validateState({
          ...current,
          songs: [...current.songs.map((s) => named.find((n) => n.id === s.id) || s), ...added.filter((s) => !current.songs.some((x) => x.id === s.id))],
        }),
      );
    } catch (error) {
      return fail(`Nothing was added: ${error.message}`);
    }
    ctx.onNewSongs?.([...added, ...named]);
  }
  const brief = (s) => ({ id: s.id, title: s.title, artist: s.artist || null, status: s.status });
  return {
    result: {
      added: added.map(brief),
      alreadyInList: existing.map(brief),
      ...(named.length ? { artistAdded: named.map(brief) } : {}),
      replyGuidance: `${added.length ? `Added to the practice list: ${added.map((s) => s.title).join(", ")}.` : ""} ${named.length ? `Artist added for: ${named.map((s) => `${s.title} (${s.artist})`).join(", ")}.` : ""} ${existing.length ? `Already on the list: ${existing.map((s) => s.title).join(", ")}.` : ""} No practice time was logged. Keep the reply to one short sentence; the app shows the songs.`.trim(),
    },
    effects: {
      card: added.length
        ? { kind: "logged", mode: "songs", batchId, date: today, entries: [], songs: added.map(brief), replaced: [], newLibrary: { books: [], songs: added.map((s) => s.id), habits: [] }, pendingIds: [], undone: false }
        : null,
    },
  };
}

function addBooks(args, ctx) {
  const { state, commit, today, turnId, callId } = ctx;
  const batchId = stableId(`${today}|${turnId}|${callId}`);
  const added = [];
  const existing = [];
  const named = []; // books saved without an author that now have one
  const seen = [];
  for (const wanted of args.books) {
    const title = String(wanted.title || "").trim();
    const author = String(wanted.author || "").trim();
    if (!title) continue;
    const found = findBook([...state.books, ...added], title, author);
    if (found) {
      if (author && !found.author && !added.includes(found)) named.push({ ...found, author, cover: "" });
      else if (!seen.includes(found.id)) existing.push(found);
      seen.push(found.id);
      continue;
    }
    added.push({ id: `book-${batchId.slice(0, 12)}-${added.length}`, title, author, totalPages: 0, totalChapters: 0, startPages: 0, startChapters: 0, cover: "", status: BOOK_STATUSES.includes(wanted.status) ? wanted.status : "Want to read" });
  }
  if (!added.length && !existing.length && !named.length) return fail("No book titles were given.", "Ask which book they mean.");
  if (added.length || named.length) {
    try {
      commit((current) =>
        validateState({
          ...current,
          books: [...current.books.map((b) => named.find((n) => n.id === b.id) || b), ...added.filter((b) => !current.books.some((x) => x.id === b.id))],
        }),
      );
    } catch (error) {
      return fail(`Nothing was added: ${error.message}`);
    }
    ctx.onNewBooks?.([...added, ...named]);
  }
  const brief = (b) => ({ id: b.id, title: b.title, author: b.author || null, status: b.status });
  return {
    result: {
      added: added.map(brief),
      alreadyInLibrary: existing.map(brief),
      ...(named.length ? { authorAdded: named.map(brief) } : {}),
      replyGuidance: [
        added.length ? `Added to the reading list: ${added.map((b) => b.title).join(", ")}.` : "",
        named.length ? `Author added for: ${named.map((b) => `${b.title} (${b.author})`).join(", ")}.` : "",
        existing.length ? `Already in the library: ${existing.map((b) => `${b.title} (${b.status})`).join(", ")}.` : "",
        "No reading was logged. Keep the reply to one short sentence; the app shows the books.",
      ]
        .filter(Boolean)
        .join(" "),
    },
    effects: {
      card: added.length
        ? { kind: "logged", mode: "books", batchId, date: today, entries: [], books: added.map(brief), replaced: [], newLibrary: { books: added.map((b) => b.id), songs: [], habits: [] }, pendingIds: [], undone: false }
        : null,
    },
  };
}

function addHabits(args, ctx) {
  const { state, commit, today, turnId, callId } = ctx;
  const batchId = stableId(`${today}|${turnId}|${callId}`);
  const key = (name) => String(name || "").toLocaleLowerCase().replace(/[^\p{L}\p{N} ]/gu, " ").replace(/\s+/g, " ").trim();
  const added = [];
  const existing = [];
  for (const wanted of args.habits) {
    const name = String(wanted.name || "").trim();
    if (!name) continue;
    const found = [...state.habits, ...added].find((h) => key(h.name) === key(name));
    if (found) {
      if (!existing.includes(found) && !added.includes(found)) existing.push(found);
      continue;
    }
    const unit = String(wanted.unit || "").trim() || "times";
    added.push({ id: `habit-${batchId.slice(0, 12)}-${added.length}`, name, unit, goal: Number(wanted.goal) > 0 ? Number(wanted.goal) : unit === "times" ? 1 : 0 });
  }
  if (!added.length && !existing.length) return fail("No habit names were given.", "Ask what they want to track.");
  if (added.length) {
    try {
      commit((current) => validateState({ ...current, habits: [...current.habits, ...added] }));
    } catch (error) {
      return fail(`Nothing was added: ${error.message}`);
    }
  }
  const brief = (h) => ({ id: h.id, name: h.name, unit: h.unit, goal: h.goal });
  return {
    result: {
      added: added.map(brief),
      alreadyTracked: existing.map(brief),
      replyGuidance: `${added.length ? `Now tracking: ${added.map((h) => h.name).join(", ")}.` : ""} ${existing.length ? `Already tracked: ${existing.map((h) => h.name).join(", ")}.` : ""} Nothing was logged yet. In one short sentence, say how to log it (e.g. tell you when they've done it, or tap it in the Journal).`.trim(),
    },
    effects: {
      card: added.length
        ? { kind: "logged", mode: "habits", batchId, date: today, entries: [], habits: added.map(brief), replaced: [], newLibrary: { books: [], songs: [], habits: added.map((h) => h.id) }, pendingIds: [], undone: false }
        : null,
    },
  };
}

function updateBook(args, ctx) {
  const { state, commit, today, turnId, callId } = ctx;
  const book = findBook(state.books, args.title, args.author || "");
  if (!book) return fail(`No book called “${args.title}” is in the library.`, "Check the title against context.books, or use add_books to add it.");
  const sessions = completed(state.entries).filter((e) => e.type === "reading" && e.bookId === book.id);
  const sessionPages = sum(sessions, (e) => e.pages);
  const sessionChapters = sum(sessions, (e) => e.chapters);
  const updated = { ...book };
  const notes = [];
  const given = (v) => typeof v === "number" && Number.isFinite(v) && v >= 0;
  if (given(args.pagesRead)) {
    updated.startPages = Math.max(0, args.pagesRead - sessionPages);
    if (args.pagesRead < sessionPages) notes.push(`Logged sessions already add up to ${sessionPages} pages; edit a session to go lower.`);
  }
  if (given(args.chaptersRead)) {
    updated.startChapters = Math.max(0, args.chaptersRead - sessionChapters);
    if (args.chaptersRead < sessionChapters) notes.push(`Logged sessions already add up to ${sessionChapters} chapters; edit a session to go lower.`);
  }
  if (given(args.totalPages) && args.totalPages > 0) updated.totalPages = args.totalPages;
  if (given(args.totalChapters) && args.totalChapters > 0) updated.totalChapters = args.totalChapters;
  if (BOOK_STATUSES.includes(args.status)) updated.status = args.status;
  if (args.author && !book.author) updated.author = String(args.author).trim();
  const before = bookProgress(book, state.entries);
  const after = bookProgress(updated, state.entries);
  const changes = [
    ...describeProgress(before, after, updated),
    updated.totalPages !== book.totalPages ? `length ${book.totalPages || "—"} → ${updated.totalPages} pages` : null,
    updated.totalChapters !== book.totalChapters ? `length ${book.totalChapters || "—"} → ${updated.totalChapters} chapters` : null,
    updated.status !== book.status ? `status ${book.status} → ${updated.status}` : null,
    updated.author !== book.author ? `author → ${updated.author}` : null,
  ].filter(Boolean);
  if (!changes.length)
    return { result: { book: { title: book.title, ...before }, nothingChanged: true, note: `“${book.title}” already shows that, so nothing changed. Say so plainly.`, ...(notes.length ? { warnings: notes } : {}) }, effects: {} };
  try {
    commit((current) => validateState({ ...current, books: current.books.map((b) => (b.id === book.id ? updated : b)) }));
  } catch (error) {
    return fail(`Not updated: ${error.message}`);
  }
  const batchId = stableId(`${today}|${turnId}|${callId}`);
  const summary = { id: book.id, title: updated.title, author: updated.author, status: updated.status, pages: after.pages, totalPages: updated.totalPages, chapters: after.chapters, totalChapters: updated.totalChapters };
  return {
    result: { book: summary, changes, ...(notes.length ? { warnings: notes } : {}), replyGuidance: "Confirm the new position in one short sentence using these numbers." },
    effects: {
      card: { kind: "logged", mode: "book", batchId, date: today, entries: [], books: [{ id: book.id, title: updated.title, author: updated.author || null, status: updated.status }], changes, replaced: [], replacedBooks: [book], newLibrary: { books: [], songs: [], habits: [] }, pendingIds: [], undone: false },
    },
  };
}

function practicePlanTool(args, ctx) {
  const plan = buildPracticePlan(ctx.state, ctx.today);
  if (!ctx.state.songs.length)
    return { result: { items: [], note: "The user has no songs yet. Suggest telling you which songs they want to practice." }, effects: {} };
  const pct = (r) => (r === null || r === undefined ? null : Math.round(r * 100));
  const limit = Math.max(1, Math.min(10, Math.round(args.limit || 5)));
  return {
    result: {
      date: plan.date,
      model: MODEL_NAME,
      targetRetention: pct(TARGET_RETENTION),
      goalMinutes: plan.goalMinutes,
      minutesPracticedToday: plan.doneMinutes,
      minutesLeftToday: plan.remainingMinutes,
      goalMet: plan.goalMet,
      practiceToday: plan.items.slice(0, limit).map((i) =>
        i.done
          ? { title: i.title, artist: i.artist || null, practicedToday: true, minutesPracticed: i.minutesDone, sections: i.sections, onPlan: i.kind !== "extra" }
          : { title: i.title, artist: i.artist || null, minutes: i.minutes, optional: i.optional, why: i.reason, retentionPercent: pct(i.retention) },
      ),
      nextReviews: plan.upcoming.slice(0, limit).map((u) => ({ title: u.title, dueDate: u.dueDate, retentionPercent: pct(u.retention) })),
      songs: plan.stats.slice(0, 30).map((r) => ({
        title: r.song.title,
        status: r.song.status,
        sessions: r.sessions,
        lastRating: r.lastRating ? ratingLabel(r.lastRating) : null,
        retentionPercent: pct(r.retention),
        memoryStrengthDays: r.stability ? Math.round(r.stability) : null,
        next: dueLabel(r),
      })),
      replyGuidance: plan.goalMet
        ? "The app shows the plan as a card. The daily goal is already met: say so in one short sentence using minutesPracticedToday and goalMinutes. Don't push the optional songs; mention that spacing practice out builds longer-lasting memory."
        : plan.doneMinutes > 0
          ? "The app shows the plan as a card. In one or two short sentences, acknowledge what was already practiced today (minutesPracticedToday of goalMinutes) and name what's left, using only these numbers. Don't suggest the songs already practiced today."
          : "The app shows the plan as a card. In one or two short sentences, name what to start with and why, using only these numbers. Suggest rotating between the songs rather than finishing one before the next.",
    },
    effects: { card: { kind: "practice", date: plan.date, items: plan.items.slice(0, limit), upcoming: plan.upcoming.slice(0, 3), goalMinutes: plan.goalMinutes } },
  };
}

function listEntries(args, ctx) {
  let window;
  try {
    window = rangeDates(args.range, ctx.today, args.from, args.to);
  } catch (error) {
    return fail(error.message);
  }
  const rows = ctx.state.entries
    .filter(
      (e) =>
        e.date >= window.from &&
        e.date <= window.to &&
        (args.type === "all" || e.type === args.type),
    )
    .sort((a, b) => `${b.date} ${b.time}`.localeCompare(`${a.date} ${a.time}`))
    .slice(0, Math.min(30, Math.max(1, Math.floor(args.limit || 10))))
    .map((e) => ({ ...summarizeEntry(e, ctx.state), fields: entryFields(e, ctx.state) }));
  return {
    result: {
      from: window.from,
      to: window.to,
      count: rows.length,
      totalCompleted: completed(rows).length,
      entries: rows.map(({ estimated, ...row }) => row),
    },
    effects: {},
  };
}

function askUser(args) {
  const options = [...new Set(args.options.map((o) => o.trim()).filter(Boolean))].slice(0, 4);
  return {
    result: { asked: true },
    effects: {
      card: { kind: "question", question: args.question.trim(), options },
      stop: true,
    },
  };
}

function undoTool(args, ctx) {
  if (typeof ctx.latestUserText === "string" && ctx.latestUserText.trim() && !/\b(undo|revert|take (it|that|this) back|remove|delete|cancel|scrap|get rid of)\b/i.test(ctx.latestUserText))
    return fail("Not undone: the user didn't ask to undo anything.", "Use update_entry to change an entry.");
  const card = ctx.findBatch?.(args.batchId);
  if (!card) return fail("That batch was not found in this conversation.");
  if (card.undone) return { result: { removed: 0, note: "Already undone." }, effects: {} };
  try {
    ctx.commit((current) => undoBatch(current, card));
  } catch (error) {
    return fail(`Undo failed: ${error.message}`);
  }
  return {
    result: { removed: card.entries.length, restoredTotals: card.replaced.length },
    effects: { undoBatch: card.batchId },
  };
}

const EXECUTORS = {
  log_entries: logEntries,
  query_data: queryData,
  list_entries: listEntries,
  ask_user: askUser,
  update_entry: updateEntry,
  delete_entries: deleteEntries,
  undo_batch: undoTool,
  add_songs: addSongs,
  add_books: addBooks,
  add_habits: addHabits,
  update_book: updateBook,
  practice_plan: practicePlanTool,
};

/**
 * executeToolCall(call, ctx) → { result, effects }
 * ctx: { state, commit, today, now, logDate, turnId, userText, pending, findBatch, onNewBooks }
 */
export function executeToolCall(call, ctx) {
  const name = call?.function?.name;
  const executor = EXECUTORS[name];
  if (!executor) return fail(`Unknown tool “${name}”.`);
  let args;
  try {
    args = JSON.parse(call.function.arguments || "{}");
  } catch {
    return fail("The tool arguments were not valid JSON.", "Call the tool again with valid arguments.");
  }
  // Models without strict schemas may leave out newer fields: missing nullable ones are null.
  if (args && typeof args === "object") {
    const fields = extractionSchema.properties.entries.items.properties;
    for (const entry of name === "log_entries" && Array.isArray(args.entries) ? args.entries : name === "update_entry" && args.changes ? [args.changes] : [])
      if (entry && typeof entry === "object")
        for (const [key, spec] of Object.entries(fields))
          if (entry[key] === undefined && Array.isArray(spec.type) && spec.type.includes("null")) entry[key] = null;
  }
  // Models without strict schemas may leave out this flag; it defaults to a partial correction.
  if (name === "update_entry" && args && typeof args === "object" && args.replaceList === undefined) args.replaceList = false;
  try {
    assertSchema(args, TOOL_SCHEMAS[name], name);
  } catch (error) {
    return fail(`Invalid arguments: ${error.message}`, "Call the tool again with arguments that match its schema.");
  }
  try {
    return executor(args, { today: dateKey(), ...ctx, callId: call.id });
  } catch (error) {
    return fail(error.message || "The tool failed.");
  }
}
