import { test } from "node:test";
import assert from "node:assert/strict";
import { emptyState, totals, bookProgress } from "../src/domain.js";
import {
  extractionSchema,
  assertSchema,
  prepareImport,
  applyImport,
  draftIssues,
  normalizeTime,
  normalizeDate,
} from "../src/day-import.js";
import { traced } from "../src/grounding.js";
import { fillBookCovers } from "../src/book-covers.js";
export function rawEntry(type, values = {}) {
  const properties = extractionSchema.properties.entries.items.properties;
  const base = Object.fromEntries(
    Object.entries(properties).map(([key, s]) => [
      key,
      Array.isArray(s.type) && s.type.includes("null")
        ? null
        : s.type === "array"
          ? []
          : s.type === "boolean"
            ? false
            : "",
    ]),
  );
  return { ...base, type, status: "done", source: "My day", ...values };
}
const prepare = (entries, state = emptyState(), batchId = "batch") =>
  prepareImport({ message: "Your day", entries }, state, {
    date: "2026-09-12",
    time: "22:00",
    batchId,
  });
const workout = () =>
  rawEntry("workout", {
    title: "Gym",
    minutes: 45,
    exercises: [
      {
        name: "Bench press",
        muscle: "chest",
        sets: [{ weight: 40, reps: 10, done: true }],
      },
    ],
  });
test("one batch routes eleven activity types and creates only required library records", () => {
  const entries = [
    workout(),
    rawEntry("reading", {
      bookTitle: "Deep Work",
      pages: 20,
      minutes: 30,
      totalPages: 200,
    }),
    rawEntry("guitar", { songTitle: "Blackbird", minutes: 20, bpm: 80 }),
    rawEntry("food", {
      title: "Breakfast",
      items: [
        {
          name: "Eggs",
          servings: 2,
          calories: 75,
          protein: 6,
          carbs: 0,
          fat: 5,
          estimated: true,
          estimateNote: "Approximate for one large egg",
        },
      ],
    }),
    rawEntry("steps", { steps: 8000 }),
    rawEntry("screentime", { minutes: 120 }),
    rawEntry("cardio", { title: "Walk", minutes: 25, distance: 2 }),
    rawEntry("sleep", { minutes: 480 }),
    rawEntry("meditation", { minutes: 10, quality: 4, mood: "Calm" }),
    rawEntry("dream", {
      title: "Ocean",
      notes: "A blue ocean",
      quality: 4,
      lucid: true,
    }),
    rawEntry("habit", { habitName: "Water", unit: "glasses", value: 8 }),
  ];
  const original = emptyState(),
    batch = prepare(entries, original);
  assert.equal(original.entries.length, 0);
  assert.equal(original.books.length, 0);
  const next = applyImport(original, batch, "2026-09-12");
  assert.equal(next.entries.length, 11);
  assert.equal(next.books[0].title, "Deep Work");
  assert.equal(next.songs[0].title, "Blackbird");
  assert.equal(next.habits[0].name, "Water");
  assert.equal(totals(next.entries).calories, 150);
  assert.equal(totals(next.entries).meditation, 10);
  assert.equal(bookProgress(next.books[0], next.entries).pages, 20);
  assert.equal(
    next.entries.find((e) => e.type === "food").nutritionEstimated,
    true,
  );
});
test("missing personal values block batch save; state is unchanged", () => {
  const original = emptyState(),
    batch = prepare(
      [workout(), rawEntry("meditation", { minutes: 10 })],
      original,
    );
  assert.ok(draftIssues(batch.drafts[1], "2026-09-12").length);
  assert.throws(() => applyImport(original, batch, "2026-09-12"));
  assert.equal(original.entries.length, 0);
  batch.drafts[1].included = false;
  assert.equal(applyImport(original, batch, "2026-09-12").entries.length, 1);
});
test("batch is idempotent, partial save works and existing library names are reused", () => {
  let state = emptyState();
  state.books = [
    {
      id: "existing",
      title: "Deep Work",
      author: "",
      totalPages: 100,
      totalChapters: 0,
      startPages: 0,
      startChapters: 0,
      cover: "",
      status: "Reading",
    },
  ];
  let batch = prepare(
    [rawEntry("reading", { bookTitle: "deep work", pages: 20 }), workout()],
    state,
  );
  assert.equal(batch.drafts[0].entry.bookId, "existing");
  batch.drafts[1].included = false;
  state = applyImport(state, batch, "2026-09-12");
  assert.equal(state.books.length, 1);
  assert.throws(() => applyImport(state, batch, "2026-09-12"), /already/);
  batch.drafts[1].included = true;
  state = applyImport(state, batch, "2026-09-12");
  assert.equal(state.entries.length, 2);
});
test("unselected drafts create no orphan books or songs", () => {
  const batch = prepare([
    workout(),
    rawEntry("reading", { bookTitle: "Skip this", pages: 5 }),
  ]);
  batch.drafts[1].included = false;
  assert.equal(applyImport(emptyState(), batch, "2026-09-12").books.length, 0);
});
test("plans excluded from totals; conflicting daily totals cannot silently overwrite", () => {
  const batch = prepare([
    rawEntry("steps", { steps: 1000, status: "planned", date: "2026-09-13" }),
  ]);
  const next = applyImport(emptyState(), batch, "2026-09-12");
  assert.equal(totals(next.entries).steps, 0);
  assert.throws(
    () =>
      applyImport(
        emptyState(),
        prepare([
          rawEntry("steps", { steps: 1000 }),
          rawEntry("steps", { steps: 2000 }),
        ]),
        "2026-09-12",
      ),
    /only one daily total/,
  );
});
test("new book cover lookup matches title/author and preserves later manual edits", async () => {
  const book = {
    id: "b",
    title: "Deep Work",
    author: "Cal Newport",
    cover: "",
  };
  let state = { books: [book] };
  const commit = (fn) => {
    state = fn(state);
  };
  await fillBookCovers(commit, [book], async () => ({
    ok: true,
    json: async () => ({
      docs: [
        { title: "Wrong edition title", cover_i: 99 },
        { title: "Deep Work", author_name: ["Cal Newport"], cover_i: 7988607 },
      ],
    }),
  }));
  assert.match(state.books[0].cover, /7988607/);
  state = { books: [{ ...book, cover: "https://example.com/manual.jpg" }] };
  await fillBookCovers(commit, [book], async () => ({
    ok: true,
    json: async () => ({
      docs: [
        { title: "Deep Work", author_name: ["Cal Newport"], cover_i: 7988607 },
      ],
    }),
  }));
  assert.equal(state.books[0].cover, "https://example.com/manual.jpg");
});
test("grounding check accepts verbatim or near-verbatim quotes and flags placeholders", () => {
  const paragraph =
    "At 7am I meditated for 15 minutes. I walked 8,200 steps and spent 110 minutes on my phone.";
  assert.equal(traced(paragraph, "I walked 8,200 steps"), true);
  assert.equal(
    traced(paragraph, "walked 8200 steps and spent 110 minutes"),
    true,
  );
  assert.equal(traced(paragraph, "Walked 8,200 steps on my phone"), true);
  assert.equal(traced(paragraph, "original paragraph"), false);
  assert.equal(traced(paragraph, "I ran 5 km before breakfast"), false);
  assert.equal(traced(paragraph, "walked 9,000 steps"), false);
  assert.equal(traced(paragraph, ""), false);
});
test("model formats are normalized: times, dates, blank sets, and untraced quotes become warnings", () => {
  assert.equal(normalizeTime("7am"), "07:00");
  assert.equal(normalizeTime("6:30 PM"), "18:30");
  assert.equal(normalizeTime("12 am"), "00:00");
  assert.equal(normalizeTime("12:15pm"), "12:15");
  assert.equal(normalizeTime("07:05"), "07:05");
  assert.equal(normalizeTime("19:05:00"), "19:05");
  assert.equal(normalizeTime("noon"), "12:00");
  assert.equal(normalizeTime("later"), "");
  assert.equal(normalizeTime("25:00"), "");
  assert.equal(normalizeDate("2026-09-12"), "2026-09-12");
  assert.equal(normalizeDate("September 12, 2026"), "2026-09-12");
  assert.equal(normalizeDate("someday"), "");
  const batch = prepareImport(
    {
      message: "ok",
      entries: [
        rawEntry("meditation", {
          time: "7am",
          date: "someday",
          minutes: 10,
          quality: 4,
        }),
        rawEntry("workout", {
          time: "6pm",
          minutes: 45,
          exercises: [
            {
              name: "Bench press",
              muscle: "chest",
              sets: [
                { weight: 40, reps: 10, done: true },
                { weight: null, reps: null, done: false },
                { weight: null, reps: null, done: false },
              ],
            },
          ],
        }),
      ],
    },
    emptyState(),
    { date: "2026-09-12", time: "22:00", batchId: "b", untraced: [1] },
  );
  assert.equal(batch.drafts[0].entry.time, "07:00");
  assert.equal(batch.drafts[0].entry.date, "2026-09-12");
  assert.ok(batch.drafts[0].warnings.some((w) => /someday/.test(w)));
  assert.equal(batch.drafts[1].entry.time, "18:00");
  assert.deepEqual(
    batch.drafts[1].entry.exercises[0].sets,
    Array(3).fill({ weight: 40, reps: 10, done: true }),
  );
  assert.ok(batch.drafts[1].warnings.some((w) => /previous set/.test(w)));
  assert.ok(batch.drafts[1].warnings.some((w) => /word for word/.test(w)));
  assert.equal(draftIssues(batch.drafts[1], "2026-09-12").length, 0);
  assert.equal(
    applyImport(emptyState(), batch, "2026-09-12").entries.length,
    2,
  );
});
