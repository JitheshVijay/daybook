import { test } from "node:test";
import assert from "node:assert/strict";
import { bookProgress, emptyState, validateState } from "../src/domain.js";
import { extractionSchema } from "../src/day-import.js";
import { executeToolCall, undoBatch } from "../src/chat-tools.js";
import { buildContext, emptyChat } from "../src/chat-history.js";

const TODAY = "2026-09-13";
const raw = (type, values = {}) => ({
  ...Object.fromEntries(Object.entries(extractionSchema.properties.entries.items.properties).map(([k, s]) => [k, Array.isArray(s.type) && s.type.includes("null") ? null : s.type === "array" ? [] : s.type === "boolean" ? false : ""])),
  type, status: "done", source: "", resolves: null, ...values,
});
const call = (name, args, id = "call_1") => ({ id, type: "function", function: { name, arguments: JSON.stringify(args) } });
function makeStore(initial = emptyState()) {
  let state = initial;
  return { get: () => state, commit: (u) => (state = validateState(typeof u === "function" ? u(state) : u)) };
}
const ctx = (store, extra = {}) => ({ state: store.get(), commit: store.commit, today: TODAY, now: "23:12", logDate: TODAY, turnId: "t", pending: [], ...extra });
const progress = (store) => bookProgress(store.get().books[0], store.get().entries);
// The user's book: "How to Talk to Anyone", 321 pages, 92 chapters, 28 pages and 6 chapters read before
// Daybook, and one session of 11 pages logged today.
function usersBook() {
  const state = emptyState();
  state.books = [{ id: "talk", title: "How to Talk to Anyone", author: "Leil Lowndes", totalPages: 321, totalChapters: 92, startPages: 28, startChapters: 6, status: "Reading", cover: "" }];
  state.entries = [{ id: "s1", type: "reading", date: TODAY, time: "23:12", status: "done", title: "", notes: "", minutes: 0, pages: 11, chapters: 0, steps: 0, distance: 0, bpm: 0, value: 0, quality: "", mood: "Neutral", lucid: false, section: "", unit: "", bookId: "talk", songId: "", habitId: "", exercises: [], items: [] }];
  return makeStore(validateState(state));
}

test("a first session given as a page range counts both pages and starts the book at the right place", () => {
  const store = makeStore();
  executeToolCall(call("log_entries", { entries: [raw("reading", { bookTitle: "How to Talk to Anyone", fromPage: 29, toPage: 40, source: "read from page 29 to page 40" })] }, "a"), ctx(store));
  assert.equal(store.get().entries[0].pages, 12);
  assert.deepEqual([progress(store).pages, store.get().books[0].startPages], [40, 28]);
});

test("'till page 51 and finished 11 chapters' ends the book at page 51 and chapter 11 (real conversation, 2026-09-13)", () => {
  // As a new session.
  let store = usersBook();
  executeToolCall(call("log_entries", { entries: [raw("reading", { bookTitle: "How to Talk to Anyone", toPage: 51, chaptersFinished: 11, source: "read how to talk to anyone till 51 pages and finished 11 chapters" })] }, "b"), ctx(store));
  assert.deepEqual(store.get().entries.map((e) => [e.pages, e.chapters]), [[11, 0], [12, 5]]);
  assert.deepEqual([progress(store).pages, progress(store).chapters], [51, 11]);

  // As a correction of today's session, which is what the model did.
  store = usersBook();
  const fix = executeToolCall(call("update_entry", { id: "s1", changes: raw("reading", { toPage: 51, chaptersFinished: 11 }) }, "c"), ctx(store));
  assert.deepEqual([progress(store).pages, progress(store).chapters], [51, 11]);
  assert.ok(fix.result.changes.includes("book progress 39 → 51 / 321 pages"));
  assert.ok(fix.result.changes.includes("book progress 6 → 11 / 92 chapters"));

  // The app never adds a finished-chapters count on top of what the book already had.
  store = usersBook();
  executeToolCall(call("update_entry", { id: "s1", changes: raw("reading", { pages: 22, chapters: 11 }) }, "d"), ctx(store));
  assert.equal(progress(store).chapters, 17, "amounts still add up, which is why positions must go in chaptersFinished");
});

test("'I read 11/92 chapters, not 17' corrects the book, and Undo puts it back", () => {
  const store = usersBook();
  store.commit((s) => ({ ...s, entries: s.entries.map((e) => ({ ...e, pages: 22, chapters: 11 })) }));
  assert.equal(progress(store).chapters, 17);
  const out = executeToolCall(call("update_book", { title: "how to talk to anyone", author: null, pagesRead: null, chaptersRead: 11, totalPages: null, totalChapters: null, status: null }, "e"), ctx(store));
  assert.equal(progress(store).chapters, 11);
  assert.deepEqual(out.result.changes, ["book progress 17 → 11 / 92 chapters"]);
  assert.equal(out.effects.card.mode, "book");
  store.commit((s) => undoBatch(s, out.effects.card));
  assert.equal(progress(store).chapters, 17);

  const same = executeToolCall(call("update_book", { title: "How to Talk to Anyone", author: null, pagesRead: 50, chaptersRead: null, totalPages: 321, totalChapters: null, status: null }, "f"), ctx(store, { state: store.get() }));
  assert.equal(same.result.nothingChanged, true);
  assert.equal(same.effects.card, undefined, "no card claiming an update");

  const noop = executeToolCall(call("update_entry", { id: "s1", changes: raw("reading", { chapters: 11 }) }, "g"), ctx(store, { state: store.get() }));
  assert.equal(noop.result.nothingChanged, true);
  assert.equal(noop.effects.card, undefined);

  assert.deepEqual(buildContext(store.get(), emptyChat(), { today: TODAY }).books[0], { id: "talk", title: "How to Talk to Anyone", author: "Leil Lowndes", status: "Reading", pagesRead: 50, totalPages: 321, chaptersRead: 17, totalChapters: 92 });
});
