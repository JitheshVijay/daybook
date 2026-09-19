import {
  TYPES,
  MUSCLES,
  validDate,
  validateEntry,
  validateState,
  upsertEntry,
  id,
  dateKey,
  inferMuscle,
  bookKey,
  personKey,
} from "./domain.js";

const text = (maxLength = 5000) => ({ type: "string", maxLength });
const optionalText = (maxLength = 300) => ({
  type: ["string", "null"],
  maxLength,
});
const number = (max = 1000000) => ({
  type: ["number", "null"],
  minimum: 0,
  maximum: max,
});
const object = (properties) => ({
  type: "object",
  properties,
  required: Object.keys(properties),
  additionalProperties: false,
});
const list = (items, maxItems = 50) => ({ type: "array", items, maxItems });
export const extractionSchema = object({
  message: text(),
  entries: list(
    object({
      type: { type: "string", enum: TYPES },
      date: optionalText(40),
      time: optionalText(20),
      endTime: optionalText(20),
      status: { type: "string", enum: ["done", "planned"] },
      title: text(200),
      notes: text(),
      source: text(2000),
      questions: list(text(500), 10),
      minutes: number(1440),
      pages: number(100000),
      chapters: number(10000),
      fromPage: number(100000),
      toPage: number(100000),
      chaptersFinished: number(10000),
      steps: number(1000000),
      distance: number(10000),
      bpm: number(400),
      value: number(),
      quality: number(5),
      mood: optionalText(100),
      lucid: { type: ["boolean", "null"] },
      section: optionalText(),
      bookTitle: optionalText(),
      author: optionalText(),
      totalPages: number(),
      totalChapters: number(),
      songTitle: optionalText(),
      artist: optionalText(),
      habitName: optionalText(200),
      unit: optionalText(50),
      exercises: list(
        object({
          name: text(200),
          muscle: { type: ["string", "null"], enum: [...MUSCLES, null] },
          sets: list(
            object({
              weight: number(2000),
              reps: number(10000),
              done: { type: "boolean" },
            }),
            100,
          ),
        }),
        100,
      ),
      items: list(
        object({
          name: text(200),
          servings: number(1000),
          calories: number(100000),
          protein: number(10000),
          carbs: number(10000),
          fat: number(10000),
          estimated: { type: "boolean" },
          estimateNote: text(500),
        }),
        100,
      ),
    }),
    50,
  ),
});

// Validate model output independently of the provider's schema enforcement.
export function assertSchema(
  value,
  schema = extractionSchema,
  path = "response",
) {
  const types = Array.isArray(schema.type) ? schema.type : [schema.type];
  const type =
    value === null ? "null" : Array.isArray(value) ? "array" : typeof value;
  if (!types.includes(type)) throw Error(`Invalid ${path}.`);
  if (schema.enum && !schema.enum.includes(value))
    throw Error(`Invalid ${path}.`);
  if (type === "null") return value;
  if (
    type === "number" &&
    (!Number.isFinite(value) ||
      value < schema.minimum ||
      value > schema.maximum)
  )
    throw Error(`Invalid ${path}.`);
  if (type === "string" && value.length > schema.maxLength)
    throw Error(`Too much text in ${path}.`);
  if (type === "array") {
    if (value.length > schema.maxItems)
      throw Error(`Too many items in ${path}.`);
    value.forEach((v, i) => assertSchema(v, schema.items, `${path}[${i}]`));
  }
  if (type === "object") {
    if (
      Object.keys(value).some((k) => !(k in schema.properties)) ||
      schema.required.some((k) => !(k in value))
    )
      throw Error(`Incomplete ${path}.`);
    for (const [k, s] of Object.entries(schema.properties))
      assertSchema(value[k], s, `${path}.${k}`);
  }
  return value;
}
const normalized = (s) =>
  (s || "").trim().toLocaleLowerCase().replace(/\s+/g, " ");
function findNamed(
  records,
  name,
  field = "title",
  author = "",
  authorField = "author",
) {
  const candidates = records.filter(
    (r) => normalized(r[field]) === normalized(name),
  );
  const exact = author
    ? candidates.filter(
        (r) => normalized(r[authorField]) === normalized(author),
      )
    : candidates;
  return exact.length === 1 ? exact[0] : null;
}
// A song by title, matching the artist when both have one ("Neon" saved earlier without an artist
// is the same song as John Mayer's "Neon").
// A book by title (loosely) and author when both have one.
export function findBook(books, title, author = "") {
  const named = books.filter((b) => bookKey(b.title) === bookKey(title));
  if (!author) return named.length === 1 ? named[0] : named.find((b) => !b.author) || null;
  return named.find((b) => personKey(b.author) === personKey(author)) || (named.filter((b) => !b.author).length === 1 ? named.find((b) => !b.author) : null);
}
export function findSong(songs, title, artist = "") {
  const named = songs.filter((s) => normalized(s.title) === normalized(title));
  if (!artist) return named.length === 1 ? named[0] : named.find((s) => !s.artist) || null;
  return named.find((s) => normalized(s.artist) === normalized(artist)) || (named.filter((s) => !s.artist).length === 1 ? named.find((s) => !s.artist) : null);
}
// Minutes from a start to an end time ("03:00" → "08:40" is 340); past midnight wraps to the next day.
export function minutesBetween(start, end) {
  const toMinutes = (t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
  if (!/^\d{2}:\d{2}$/.test(start || "") || !/^\d{2}:\d{2}$/.test(end || "")) return 0;
  let diff = toMinutes(end) - toMinutes(start);
  if (diff <= 0) diff += 1440;
  return diff > 0 && diff < 1440 ? diff : 0;
}
// Models write times and dates in many ways; keep the intent, not the format.
export function normalizeTime(value) {
  if (typeof value !== "string") return "";
  const text = value.trim().toLowerCase();
  if (!text) return "";
  if (text === "noon" || text === "midday") return "12:00";
  if (text === "midnight") return "00:00";
  const match = text.match(
    /^(\d{1,2})(?::(\d{2}))?(?::\d{2})?\s*(a\.?m\.?|p\.?m\.?)?$/,
  );
  if (!match) return "";
  let hours = Number(match[1]);
  const minutes = Number(match[2] || 0);
  const suffix = match[3]?.[0];
  if (suffix === "p" && hours < 12) hours += 12;
  if (suffix === "a" && hours === 12) hours = 0;
  if (hours > 23 || minutes > 59) return "";
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}
export function normalizeDate(value) {
  if (typeof value !== "string" || !value.trim()) return "";
  if (validDate(value)) return value;
  const parsed = new Date(value);
  if (Number.isNaN(+parsed)) return "";
  const key = dateKey(parsed);
  return validDate(key) ? key : "";
}
// Workouts and meals are made of parts (exercises, foods). A part can be complete
// while its siblings still need details, so the app can save what it knows.
export const PART_KEY = { workout: "exercises", food: "items" };
const firstUpper = (text) => (text ? text[0].toUpperCase() + text.slice(1) : text);
const blank = (v) => v === "" || v === null || v === undefined;

export function partQuestion(type, part) {
  const name = firstUpper(String(part.name || "").trim()) || (type === "workout" ? "One exercise" : "One food");
  if (type === "workout") {
    const needs = [];
    if (!part.sets?.length) needs.push("how many sets and reps, at what weight");
    else {
      const reps = part.sets.some((s) => blank(s.reps));
      const weight = part.sets.some((s) => blank(s.weight));
      if (reps && weight) needs.push(part.sets.length > 1 ? "reps and weight for each set" : "reps and weight");
      else if (reps) needs.push(part.sets.length > 1 ? "how many reps in each set" : "how many reps");
      else if (weight) needs.push(part.sets.length > 1 ? "the weight for each set (0 kg for bodyweight)" : "what weight (0 kg for bodyweight)");
    }
    if (!part.muscle) needs.push("which muscle it mainly works");
    return needs.length ? `${name}: ${needs.join(", and ")}?` : "";
  }
  if (blank(part.servings) && blank(part.calories)) return `${name}: roughly how much did you have?`;
  if (blank(part.calories)) return `${name}: about how many calories?`;
  if (blank(part.servings) || !(part.servings > 0)) return `${name}: how much did you have?`;
  return "";
}
export const isPartComplete = (type, part) => !partQuestion(type, part);
export function partQuestions(entry) {
  const key = PART_KEY[entry.type];
  if (!key) return [];
  const parts = entry[key] || [];
  if (!parts.length) return [entry.type === "workout" ? "Which exercises did you do, with sets, reps and weight?" : "What did you eat?"];
  return parts.map((part) => partQuestion(entry.type, part)).filter(Boolean);
}

export function prepareImport(
  payload,
  state,
  { date, time, batchId, untraced = [] },
) {
  assertSchema(payload);
  if (!validDate(date) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time) || !batchId)
    throw Error("Invalid logging date or batch.");
  const libraries = {
    books: [...state.books],
    songs: [...state.songs],
    habits: [...state.habits],
  };
  const newIds = [];
  const drafts = payload.entries.map((raw, index) => {
    const warnings = [],
      missing = [];
    const entryDate = normalizeDate(raw.date),
      entryTime = normalizeTime(raw.time);
    const entry = {
      id: `ai-${batchId}-${index}`,
      type: raw.type,
      date: entryDate || date,
      time: entryTime || time,
      status: raw.status,
      title: raw.title,
      notes: raw.notes,
      sourceBatch: batchId,
      sourceItem: index,
      minutes: raw.minutes ?? 0,
      pages: raw.pages ?? 0,
      chapters: raw.chapters ?? 0,
      steps: raw.steps ?? 0,
      distance: raw.distance ?? 0,
      bpm: raw.bpm ?? 0,
      value: raw.value ?? 0,
      quality:
        raw.type === "guitar"
          ? Number.isInteger(raw.quality) && raw.quality >= 1
            ? Math.min(4, raw.quality)
            : ""
          : raw.quality ?? "",
      mood: raw.mood || "Neutral",
      lucid: raw.lucid ?? false,
      section: raw.section || "",
      unit: raw.unit || "",
      bookId: "",
      songId: "",
      habitId: "",
      exercises: [],
      items: [],
    };
    // With a start and an end time, the app works out the duration (the model doesn't do the maths).
    const endTime = normalizeTime(raw.endTime);
    const spanned = entryTime && endTime ? minutesBetween(entryTime, endTime) : 0;
    if (spanned && ["sleep", "meditation", "guitar", "cardio", "workout", "reading", "screentime"].includes(raw.type)) {
      entry.minutes = spanned;
      warnings.push(`Duration worked out from ${entryTime} to ${endTime}.`);
    }
    if (!raw.time)
      warnings.push(`Time wasn’t mentioned; using ${time} (logging time).`);
    else if (!entryTime)
      warnings.push(
        `Time “${raw.time}” wasn’t understood; using ${time} (logging time).`,
      );
    if (raw.date && !entryDate)
      warnings.push(`Date “${raw.date}” wasn’t understood; using ${date}.`);
    if (untraced.includes(index))
      warnings.push(
        "The assistant’s quote for this entry doesn’t match your paragraph word for word. Check it against what you wrote.",
      );
    if (!raw.mood && ["dream", "meditation"].includes(raw.type))
      warnings.push("Mood wasn’t mentioned; left as Neutral.");
    if (raw.type === "reading") {
      if (!raw.bookTitle) missing.push("Which book did you read?");
      else {
        let book = findBook(libraries.books, raw.bookTitle, raw.author);
        if (book && raw.author && !book.author) {
          const named = { ...book, author: raw.author };
          libraries.books = libraries.books.map((b) => (b.id === book.id ? named : b));
          book = named;
        }
        if (!book) {
          book = {
            id: id(),
            title: raw.bookTitle,
            author: raw.author || "",
            totalPages: raw.totalPages || 0,
            totalChapters: raw.totalChapters || 0,
            startPages: 0,
            startChapters: 0,
            cover: "",
            status: "Reading",
          };
          libraries.books.push(book);
          newIds.push(book.id);
          warnings.push(
            `Adds “${book.title}” to your library. A matching cover will be looked up after saving; you can check the edition and book length in Reading.`,
          );
        }
        entry.bookId = book.id;
      }
      if (!entry.pages && !entry.chapters && !entry.minutes)
        missing.push("How many pages, chapters, or minutes did you read?");
    }
    if (raw.type === "guitar" && raw.songTitle) {
      let song = findSong(libraries.songs, raw.songTitle, raw.artist);
      if (song && raw.artist && !song.artist) {
        // A song saved without its artist gets it now.
        const named = { ...song, artist: raw.artist };
        libraries.songs = libraries.songs.map((s) => (s.id === song.id ? named : s));
        song = named;
      }
      if (!song) {
        song = {
          id: id(),
          title: raw.songTitle,
          artist: raw.artist || "",
          targetBpm: 0,
          status: "Learning",
          cover: "",
          added: date,
        };
        libraries.songs.push(song);
        newIds.push(song.id);
        warnings.push(`Adds “${song.title}” to your setlist.`);
      }
      entry.songId = song.id;
    }
    if (raw.type === "habit") {
      if (!raw.habitName) missing.push("What habit did you track?");
      else {
        let habit = findNamed(libraries.habits, raw.habitName, "name");
        if (!habit) {
          habit = {
            id: id(),
            name: raw.habitName,
            unit: raw.unit || "times",
            goal: !raw.unit || raw.unit === "times" ? 1 : 0,
          };
          libraries.habits.push(habit);
          newIds.push(habit.id);
          warnings.push(`Creates the habit “${habit.name}”.`);
        }
        entry.habitId = habit.id;
        entry.unit = habit.unit;
      }
      if (raw.value === null)
        missing.push("How much of this habit did you complete?");
    }
    if (raw.type === "workout") {
      let repeated = false;
      entry.exercises = raw.exercises.map((x) => {
        let previous = null;
        return {
          name: x.name,
          // Known exercises use the app's muscle; the model's pick is a fallback.
          muscle: inferMuscle(x.name) || x.muscle,
          sets: x.sets.map((s) => {
            let set = {
              weight: s.weight ?? "",
              reps: s.reps ?? "",
              done: s.done,
            };
            // "3 sets of 10 at 40kg" sometimes arrives as one filled set and blanks.
            if (set.weight === "" && set.reps === "" && previous) {
              set = { ...previous };
              repeated = true;
            }
            if (set.weight !== "" && set.reps !== "") previous = set;
            return set;
          }),
        };
      });
      if (repeated)
        warnings.push(
          "Some sets came back blank and were filled from the previous set; check them.",
        );
      missing.push(...partQuestions(entry));
    }
    if (raw.type === "food") {
      entry.items = raw.items.map((i) => ({
        ...i,
        servings: i.servings ?? "",
        calories: i.calories ?? "",
        protein: i.protein ?? 0,
        carbs: i.carbs ?? 0,
        fat: i.fat ?? 0,
      }));
      missing.push(...partQuestions(entry));
      if (raw.items.some((i) => [i.protein, i.carbs, i.fat].includes(null)))
        warnings.push("Unspecified macros contribute 0 to the macro totals.");
      if (raw.items.some((i) => i.estimated)) {
        entry.nutritionEstimated = true;
        warnings.push(
          "Nutrition includes estimates. " +
            raw.items
              .filter((i) => i.estimated)
              .map((i) => i.estimateNote)
              .filter(Boolean)
              .join(" "),
        );
        entry.notes = [
          entry.notes,
          "Nutrition estimate: " +
            raw.items
              .filter((i) => i.estimated)
              .map((i) => `${i.name}: ${i.estimateNote}`)
              .join("; "),
        ]
          .filter(Boolean)
          .join("\n");
      }
    }
    // Workouts are defined by their sets; a session length is optional.
    if (
      ["guitar", "cardio", "sleep", "meditation"].includes(raw.type) &&
      !entry.minutes
    )
      missing.push("How long did it last, in minutes?");
    if (["meditation", "dream"].includes(raw.type) && raw.quality === null)
      missing.push(
        raw.type === "dream"
          ? "Rate dream vividness from 1 to 5."
          : "Rate meditation quality from 1 to 5.",
      );
    if (raw.type === "steps" && raw.steps === null)
      missing.push("What was your step total?");
    if (raw.type === "screentime" && raw.minutes === null)
      missing.push("What was your total screen time for the day?");
    if (raw.type === "dream" && !entry.notes.trim())
      missing.push("What do you remember from the dream?");
    const questions = [...new Set([...missing, ...raw.questions])];
    return {
      entry,
      source: raw.source,
      warnings,
      questions,
      included: true,
      reviewed: false,
    };
  });
  return { batchId, message: payload.message, drafts, libraries, newIds };
}
export function draftIssues(draft, today) {
  const issues = draft.reviewed ? [] : [...draft.questions];
  try {
    validateEntry(draft.entry);
  } catch (e) {
    issues.push(e.message);
  }
  if (draft.entry.status === "done" && draft.entry.date > today)
    issues.push("A future activity must be marked Planned.");
  return [...new Set(issues)];
}
export function importCollision(entry, state) {
  if (state.entries.some((e) => e.id === entry.id))
    return "This entry was already saved from this paragraph.";
  if (
    ["steps", "screentime"].includes(entry.type) &&
    state.entries.some(
      (e) =>
        e.type === entry.type &&
        e.date === entry.date &&
        e.status === entry.status,
    )
  )
    return "This replaces the existing daily total for this date.";
  const relevant = [
    "type",
    "date",
    "status",
    "title",
    "minutes",
    "pages",
    "chapters",
    "bookId",
    "songId",
    "steps",
    "bpm",
    "section",
    "quality",
    "notes",
  ];
  const same = state.entries.find((e) =>
    relevant.every((k) => (e[k] ?? "") === (entry[k] ?? "")),
  );
  return same
    ? "A similar entry already exists. Check that this is a separate activity."
    : "";
}
export function applyImport(state, batch, today, { replace = false } = {}) {
  const selected = batch.drafts.filter((d) => d.included);
  if (!selected.length) throw Error("Select at least one entry to save.");
  // replace: true lets a draft overwrite an existing entry with the same id (edits).
  const newDrafts = replace
    ? selected
    : selected.filter((d) => !state.entries.some((e) => e.id === d.entry.id));
  const dailyKeys = new Set();
  for (const d of newDrafts) {
    if (["steps", "screentime"].includes(d.entry.type)) {
      const key = `${d.entry.type}:${d.entry.date}:${d.entry.status}`;
      if (dailyKeys.has(key))
        throw Error("Select only one daily total per tracker and date.");
      dailyKeys.add(key);
    }
  }
  if (!newDrafts.length) throw Error("These entries have already been saved.");
  for (const d of newDrafts) {
    const issues = draftIssues(d, today);
    if (issues.length) throw Error(issues[0]);
  }
  let next = { ...state };
  const remap = new Map();
  for (const [collection, key, nameKey, authorKey] of [
    ["books", "bookId", "title", "author"],
    ["songs", "songId", "title", "artist"],
    ["habits", "habitId", "name", null],
  ]) {
    next[collection] = [...state[collection]];
    for (const d of newDrafts) {
      const reference = d.entry[key];
      if (!reference || next[collection].some((x) => x.id === reference))
        continue;
      const item = batch.libraries[collection].find((x) => x.id === reference);
      if (!item)
        throw Error(
          "A linked book, song, or habit is missing. Extract the paragraph again.",
        );
      const existing = findNamed(
        next[collection],
        item[nameKey],
        nameKey,
        authorKey ? item[authorKey] : "",
        authorKey || "author",
      );
      if (existing) remap.set(reference, existing.id);
      else next[collection].push(item);
    }
  }
  // An existing book or song this message named with its author or artist keeps it.
  next.books = next.books.map((book) => {
    const named = batch.libraries.books.find((x) => x.id === book.id);
    return named && !book.author && named.author && newDrafts.some((d) => d.entry.bookId === book.id)
      ? { ...book, author: named.author }
      : book;
  });
  next.songs = next.songs.map((song) => {
    const named = batch.libraries.songs.find((x) => x.id === song.id);
    return named && !song.artist && named.artist && newDrafts.some((d) => d.entry.songId === song.id)
      ? { ...song, artist: named.artist }
      : song;
  });
  for (const d of newDrafts) {
    const entry = { ...d.entry };
    for (const key of ["bookId", "songId", "habitId"])
      if (remap.has(entry[key])) entry[key] = remap.get(entry[key]);
    next = upsertEntry(next, entry);
    // Starting something from a wishlist moves it along.
    if (entry.status === "done") {
      next.books = next.books.map((b) => (b.id === entry.bookId && b.status === "Want to read" ? { ...b, status: "Reading" } : b));
      next.songs = next.songs.map((s) => (s.id === entry.songId && s.status === "Want to learn" ? { ...s, status: "Learning" } : s));
    }
  }
  return validateState(next);
}
