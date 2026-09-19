import { test } from "node:test";
import assert from "node:assert/strict";
import {
  weekDates,
  dateKey,
  monthDates,
  emptyState,
  validateState,
  validateEntry,
  totals,
  upsertEntry,
  bookProgress,
  trainingStats,
} from "../src/domain.js";
const base = (type, rest = {}) => ({
  id: "one",
  type,
  date: "2026-09-12",
  time: "09:00",
  status: "done",
  ...rest,
});
test("weeks and months use local calendar dates across boundaries", () => {
  assert.deepEqual(weekDates("2026-09-12"), [
    "2026-09-07",
    "2026-09-08",
    "2026-09-09",
    "2026-09-10",
    "2026-09-11",
    "2026-09-12",
    "2026-09-13",
  ]);
  assert.equal(weekDates("2027-01-01")[0], "2026-12-28");
  assert.equal(monthDates("2026-09-01").length, 42);
});
test("daily totals replace existing totals, edits do not duplicate", () => {
  let state = emptyState();
  state = upsertEntry(state, base("steps", { steps: 1000 }));
  state = upsertEntry(state, base("steps", { id: "two", steps: 5000 }));
  assert.equal(state.entries.length, 1);
  assert.equal(totals(state.entries).steps, 5000);
  state = upsertEntry(state, base("steps", { id: "two", steps: 6000 }));
  assert.equal(state.entries.length, 1);
  assert.equal(totals(state.entries).steps, 6000);
});
test("plans do not count in progress and nutrition multiplies servings", () => {
  const entries = [
    base("food", {
      items: [
        {
          name: "oats",
          servings: 1.5,
          calories: 200,
          protein: 10,
          carbs: 20,
          fat: 8,
        },
      ],
    }),
    base("food", {
      status: "planned",
      items: [{ servings: 1, calories: 9999 }],
    }),
    base("steps", { status: "planned", steps: 9999 }),
  ];
  assert.equal(totals(entries).calories, 300);
  assert.equal(totals(entries).protein, 15);
  assert.equal(totals(entries).steps, 0);
});
test("only completed sets contribute to muscle heat and volume", () => {
  const workout = base("workout", {
    minutes: 45,
    exercises: [
      {
        name: "Squat",
        muscle: "quadriceps",
        sets: [
          { weight: 60, reps: 8, done: true },
          { weight: 80, reps: 6, done: false },
        ],
      },
    ],
  });
  assert.equal(trainingStats([workout]).volume, 480);
  assert.equal(trainingStats([workout]).muscles.quadriceps, 1);
  assert.equal(trainingStats([{ ...workout, status: "planned" }]).sets, 0);
});
test("book progress recalculates after editing or deleting sessions", () => {
  const book = {
    id: "b",
    startPages: 10,
    totalPages: 100,
    startChapters: 0,
    totalChapters: 10,
  };
  const logs = [
    base("reading", { bookId: "b", pages: 20, chapters: 1 }),
    base("reading", { id: "two", bookId: "b", pages: 80, status: "planned" }),
  ];
  assert.equal(bookProgress(book, logs).percent, 30);
  assert.equal(bookProgress(book, []).pages, 10);
  assert.equal(bookProgress(book, [{ ...logs[0], pages: 150 }]).percent, 100);
});
test("invalid backups and unsafe cover protocols are rejected", () => {
  assert.throws(() => validateState({ version: 99 }));
  const s = emptyState();
  s.entries = [base("steps", { steps: -3 })];
  assert.throws(() => validateState(s));
  s.entries = [];
  s.books = [
    {
      id: "b",
      title: "Title",
      author: "",
      totalPages: 10,
      totalChapters: 0,
      startPages: 0,
      startChapters: 0,
      status: "Reading",
      cover: "javascript:alert(1)",
    },
  ];
  assert.throws(() => validateState(s));
});
test("orphans, duplicate IDs, invalid dates and infinite values are rejected", () => {
  const s = emptyState();
  s.entries = [
    base("reading", { bookId: "missing", pages: 1, chapters: 0, minutes: 10 }),
  ];
  assert.throws(() => validateState(s));
  assert.throws(() =>
    validateEntry(base("steps", { date: "2026-02-30", steps: 2 })),
  );
  assert.throws(() => validateEntry(base("steps", { steps: Infinity })));
  s.entries = [base("steps", { steps: 1 }), base("steps", { steps: 2 })];
  assert.throws(() => validateState(s));
});
test("meditation and dream records have separate time and count metrics", () => {
  const logs = [
    base("meditation", { minutes: 15, quality: 4, mood: "Calm" }),
    base("dream", {
      id: "dream",
      quality: 5,
      notes: "I was on the moon.",
      lucid: true,
      mood: "Curious",
    }),
  ];
  logs.forEach(validateEntry);
  assert.equal(totals(logs).meditation, 15);
  assert.equal(totals(logs).dreams, 1);
  assert.throws(() => validateEntry({ ...logs[0], quality: 9 }));
  assert.throws(() => validateEntry({ ...logs[1], notes: "" }));
});
test("empty and older version-1 backups round-trip with default meditation goal", () => {
  const s = emptyState();
  assert.deepEqual(validateState(JSON.parse(JSON.stringify(s))), s);
  delete s.profile.meditationGoal;
  assert.equal(validateState(s).profile.meditationGoal, 10);
});
