export const TYPES = [
  "workout",
  "reading",
  "food",
  "guitar",
  "meditation",
  "dream",
  "screentime",
  "steps",
  "cardio",
  "habit",
  "sleep",
];
// Types the app no longer offers. Old entries of these types still load and can be deleted.
export const RETIRED_TYPES = ["work"];
export const LABELS = {
  workout: "Workout",
  reading: "Reading",
  work: "Work",
  food: "Food",
  guitar: "Guitar",
  meditation: "Meditation",
  dream: "Dream",
  screentime: "Screen time",
  steps: "Steps",
  cardio: "Cardio",
  habit: "Habit",
  sleep: "Sleep",
};
export const MUSCLES = [
  "chest",
  "upper-back",
  "lower-back",
  "trapezius",
  "front-deltoids",
  "back-deltoids",
  "biceps",
  "triceps",
  "forearm",
  "abs",
  "obliques",
  "quadriceps",
  "hamstring",
  "gluteal",
  "calves",
  "adductor",
  "abductors",
];
export const EXERCISES = [
  { name: "Bench press", muscle: "chest" },
  { name: "Incline dumbbell press", muscle: "chest" },
  { name: "Push-up", muscle: "chest" },
  { name: "Squat", muscle: "quadriceps" },
  { name: "Leg press", muscle: "quadriceps" },
  { name: "Romanian deadlift", muscle: "hamstring" },
  { name: "Deadlift", muscle: "lower-back" },
  { name: "Pull-up", muscle: "upper-back" },
  { name: "Lat pulldown", muscle: "upper-back" },
  { name: "Barbell row", muscle: "upper-back" },
  { name: "Overhead press", muscle: "front-deltoids" },
  { name: "Lateral raise", muscle: "front-deltoids" },
  { name: "Face pull", muscle: "back-deltoids" },
  { name: "Bicep curl", muscle: "biceps" },
  { name: "Tricep pushdown", muscle: "triceps" },
  { name: "Hip thrust", muscle: "gluteal" },
  { name: "Calf raise", muscle: "calves" },
  { name: "Crunch", muscle: "abs" },
  { name: "Leg extension", muscle: "quadriceps" },
  { name: "Hamstring curl", muscle: "hamstring" },
  { name: "Hip abduction", muscle: "abductors" },
  { name: "Hip adduction", muscle: "adductor" },
  { name: "Lunge", muscle: "quadriceps" },
  { name: "Plank", muscle: "abs" },
  { name: "Shrug", muscle: "trapezius" },
  { name: "Dip", muscle: "triceps" },
];
// Best-effort primary muscle from an exercise name; "" when unsure.
const MUSCLE_RULES = [
  [/abduct/, "abductors"],
  [/adduct/, "adductor"],
  [/hamstring|\bleg curls?\b|\blying curls?\b|\bseated curls?\b|\bnordic|\bgood ?mornings?\b/, "hamstring"],
  [/\bromanian\b|\brdls?\b|\bstiff.?leg/, "hamstring"],
  [/\bdeadlifts?\b/, "lower-back"],
  [/\bback extensions?\b|\bhyperextensions?\b/, "lower-back"],
  [/\bleg press|\bleg extensions?\b|\bsquats?\b|\blunges?\b|\bstep.?ups?\b|\bhack\b/, "quadriceps"],
  [/\bcalf\b|\bcalves\b/, "calves"],
  [/\bhip thrusts?\b|\bglutes?\b|\bbridges?\b|\bkickbacks?\b/, "gluteal"],
  [/\bshrugs?\b|\btraps?\b/, "trapezius"],
  [/\bface pulls?\b|\brear delts?\b|\breverse fl(y|ies|yes)\b/, "back-deltoids"],
  [/\blateral raises?\b|\boverhead press|\bshoulder press|\bmilitary\b|\barnold\b|\bfront raises?\b|\bupright rows?\b/, "front-deltoids"],
  [/\bpull.?ups?\b|\bchin.?ups?\b|\bpull.?downs?\b|\brows?\b|\blats?\b/, "upper-back"],
  [/\btriceps?\b|\bskull|\bpushdowns?\b|\bdips?\b|\bclose.?grip\b/, "triceps"],
  [/\bbiceps?\b|\bcurls?\b/, "biceps"],
  [/\bwrist|\bforearms?\b|\bfarmers?\b/, "forearm"],
  [/\bcrunch|\bplanks?\b|\bsit.?ups?\b|\babs?\b|\bleg raises?\b|\bhollow\b/, "abs"],
  [/\bobliques?\b|\brussian twists?\b|\bside planks?\b|\bwoodchop/, "obliques"],
  [/\bbench\b|\bpush.?ups?\b|\bchest\b|\bfl(y|ies|ye|yes)\b|\bpecs?\b|\bpec deck\b/, "chest"],
];
export function inferMuscle(name) {
  const text = ` ${String(name || "").toLowerCase()} `;
  const known = EXERCISES.find((e) => e.name.toLowerCase() === text.trim());
  if (known) return known.muscle;
  return MUSCLE_RULES.find(([pattern]) => pattern.test(text))?.[1] || "";
}
// Workouts saved by the assistant take the app's muscle for exercises it knows.
export function repairAssistantMuscles(state) {
  let changed = 0;
  const entries = state.entries.map((e) => {
    if (e.type !== "workout" || !e.sourceBatch || !Array.isArray(e.exercises)) return e;
    let touched = false;
    const exercises = e.exercises.map((x) => {
      const inferred = inferMuscle(x.name);
      if (!inferred || inferred === x.muscle) return x;
      touched = true;
      changed++;
      return { ...x, muscle: inferred };
    });
    return touched ? { ...e, exercises } : e;
  });
  return { state: changed ? { ...state, entries } : state, changed };
}
export const id = () =>
  typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
export function dateKey(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
export const parseDate = (key) => new Date(`${key}T12:00:00`);
// Until 4 am, what someone did "today" belongs to the day that just ended.
export const DAY_STARTS_AT_HOUR = 4;
export function loggingDay(now = new Date()) {
  const d = new Date(now);
  if (d.getHours() < DAY_STARTS_AT_HOUR) d.setDate(d.getDate() - 1);
  return dateKey(d);
}
export function shiftDate(key, n) {
  const d = parseDate(key);
  d.setDate(d.getDate() + n);
  return dateKey(d);
}
export function weekDates(key = dateKey()) {
  const d = parseDate(key);
  const monday = shiftDate(key, -((d.getDay() + 6) % 7));
  return Array.from({ length: 7 }, (_, i) => shiftDate(monday, i));
}
export function monthDates(key) {
  const d = parseDate(key);
  d.setDate(1);
  const first = weekDates(dateKey(d))[0];
  return Array.from({ length: 42 }, (_, i) => shiftDate(first, i));
}
export const fmtDate = (key, opts = { month: "short", day: "numeric" }) =>
  parseDate(key).toLocaleDateString("en-GB", opts);
export const num = (value) => Number(value) || 0;
export const sum = (items, fn) =>
  items.reduce((total, x) => total + num(fn(x)), 0);
export const pretty = (value) =>
  new Intl.NumberFormat("en-GB", { maximumFractionDigits: 1 }).format(value);
export const duration = (n) =>
  n >= 60 ? `${Math.floor(n / 60)}h${n % 60 ? ` ${n % 60}m` : ""}` : `${n} min`;
export function emptyState() {
  return {
    version: 1,
    profile: {
      name: "",
      workoutGoal: 4,
      readingGoal: 20,
      guitarGoal: 20,
      meditationGoal: 10,
      stepsGoal: 8000,
      screenGoal: 120,
      calorieGoal: 0,
      proteinGoal: 0,
    },
    entries: [],
    books: [],
    songs: [],
    habits: [],
    templates: [],
    favorites: [],
  };
}
export function completed(entries) {
  return entries.filter((e) => e.status !== "planned");
}
export function totals(entries) {
  const list = completed(entries);
  return {
    workouts: list.filter((e) => e.type === "workout").length,
    workoutMinutes: sum(
      list.filter((e) => e.type === "workout"),
      (e) => e.minutes,
    ),
    pages: sum(
      list.filter((e) => e.type === "reading"),
      (e) => e.pages,
    ),
    reading: sum(
      list.filter((e) => e.type === "reading"),
      (e) => e.minutes,
    ),
    guitar: sum(
      list.filter((e) => e.type === "guitar"),
      (e) => e.minutes,
    ),

    meditation: sum(
      list.filter((e) => e.type === "meditation"),
      (e) => e.minutes,
    ),
    dreams: list.filter((e) => e.type === "dream").length,
    cardio: sum(
      list.filter((e) => e.type === "cardio"),
      (e) => e.minutes,
    ),
    calories: sum(
      list.filter((e) => e.type === "food"),
      (e) => sum(e.items, (i) => i.calories * i.servings),
    ),
    protein: sum(
      list.filter((e) => e.type === "food"),
      (e) => sum(e.items, (i) => i.protein * i.servings),
    ),
    carbs: sum(
      list.filter((e) => e.type === "food"),
      (e) => sum(e.items, (i) => i.carbs * i.servings),
    ),
    fat: sum(
      list.filter((e) => e.type === "food"),
      (e) => sum(e.items, (i) => i.fat * i.servings),
    ),
    steps: sum(
      list.filter((e) => e.type === "steps"),
      (e) => e.steps,
    ),
    screentime: sum(
      list.filter((e) => e.type === "screentime"),
      (e) => e.minutes,
    ),
    sleep: sum(
      list.filter((e) => e.type === "sleep"),
      (e) => e.minutes,
    ),
  };
}
export const doneSets = (e) =>
  e.exercises?.flatMap((x) =>
    x.sets
      .filter((s) => s.done)
      .map((s) => ({ ...s, exercise: x.name, muscle: x.muscle })),
  ) || [];
export function trainingStats(entries) {
  const sets = completed(entries)
    .filter((e) => e.type === "workout")
    .flatMap(doneSets);
  return {
    sets: sets.length,
    volume: sum(sets, (s) => s.reps * s.weight),
    muscles: Object.fromEntries(
      MUSCLES.map((m) => [m, sets.filter((s) => s.muscle === m).length]),
    ),
  };
}
export function bookProgress(book, entries) {
  const logs = completed(entries).filter(
    (e) => e.type === "reading" && e.bookId === book.id,
  );
  const pages = num(book.startPages) + sum(logs, (e) => e.pages);
  const chapters = num(book.startChapters) + sum(logs, (e) => e.chapters);
  const percent = book.totalPages
    ? Math.min(100, (pages / book.totalPages) * 100)
    : book.totalChapters
      ? Math.min(100, (chapters / book.totalChapters) * 100)
      : 0;
  return {
    pages,
    chapters,
    percent,
    finished: book.status === "Finished" || percent >= 100,
  };
}
export const BOOK_STATUSES = ["Want to read", "Reading", "Paused", "Finished"];
// Book titles match whatever the punctuation, a leading article, or a subtitle
// ("psychology of money" is "The Psychology of Money: Timeless Lessons…").
export const bookKey = (title) =>
  String(title || "")
    .toLocaleLowerCase()
    .replace(/[:–—].*$/, "")
    .replace(/&/g, "and")
    .replace(/[^\p{L}\p{N} ]/gu, " ")
    .replace(/^\s*(the|a|an)\s+/, "")
    .replace(/\s+/g, " ")
    .trim();
export const personKey = (name) =>
  String(name || "")
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N} ]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
export const SONG_STATUSES = ["Want to learn", "Learning", "Can play slowly", "Performance ready"];
// How a practice session went; the rating feeds the song's review schedule (src/practice.js).
export const GUITAR_RATINGS = ["Couldn't play it", "Rough", "Solid", "Clean"];
export function entryTitle(e, state) {
  return (
    e.title ||
    (e.type === "reading"
      ? state.books.find((b) => b.id === e.bookId)?.title
      : e.type === "guitar"
        ? state.songs.find((s) => s.id === e.songId)?.title
        : e.type === "habit"
          ? state.habits.find((h) => h.id === e.habitId)?.name
          : null) ||
    LABELS[e.type]
  );
}
const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
export function entryDetail(e) {
  switch (e.type) {
    case "meditation":
      return `${duration(e.minutes)} · Quality ${e.quality}/5 · ${e.mood}`;
    case "dream":
      return `${e.mood} · Vividness ${e.quality}/5${e.lucid ? " · Lucid" : ""}`;
    case "workout":
      return [e.minutes ? duration(e.minutes) : null, plural(doneSets(e).length, "set"), plural(e.exercises.length, "exercise")]
        .filter(Boolean)
        .join(" · ");
    case "reading":
      return [
        e.pages && `${e.pages} pages`,
        e.chapters && `${e.chapters} chapters`,
        e.minutes && duration(e.minutes),
      ]
        .filter(Boolean)
        .join(" · ");
    case "food":
      return `${pretty(sum(e.items, (i) => i.calories * i.servings))} kcal · ${plural(e.items.length, "food")}`;
    case "steps":
      return `${pretty(e.steps)} steps`;
    case "guitar":
      return `${duration(e.minutes)}${Number.isInteger(e.quality) && GUITAR_RATINGS[e.quality - 1] ? ` · ${GUITAR_RATINGS[e.quality - 1]}` : ""}${e.bpm ? ` · ${e.bpm} BPM` : ""}${e.section ? ` · ${e.section}` : ""}`;
    case "cardio":
      return `${duration(e.minutes)}${e.distance ? ` · ${e.distance} km` : ""}`;
    case "habit":
      return `${e.value} ${e.unit || "times"}`;
    default:
      return duration(e.minutes);
  }
}
const validString = (v, max = 5000) => typeof v === "string" && v.length <= max;
const nonnegative = (v) =>
  typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 100000000;
export const validDate = (v) =>
  validString(v, 10) &&
  /^\d{4}-\d{2}-\d{2}$/.test(v) &&
  !Number.isNaN(+parseDate(v)) &&
  dateKey(parseDate(v)) === v;
export function validateEntry(e) {
  if (
    !e ||
    !validString(e.id, 100) ||
    !(TYPES.includes(e.type) || RETIRED_TYPES.includes(e.type)) ||
    !validDate(e.date) ||
    !/^([01]\d|2[0-3]):[0-5]\d$/.test(e.time) ||
    !["done", "planned"].includes(e.status)
  )
    throw Error("An entry has invalid date, time, or type.");
  for (const key of ["title", "notes", "section", "unit", "app", "mood"])
    if (e[key] !== undefined && !validString(e[key]))
      throw Error("Invalid entry text.");
  if (
    ["meditation", "dream"].includes(e.type) &&
    (!Number.isInteger(e.quality) || e.quality < 1 || e.quality > 5)
  )
    throw Error("Choose a rating from 1 to 5.");
  if (
    e.type === "meditation" &&
    (!nonnegative(e.minutes) || e.minutes < 1 || e.minutes > 1440)
  )
    throw Error("Enter meditation time between 1 and 1,440 minutes.");
  if (
    e.type === "dream" &&
    (!validString(e.notes) || !e.notes.trim() || typeof e.lucid !== "boolean")
  )
    throw Error("Write something about your dream.");
  for (const key of [
    "minutes",
    "pages",
    "chapters",
    "steps",
    "bpm",
    "value",
    "distance",
  ])
    if (e[key] !== undefined && !nonnegative(e[key]))
      throw Error("Entry values must be finite, positive numbers or zero.");
  if (
    e.type === "workout" &&
    (!Array.isArray(e.exercises) ||
      e.exercises.length < 1 ||
      e.exercises.length > 100 ||
      e.exercises.some(
        (x) =>
          !validString(x.name, 200) ||
          !x.name.trim() ||
          !MUSCLES.includes(x.muscle) ||
          !Array.isArray(x.sets) ||
          !x.sets.length ||
          x.sets.length > 100 ||
          x.sets.some(
            (s) =>
              !nonnegative(s.weight) ||
              !nonnegative(s.reps) ||
              s.reps < 1 ||
              !Number.isInteger(s.reps) ||
              typeof s.done !== "boolean",
          ),
      ))
  )
    throw Error("Every exercise needs a name and valid sets.");
  if (
    e.type === "food" &&
    (!Array.isArray(e.items) ||
      !e.items.length ||
      e.items.length > 100 ||
      e.items.some(
        (i) =>
          !validString(i.name, 200) ||
          !i.name.trim() ||
          !["calories", "protein", "carbs", "fat", "servings"].every((k) =>
            nonnegative(i[k]),
          ) ||
          i.servings <= 0,
      ))
  )
    throw Error(
      "Every food needs a name, serving size, and valid nutrition values.",
    );
  if (
    ["workout", "guitar", "cardio", "sleep", "screentime", ...RETIRED_TYPES].includes(e.type) &&
    (!nonnegative(e.minutes) || e.minutes > 1440)
  )
    throw Error("Enter a duration between 0 and 1,440 minutes.");
  if (
    e.type === "reading" &&
    (!validString(e.bookId, 100) ||
      !["pages", "chapters", "minutes"].every((k) => nonnegative(e[k])))
  )
    throw Error("Choose a book and enter reading progress.");
  if (
    e.type === "steps" &&
    (!nonnegative(e.steps) || !Number.isInteger(e.steps))
  )
    throw Error("Enter a whole number of steps.");
  if (
    e.type === "habit" &&
    (!validString(e.habitId, 100) || !nonnegative(e.value))
  )
    throw Error("Choose a habit and enter a value.");
  return e;
}
export function validateState(data) {
  if (
    !data ||
    data.version !== 1 ||
    !data.profile ||
    !validString(data.profile.name, 100)
  )
    throw Error("This is not a supported Daybook backup.");
  for (const k of [
    "workoutGoal",
    "readingGoal",
    "guitarGoal",
    "stepsGoal",
    "screenGoal",
    "calorieGoal",
    "proteinGoal",
  ])
    if (!nonnegative(data.profile[k])) throw Error("Invalid goals in backup.");
  if (
    data.profile.meditationGoal !== undefined &&
    !nonnegative(data.profile.meditationGoal)
  )
    throw Error("Invalid meditation goal.");
  if (
    data.profile.dailyTrackers !== undefined &&
    (!Array.isArray(data.profile.dailyTrackers) || data.profile.dailyTrackers.some((t) => !TYPES.includes(t) && !RETIRED_TYPES.includes(t)))
  )
    throw Error("Invalid daily trackers.");
  for (const key of [
    "entries",
    "books",
    "songs",
    "habits",
    "templates",
    "favorites",
  ]) {
    if (!Array.isArray(data[key]) || data[key].length > 100000)
      throw Error("Incomplete backup.");
    if (
      data[key].some((v) => !v || !validString(v.id, 100)) ||
      new Set(data[key].map((v) => v.id)).size !== data[key].length
    )
      throw Error("Backup has invalid or duplicate records.");
  }
  for (const b of data.books)
    if (
      !validString(b.title, 300) ||
      !validString(b.author, 300) ||
      !["totalPages", "totalChapters", "startPages", "startChapters"].every(
        (k) => nonnegative(b[k]),
      ) ||
      !BOOK_STATUSES.includes(b.status) ||
      !validString(b.cover, 2000) ||
      (b.cover && !/^https:\/\//.test(b.cover))
    )
      throw Error("Invalid book in backup.");
  for (const s of data.songs)
    if (
      !validString(s.title, 300) ||
      !validString(s.artist, 300) ||
      !nonnegative(s.targetBpm) ||
      !SONG_STATUSES.includes(s.status) ||
      (s.cover !== undefined && (!validString(s.cover, 2000) || (s.cover && !/^https:\/\//.test(s.cover)))) ||
      (s.added !== undefined && s.added !== "" && !validDate(s.added))
    )
      throw Error("Invalid song in backup.");
  for (const h of data.habits)
    if (
      !validString(h.name, 200) ||
      !validString(h.unit, 50) ||
      !nonnegative(h.goal)
    )
      throw Error("Invalid habit in backup.");
  for (const e of data.entries) {
    validateEntry(e);
    if (
      (e.type === "reading" && !data.books.some((b) => b.id === e.bookId)) ||
      (e.type === "guitar" &&
        e.songId &&
        !data.songs.some((s) => s.id === e.songId)) ||
      (e.type === "habit" && !data.habits.some((h) => h.id === e.habitId))
    )
      throw Error("Backup has an entry without its book, song, or habit.");
  }
  for (const t of data.templates)
    validateEntry({
      ...t,
      type: "workout",
      date: "2026-01-01",
      time: "12:00",
      status: "planned",
    });
  for (const f of data.favorites)
    validateEntry({
      ...f,
      type: "food",
      date: "2026-01-01",
      time: "12:00",
      status: "done",
    });
  return { ...data, profile: { meditationGoal: 10, ...data.profile } };
}
export function upsertEntry(state, entry) {
  validateEntry(entry);
  // Steps and screen time are daily totals: editing or re-logging replaces that day.
  const entries = state.entries.filter(
    (e) =>
      e.id !== entry.id &&
      !(
        ["steps", "screentime"].includes(entry.type) &&
        e.type === entry.type &&
        e.date === entry.date &&
        e.status === entry.status
      ),
  );
  return { ...state, entries: [...entries, entry] };
}
export function reviewText(state, key = dateKey()) {
  const days = weekDates(key);
  const logs = state.entries.filter((e) => days.includes(e.date));
  const t = totals(logs);
  const active = new Set(completed(logs).map((e) => e.date)).size;
  return `This week, you logged activity on ${active} ${active === 1 ? "day" : "days"}.\n\nTraining: ${t.workouts} of ${state.profile.workoutGoal} workouts, ${t.cardio} minutes of cardio, and ${pretty(t.steps)} logged steps.\nReading: ${t.pages} pages across ${t.reading} minutes.\nGuitar: ${t.guitar} minutes of practice.\nMind: ${t.meditation} minutes of meditation and ${t.dreams} dreams recorded.\nFood: ${pretty(t.calories)} kcal recorded across ${completed(logs).filter((e) => e.type === "food").length} meals.\n\n${active ? "These totals reflect only what you recorded. Missing entries are not zero-activity days." : "Start with one entry today. Your review will grow with your logs."}`;
}
