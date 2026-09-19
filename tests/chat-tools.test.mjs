import { test } from "node:test";
import assert from "node:assert/strict";
import { emptyState, validateState, totals } from "../src/domain.js";
import { extractionSchema } from "../src/day-import.js";
import { CHAT_TOOLS } from "../src/chat-schema.js";
import { executeToolCall, undoBatch, tidyRaw } from "../src/chat-tools.js";
import {
  applyEffects,
  buildContext,
  emptyChat,
  toApiMessages,
  markBatchUndone,
  agePending,
  trimChat,
} from "../src/chat-history.js";
import { runTurn } from "../src/chat-loop.js";

const TODAY = "2026-09-13";
const raw = (type, values = {}) => ({
  ...Object.fromEntries(
    Object.entries(extractionSchema.properties.entries.items.properties).map(([key, s]) => [
      key,
      Array.isArray(s.type) && s.type.includes("null") ? null : s.type === "array" ? [] : s.type === "boolean" ? false : "",
    ]),
  ),
  type,
  status: "done",
  source: "",
  resolves: null,
  ...values,
});
const call = (name, args, id = "call_1") => ({
  id,
  type: "function",
  function: { name, arguments: JSON.stringify(args) },
});
function makeStore(initial = emptyState()) {
  let state = initial;
  return {
    get: () => state,
    commit: (update) => {
      state = validateState(typeof update === "function" ? update(state) : update);
    },
  };
}
const ctx = (store, extra = {}) => ({
  state: store.get(),
  commit: store.commit,
  today: TODAY,
  now: "21:00",
  logDate: TODAY,
  turnId: "turn-1",
  userText: "meditated 15 min, quality 4. read Deep Work. 2 eggs for dinner",
  pending: [],
  ...extra,
});

function walkStrict(schema, path = "root") {
  if (schema.type === "object" || (Array.isArray(schema.type) && schema.type.includes("object"))) {
    assert.equal(schema.additionalProperties, false, `${path} allows extra keys`);
    assert.deepEqual([...schema.required].sort(), Object.keys(schema.properties).sort(), `${path} required mismatch`);
    for (const [key, child] of Object.entries(schema.properties)) walkStrict(child, `${path}.${key}`);
  }
  if (schema.items) walkStrict(schema.items, `${path}[]`);
}

test("every tool schema is strict-mode compatible", () => {
  assert.deepEqual(CHAT_TOOLS.map((t) => t.name), ["log_entries", "query_data", "list_entries", "ask_user", "update_entry", "add_songs", "add_books", "add_habits", "update_book", "practice_plan", "delete_entries", "undo_batch"]);
  for (const tool of CHAT_TOOLS) walkStrict(tool.parameters, tool.name);
});

test("log_entries saves complete entries and returns incomplete ones as pending questions", () => {
  const store = makeStore();
  const out = executeToolCall(
    call("log_entries", {
      entries: [
        raw("meditation", { minutes: 15, quality: 4, mood: "Calm", source: "meditated 15 min, quality 4" }),
        raw("reading", { bookTitle: "Deep Work", source: "read Deep Work" }),
        raw("food", {
          title: "Dinner",
          source: "2 eggs for dinner",
          items: [{ name: "eggs", servings: 2, calories: 72, protein: 6, carbs: 0.4, fat: 5, estimated: true, estimateNote: "one large egg" }],
        }),
      ],
    }),
    ctx(store),
  );
  assert.equal(out.effects.error, false);
  assert.deepEqual(out.result.logged.map((e) => e.type), ["meditation", "food"]);
  assert.equal(out.result.logged[1].estimated, true);
  assert.equal(out.result.needsDetails.length, 1);
  const pendingId = out.result.needsDetails[0].id;
  assert.match(pendingId, /^p-[0-9a-f]{6}-2$/);
  assert.match(out.result.needsDetails[0].questions[0], /pages, chapters, or minutes/);
  assert.equal(store.get().entries.length, 2);
  assert.equal(store.get().books.length, 0, "a pending reading must not create its book yet");
  assert.equal(totals(store.get().entries).calories, 144);
  assert.equal(out.effects.card.kind, "logged");
  assert.deepEqual(out.effects.card.pendingIds, [pendingId]);
  assert.equal(out.effects.pendingAdd[0].known.bookTitle, "Deep Work");

  // The user answers; the model re-sends the full entry with resolves.
  const chat = applyEffects(emptyChat(), out.effects);
  const answer = executeToolCall(
    call("log_entries", { entries: [raw("reading", { bookTitle: "Deep Work", pages: 25, source: "25 pages", resolves: pendingId })] }, "call_2"),
    ctx(store, { state: store.get(), pending: chat.pending, userText: "25 pages" }),
  );
  assert.equal(answer.result.logged.length, 1);
  assert.equal(store.get().books[0].title, "Deep Work");
  const after = applyEffects(chat, answer.effects);
  assert.deepEqual(after.pending, []);
});

test("re-running the same tool call is idempotent and invalid items are rejected with a reason", () => {
  const store = makeStore();
  const steps = call("log_entries", { entries: [raw("steps", { steps: 8200, source: "8,200 steps" })] });
  executeToolCall(steps, ctx(store));
  const again = executeToolCall(steps, ctx(store, { state: store.get() }));
  assert.equal(store.get().entries.length, 1);
  assert.equal(again.result.duplicates, 1);
  assert.equal(again.effects.error, false);

  const future = executeToolCall(
    call("log_entries", { entries: [raw("steps", { steps: 100, date: "2026-09-20", source: "steps" })] }, "call_9"),
    ctx(store, { state: store.get() }),
  );
  assert.equal(future.result.rejected.length, 1);
  assert.match(future.result.rejected[0].reason, /Planned/);
  assert.equal(future.effects.error, true);
});

test("undo removes the batch, restores replaced daily totals, and drops books it created", () => {
  const store = makeStore();
  executeToolCall(call("log_entries", { entries: [raw("steps", { steps: 5000, source: "5000 steps" })] }, "a"), ctx(store));
  const out = executeToolCall(
    call(
      "log_entries",
      {
        entries: [
          raw("steps", { steps: 9000, source: "9000 steps" }),
          raw("reading", { bookTitle: "Dune", pages: 30, source: "30 pages of Dune" }),
        ],
      },
      "b",
    ),
    ctx(store, { state: store.get(), turnId: "turn-2" }),
  );
  assert.equal(out.effects.card.replaced.length, 1);
  assert.equal(totals(store.get().entries).steps, 9000);
  assert.equal(store.get().books.length, 1);
  store.commit((s) => undoBatch(s, out.effects.card));
  assert.equal(totals(store.get().entries).steps, 5000);
  assert.equal(store.get().books.length, 0);
  assert.equal(store.get().entries.length, 1);
});

test("query_data returns real numbers, a chart card on request, and errors for bad input", () => {
  const store = makeStore();
  executeToolCall(
    call("log_entries", {
      entries: [raw("food", { title: "Lunch", source: "lunch", items: [{ name: "rice", servings: 1, calories: 400, protein: 30, carbs: 60, fat: 5, estimated: false, estimateNote: "" }] })],
    }),
    ctx(store),
  );
  const out = executeToolCall(
    call("query_data", { metric: "protein", habit: null, range: "this_week", from: null, to: null, groupBy: "day", chart: "bar" }),
    ctx(store, { state: store.get() }),
  );
  assert.equal(out.result.total, 30);
  assert.equal(out.result.daysWithData, 1);
  assert.equal(out.result.points.length, 7);
  assert.match(out.result.note, /missing, not zero/);
  assert.equal(out.effects.card.kind, "chart");
  assert.equal(out.effects.card.spec.metric, "protein");
  const bad = executeToolCall(call("query_data", { metric: "mood", range: "today" }), ctx(store));
  assert.equal(bad.effects.error, true);
  assert.match(bad.result.error, /Invalid arguments/);
  const broken = executeToolCall({ id: "x", type: "function", function: { name: "query_data", arguments: "{oops" } }, ctx(store));
  assert.match(broken.result.error, /not valid JSON/);
});

test("ask_user stops the loop with a question card; list_entries summarizes without notes", () => {
  const store = makeStore();
  const ask = executeToolCall(call("ask_user", { question: "How many pages?", options: ["20", "30", "30", "One chapter"] }), ctx(store));
  assert.equal(ask.effects.stop, true);
  assert.deepEqual(ask.effects.card.options, ["20", "30", "One chapter"]);
  executeToolCall(call("log_entries", { entries: [raw("dream", { title: "Sea", notes: "secret dream text", quality: 3, lucid: false, source: "dream" })] }), ctx(store));
  const list = executeToolCall(call("list_entries", { type: "all", range: "today", from: null, to: null, limit: 5 }), ctx(store, { state: store.get() }));
  assert.equal(list.result.count, 1);
  assert.doesNotMatch(JSON.stringify(list.result), /secret dream text/);
});

test("history compaction keeps tool exchanges intact and trims older turns to text", () => {
  const messages = [];
  const add = (m) => messages.push({ id: String(messages.length), ...m });
  for (let t = 0; t < 8; t++) {
    add({ role: "user", content: `turn ${t}`, turnId: `t${t}` });
    add({ role: "assistant", content: null, tool_calls: [{ id: `c${t}`, type: "function", function: { name: "query_data", arguments: "{}" } }], turnId: `t${t}` });
    add({ role: "tool", tool_call_id: `c${t}`, content: "{}", card: { kind: "chart" }, turnId: `t${t}` });
    add({ role: "assistant", content: `answer ${t}`, turnId: `t${t}` });
  }
  add({ role: "user", content: "failed", status: "error", turnId: "tx" });
  add({ role: "user", content: "now", turnId: "t9" });
  const api = toApiMessages(messages);
  assert.equal(api.at(-1).content, "now");
  assert.ok(!api.some((m) => m.content === "failed"));
  assert.ok(api.length <= 24);
  assert.equal(api[0].role, "user");
  for (let i = 0; i < api.length; i++) {
    if (api[i].tool_calls) assert.equal(api[i + 1].tool_call_id, api[i].tool_calls[0].id);
    if (api[i].role === "tool") assert.ok(api[i - 1].tool_calls);
    assert.equal(api[i].card, undefined);
  }
  const recentTools = api.filter((m) => m.role === "tool").length;
  assert.equal(recentTools, 1, "only the last finished turn keeps its tool exchange besides the current one");
  // A dangling tool call (stopped mid-turn) never reaches the provider.
  const dangling = [
    { role: "user", content: "a", turnId: "1" },
    { role: "assistant", content: null, tool_calls: [{ id: "z", type: "function", function: { name: "query_data", arguments: "{}" } }], turnId: "1" },
    { role: "user", content: "b", turnId: "2" },
  ];
  assert.deepEqual(toApiMessages(dangling), [
    { role: "user", content: "a" },
    { role: "assistant", content: "(reply interrupted)" },
    { role: "user", content: "b" },
  ]);
});

test("context, pending aging, undo events, and storage trimming", () => {
  const store = makeStore();
  executeToolCall(call("log_entries", { entries: [raw("steps", { steps: 4000, source: "4000 steps" })] }), ctx(store));
  let chat = { ...emptyChat(), pending: [{ id: "p1", type: "reading", date: TODAY, known: { bookTitle: "X" }, questions: ["How much?"], turnsOpen: 8 }] };
  const context = buildContext(store.get(), chat, { today: TODAY, now: "21:00", logDate: TODAY });
  assert.equal(context.weekday, "Sunday");
  assert.equal(context.entriesOnLogDate[0].detail, "4,000 steps");
  assert.equal(context.pending[0].id, "p1");
  assert.equal(context.user.goals.stepsGoal, 8000);
  chat = agePending(chat, TODAY);
  assert.deepEqual(chat.pending, []);
  chat = agePending({ ...chat, logDate: TODAY, pending: [{ id: "p2", turnsOpen: 0 }] }, "2026-09-12");
  assert.deepEqual(chat.pending, [], "changing the logged date clears pending items");
  chat = {
    ...emptyChat(),
    messages: [{ id: "m", role: "tool", card: { kind: "logged", batchId: "b1", entries: [{ id: "e" }], pendingIds: [] } }],
  };
  const undone = markBatchUndone(chat, "b1");
  assert.equal(undone.messages[0].card.undone, true);
  assert.match(undone.events[0], /undid batch b1/);
  const big = { ...emptyChat(), messages: Array.from({ length: 300 }, (_, i) => ({ id: String(i), role: i % 2 ? "assistant" : "user", content: "x".repeat(4000) })) };
  const trimmed = trimChat(big);
  assert.ok(JSON.stringify(trimmed).length <= 500_000);
  assert.equal(trimmed.messages[0].role, "user");
});

test("runTurn executes tool calls locally, loops back, and records failures without saving", async () => {
  const data = makeStore();
  let chat = emptyChat();
  const store = { get: () => chat, set: (fn) => (chat = fn(chat)) };
  const bodies = [];
  const replies = [
    { message: { role: "assistant", content: null, tool_calls: [call("log_entries", { entries: [raw("steps", { steps: 7000, source: "7000 steps" })] })] } },
    { message: { role: "assistant", content: "Logged 7,000 steps.", tool_calls: null } },
  ];
  const fetchImpl = async (_url, opts) => {
    bodies.push(JSON.parse(opts.body));
    return { ok: true, json: async () => replies.shift() };
  };
  await runTurn({ text: "7000 steps today", store, data, logDate: TODAY, today: TODAY, fetchImpl });
  assert.equal(data.get().entries.length, 1);
  assert.equal(bodies.length, 2);
  assert.equal(bodies[1].iteration, 2);
  assert.equal(bodies[1].messages.at(-1).role, "tool");
  assert.deepEqual(chat.messages.map((m) => m.role), ["user", "assistant", "tool", "assistant"]);
  assert.equal(chat.messages[2].card.kind, "logged");

  const failing = async () => ({ ok: false, json: async () => ({ error: "The AI key was not accepted." }) });
  await runTurn({ text: "and 20 pages", store, data, logDate: TODAY, today: TODAY, fetchImpl: failing });
  const last = chat.messages.at(-1);
  assert.equal(last.role, "user");
  assert.equal(last.status, "error");
  assert.match(last.error, /key was not accepted/);
  assert.equal(data.get().entries.length, 1);

  // ask_user ends the turn with a synthetic assistant message carrying the question.
  const askReplies = [{ message: { role: "assistant", content: null, tool_calls: [call("ask_user", { question: "How long?", options: ["10 min", "20 min"] }, "q")] } }];
  await runTurn({ text: "I meditated", store, data, logDate: TODAY, today: TODAY, fetchImpl: async () => ({ ok: true, json: async () => askReplies.shift() }) });
  assert.equal(chat.messages.at(-1).synthetic, true);
  assert.equal(chat.messages.at(-1).content, "How long?");
  assert.equal(chat.messages.at(-2).card.kind, "question");
});

test("update_entry corrects a saved entry in place, refuses a different type, and can be undone", () => {
  const store = makeStore();
  const logged = executeToolCall(
    call("log_entries", {
      entries: [
        raw("workout", { title: "Push", minutes: 45, source: "bench 3x10 at 40kg", exercises: [{ name: "Bench press", muscle: "chest", sets: [1, 2, 3].map(() => ({ weight: 40, reps: 10, done: true })) }] }),
      ],
    }),
    ctx(store),
  );
  const id = logged.result.logged[0].id;
  const wrong = executeToolCall(
    call("update_entry", { id, changes: raw("food", { title: "Dinner", items: [{ name: "eggs", servings: 2, calories: 72, protein: 6, carbs: 0, fat: 5, estimated: true, estimateNote: "" }] }) }, "u0"),
    ctx(store, { state: store.get() }),
  );
  assert.match(wrong.result.error, /belongs to a workout/);
  assert.equal(store.get().entries[0].title, "Push");
  const fix = executeToolCall(
    call("update_entry", { id, changes: raw("workout", { exercises: [{ name: "Bench press", muscle: "chest", sets: [1, 2, 3].map(() => ({ weight: 50, reps: 10, done: true })) }] }) }, "u1"),
    ctx(store, { state: store.get(), turnId: "turn-2" }),
  );
  assert.equal(fix.effects.error, undefined);
  assert.equal(store.get().entries.length, 1);
  const saved = store.get().entries[0];
  assert.equal(saved.id, id);
  assert.equal(saved.title, "Push", "unchanged fields are kept");
  assert.equal(saved.minutes, 45);
  assert.deepEqual(saved.exercises[0].sets.map((s) => s.weight), [50, 50, 50]);
  assert.equal(fix.effects.card.mode, "updated");
  store.commit((s) => undoBatch(s, fix.effects.card));
  assert.deepEqual(store.get().entries[0].exercises[0].sets.map((s) => s.weight), [40, 40, 40]);
  const missing = executeToolCall(call("update_entry", { id: "p-abc123-1", changes: raw("reading", { pages: 20 }) }, "u2"), ctx(store));
  assert.match(missing.result.error, /Pending items are not saved/);
});

test("delete_entries removes entries and its card can restore them", () => {
  const store = makeStore();
  const logged = executeToolCall(call("log_entries", { entries: [raw("cardio", { title: "Run", minutes: 30, source: "ran 30 min" })] }), ctx(store));
  const del = executeToolCall(call("delete_entries", { ids: [logged.result.logged[0].id, "nope"] }, "d1"), ctx(store, { state: store.get() }));
  assert.equal(store.get().entries.length, 0);
  assert.equal(del.result.deleted.length, 1);
  assert.equal(del.result.missing, 1);
  store.commit((s) => undoBatch(s, del.effects.card));
  assert.equal(store.get().entries[0].title, "Run");
});

test("model slips are repaired before judging completeness", () => {
  const tidy = tidyRaw(
    raw("food", {
      title: "Dinner",
      mood: null,
      items: [{ name: "toast, 2 slices", servings: null, calories: 160, protein: 6, carbs: 28, fat: 2, estimated: true, estimateNote: "two slices" }],
    }),
  );
  assert.equal(tidy.time, "19:00");
  assert.equal(tidy.items[0].servings, 1);
  assert.equal(tidyRaw(raw("meditation", { mood: "calm" })).mood, "Calm");
  assert.equal(tidyRaw(raw("reading", { title: "Reading" })).title, "");
  assert.equal(tidyRaw(raw("food", { items: [{ name: "pasta", servings: null, calories: null, protein: null, carbs: null, fat: null, estimated: false, estimateNote: "" }] })).items[0].servings, null);
});

test("a question asked alongside other tool calls is deferred until the model sees their results", async () => {
  const data = makeStore();
  let chat = emptyChat();
  const store = { get: () => chat, set: (fn) => (chat = fn(chat)) };
  const replies = [
    {
      message: {
        role: "assistant",
        content: null,
        tool_calls: [
          call("log_entries", { entries: [raw("cardio", { title: "Run", source: "went for a run" })] }, "a"),
          call("ask_user", { question: "Use estimates?", options: ["Use estimates", "Skip"] }, "b"),
        ],
      },
    },
    { message: { role: "assistant", content: null, tool_calls: [call("ask_user", { question: "How long was the run?", options: ["20 min", "30 min", "45 min"] }, "c")] } },
  ];
  await runTurn({ text: "went for a run", store, data, logDate: TODAY, today: TODAY, fetchImpl: async () => ({ ok: true, json: async () => replies.shift() }) });
  const cards = chat.messages.filter((m) => m.card).map((m) => m.card.kind);
  assert.deepEqual(cards, ["logged", "question"]);
  assert.equal(chat.messages.at(-1).content, "How long was the run?");
  assert.equal(JSON.parse(chat.messages.find((m) => m.tool_call_id === "b").content).asked, false);
  assert.equal(chat.pending.length, 1);
});

test("updates describe what changed, and redundant titles are dropped", async () => {
  const { describeChanges } = await import("../src/chat-tools.js");
  const before = { type: "workout", minutes: 45, title: "Push", exercises: [{ name: "Bench press", muscle: "chest", sets: [1, 2, 3].map(() => ({ weight: 40, reps: 10, done: true })) }] };
  const after = { ...before, exercises: [{ ...before.exercises[0], sets: [1, 2, 3].map(() => ({ weight: 50, reps: 10, done: true })) }] };
  assert.deepEqual(describeChanges(before, after), ["Bench press: 3×10 @ 40 kg → 3×10 @ 50 kg"]);
  assert.deepEqual(describeChanges({ type: "cardio", minutes: 20 }, { type: "cardio", minutes: 30 }), ["minutes 20 → 30"]);
  assert.equal(tidyRaw(raw("reading", { title: "Reading Deep Work", bookTitle: "Deep Work" })).title, "");
  assert.equal(tidyRaw(raw("reading", { title: "Morning chapter", bookTitle: "Deep Work" })).title, "Morning chapter");
});

test("correcting a meal keeps its saved time", () => {
  const store = makeStore();
  const logged = executeToolCall(
    call("log_entries", { entries: [raw("food", { title: "Snack", time: "16:10", source: "snack", items: [{ name: "apple", servings: 1, calories: 95, protein: 0, carbs: 25, fat: 0, estimated: true, estimateNote: "" }] })] }),
    ctx(store),
  );
  executeToolCall(
    call("update_entry", { id: logged.result.logged[0].id, changes: raw("food", { title: "Lunch" }) }, "u9"),
    ctx(store, { state: store.get(), turnId: "t2" }),
  );
  assert.equal(store.get().entries[0].title, "Lunch");
  assert.equal(store.get().entries[0].time, "16:10");
});

test("repeated activities in one turn are saved once, and matching pending items merge", async () => {
  const data = makeStore();
  let chat = emptyChat();
  const store = { get: () => chat, set: (fn) => (chat = fn(chat)) };
  const replies = [
    {
      message: {
        role: "assistant",
        content: null,
        tool_calls: [
          call("log_entries", { entries: [raw("workout", { title: "Push", minutes: 45, source: "bench", exercises: [{ name: "Bench press", muscle: "chest", sets: [{ weight: 40, reps: 10, done: true }] }] }), raw("reading", { bookTitle: "Deep Work", source: "read" })] }, "a"),
          call("log_entries", { entries: [raw("reading", { bookTitle: "Deep Work", source: "read some" })] }, "b"),
        ],
      },
    },
    { message: { role: "assistant", content: "How much did you read?", tool_calls: null } },
  ];
  await runTurn({ text: "bench 10 reps at 40kg and read some Deep Work", store, data, logDate: TODAY, today: TODAY, fetchImpl: async () => ({ ok: true, json: async () => replies.shift() }) });
  assert.equal(chat.pending.length, 1, "the same unfinished reading is one pending item");
  assert.equal(chat.messages.filter((m) => m.card?.kind === "logged").length, 1, "the repeat does not add a second card");
  assert.equal(data.get().entries.length, 1);

  const pendingId = chat.pending[0].id;
  const answers = [
    {
      message: {
        role: "assistant",
        content: null,
        tool_calls: [
          call("log_entries", { entries: [raw("reading", { bookTitle: "Deep Work", pages: 20, source: "20 pages", resolves: pendingId })] }, "c"),
          call("log_entries", { entries: [raw("reading", { bookTitle: "Deep Work", pages: 20, source: "20 pages", resolves: "p-other-1" })] }, "d"),
        ],
      },
    },
    { message: { role: "assistant", content: "Logged 20 pages.", tool_calls: null } },
  ];
  await runTurn({ text: "20 pages", store, data, logDate: TODAY, today: TODAY, fetchImpl: async () => ({ ok: true, json: async () => answers.shift() }) });
  assert.equal(data.get().entries.filter((e) => e.type === "reading").length, 1, "the repeated reading is not saved twice");
  assert.deepEqual(chat.pending, []);
});

test("a named dish without nutrition comes back with a hint to estimate it", () => {
  const store = makeStore();
  const out = executeToolCall(
    call("log_entries", { entries: [raw("food", { title: "Lunch", source: "had a chicken burrito for lunch", items: [{ name: "chicken burrito", servings: null, calories: null, protein: null, carbs: null, fat: null, estimated: false, estimateNote: "" }] })] }),
    ctx(store, { userText: "had a chicken burrito for lunch" }),
  );
  assert.equal(out.result.needsDetails.length, 1);
  assert.match(out.result.hint, /can be estimated/);
  const vague = executeToolCall(
    call("log_entries", { entries: [raw("food", { title: "Snack", source: "ate some snacks", items: [{ name: "snacks", servings: null, calories: null, protein: null, carbs: null, fat: null, estimated: false, estimateNote: "" }] })] }, "v"),
    ctx(store, { userText: "ate some snacks" }),
  );
  assert.equal(vague.result.hint, undefined);
});

// ---- Gym-session shaped input from a real conversation (2026-09-13) ----
const sets = (n, reps, weight) => Array.from({ length: n }, () => ({ reps, weight, done: true }));
const ex = (name, list, muscle = null) => ({ name, muscle, sets: list });
const gymMessage =
  "I went to the gym. did 10 minutes of cardio at speed of 6 and inclination of 3 then 2 miuntes with inclination of 12. leg press of 4 sets. 1st set of 40 kg, rep range 8-12. 6 reps of deadlisfts 80kg. 40kg of Romanian Deadlifts. 2 sets of 12 reps leg extention with 57kg, 2 sets of 12 reps of hamstring curls with 40kg. 2 sets of hip abduction with 60kg and same 2 sets with 60kg hip adduction. i ate Pink Perch fish fried, 2 eggs fried, then potato and rice.";
function gymEntries() {
  return [
    raw("cardio", { title: "Treadmill", minutes: 12, source: "10 minutes of cardio" }),
    raw("workout", { title: "Leg Press", source: "leg press of 4 sets", exercises: [ex("Leg press", [{ reps: null, weight: 40, done: true }, { reps: null, weight: null, done: true }, { reps: null, weight: null, done: true }, { reps: null, weight: null, done: true }])] }),
    raw("workout", { title: "Deadlifts", source: "6 reps of deadlisfts 80kg", exercises: [ex("Deadlift", sets(1, 6, 80))] }),
    raw("workout", { title: "Romanian Deadlifts", source: "40kg of Romanian Deadlifts", exercises: [ex("Romanian deadlift", [{ reps: null, weight: 40, done: true }])] }),
    raw("workout", { title: "Leg Extension", source: "leg extention", exercises: [ex("Leg extension", sets(2, 12, 57))] }),
    raw("workout", { title: "Hamstring Curls", source: "hamstring curls", exercises: [ex("Hamstring curl", sets(2, 12, 40))] }),
    raw("workout", { title: "Hip Abduction", source: "hip abduction", exercises: [ex("Hip abduction", [{ reps: null, weight: 60, done: true }, { reps: null, weight: 60, done: true }])] }),
    raw("workout", { title: "Hip Adduction", source: "hip adduction", exercises: [ex("Hip adduction", [{ reps: null, weight: 60, done: true }, { reps: null, weight: 60, done: true }])] }),
    raw("food", {
      title: "Food",
      source: "i ate Pink Perch fish fried, 2 eggs fried, then potato and rice",
      items: [
        { name: "Pink perch, fried", servings: 3, calories: 180, protein: 22, carbs: 6, fat: 8, estimated: true, estimateNote: "one piece" },
        { name: "eggs, fried", servings: 2, calories: 90, protein: 6, carbs: 0.5, fat: 7, estimated: true, estimateNote: "one large egg" },
        { name: "potato", servings: null, calories: null, protein: null, carbs: null, fat: null, estimated: false, estimateNote: "" },
        { name: "rice", servings: null, calories: null, protein: null, carbs: null, fat: null, estimated: false, estimateNote: "" },
      ],
    }),
  ];
}

test("a gym session logged one exercise per entry becomes one workout; complete parts save, gaps are asked once", () => {
  const store = makeStore();
  const out = executeToolCall(call("log_entries", { entries: gymEntries() }, "gym"), ctx(store, { userText: gymMessage }));
  const data = store.get();
  const workouts = data.entries.filter((e) => e.type === "workout");
  assert.equal(workouts.length, 1, "one workout for the session");
  assert.deepEqual(workouts[0].exercises.map((x) => x.name), ["Deadlift", "Leg extension", "Hamstring curl"]);
  assert.equal(workouts[0].minutes, 0, "no duration was needed");
  assert.equal(workouts[0].title, "");
  assert.equal(data.entries.filter((e) => e.type === "cardio").length, 1);
  const meal = data.entries.find((e) => e.type === "food");
  assert.deepEqual(meal.items.map((i) => i.name), ["Pink perch, fried", "eggs, fried"]);

  const waiting = out.result.needsDetails;
  assert.equal(waiting.length, 2, "one waiting item for the workout, one for the meal");
  const gym = waiting.find((w) => w.type === "workout");
  assert.equal(gym.partOf, workouts[0].id);
  assert.deepEqual(gym.questions, [
    "Leg press: reps and weight for each set?",
    "Romanian deadlift: how many reps?",
    "Hip abduction: how many reps in each set?",
    "Hip adduction: how many reps in each set?",
  ]);
  assert.ok(!gym.questions.some((q) => /minutes|how long/i.test(q)), "never asks for workout duration");
  const food = waiting.find((w) => w.type === "food");
  assert.deepEqual(food.questions, ["Potato: roughly how much did you have?", "Rice: roughly how much did you have?"]);
  assert.match(out.result.replyGuidance, /Saved now: Treadmill, Workout, Food\./);
  assert.match(out.result.replyGuidance, /NOT saved yet/);
  assert.match(out.result.hint, /can be estimated/);
  assert.deepEqual(out.effects.retry, { tool: "log_entries", types: ["food"] });
  assert.equal(out.effects.card.entries.length, 3);
  assert.equal(out.effects.card.pendingIds.length, 2);
});

test("answering the gaps adds them to the same workout and meal, and undo removes only what the answer added", () => {
  const store = makeStore();
  const first = executeToolCall(call("log_entries", { entries: gymEntries() }, "gym"), ctx(store, { userText: gymMessage }));
  let chat = applyEffects(emptyChat(), first.effects);
  const gym = first.result.needsDetails.find((w) => w.type === "workout");
  const food = first.result.needsDetails.find((w) => w.type === "food");
  const answer = executeToolCall(
    call(
      "log_entries",
      {
        entries: [
          raw("workout", {
            source: "leg press 12,10,10,8 at 40,70,90,100; RDL 3x10; hips 12 reps",
            resolves: gym.id,
            exercises: [
              ex("Leg press", [{ reps: 12, weight: 40, done: true }, { reps: 10, weight: 70, done: true }, { reps: 10, weight: 90, done: true }, { reps: 8, weight: 100, done: true }]),
              ex("Romanian deadlift", sets(3, 10, 40)),
              ex("Hip abduction", sets(2, 12, 60)),
              ex("Hip adduction", sets(2, 12, 60)),
            ],
          }),
          raw("food", { source: "a cup of rice and one potato", resolves: food.id, items: [
            { name: "potato", servings: 1, calories: 160, protein: 4, carbs: 37, fat: 0.2, estimated: true, estimateNote: "one medium potato" },
            { name: "rice", servings: 1, calories: 205, protein: 4, carbs: 45, fat: 0.4, estimated: true, estimateNote: "one cup cooked" },
          ] }),
        ],
      },
      "answer",
    ),
    ctx(store, { state: store.get(), pending: chat.pending, turnId: "turn-2", userText: "leg press 12,10,10,8 at 40,70,90,100; RDL 3x10; hips 12 reps; a cup of rice and one potato" }),
  );
  chat = applyEffects(chat, answer.effects);
  const data = store.get();
  const workouts = data.entries.filter((e) => e.type === "workout");
  assert.equal(workouts.length, 1);
  assert.equal(workouts[0].exercises.length, 7);
  assert.equal(data.entries.filter((e) => e.type === "food").length, 1);
  assert.equal(data.entries.find((e) => e.type === "food").items.length, 4);
  assert.deepEqual(chat.pending, []);
  assert.deepEqual(answer.result.needsDetails, []);
  assert.equal(answer.effects.card.pendingIds.length, 0);

  store.commit((s) => undoBatch(s, answer.effects.card));
  assert.equal(store.get().entries.find((e) => e.type === "workout").exercises.length, 3);
  assert.equal(store.get().entries.find((e) => e.type === "food").items.length, 2);
});

test("exercises tucked inside a cardio entry are split into a workout; a lone workout saves without a duration", async () => {
  const { entryDetail, inferMuscle } = await import("../src/domain.js");
  const store = makeStore();
  executeToolCall(
    call("log_entries", {
      entries: [raw("cardio", { title: "Cardio", minutes: 12, source: "cardio then legs", exercises: [ex("Cardio", []), ex("Leg extension", sets(2, 12, 57))] })],
    }),
    ctx(store),
  );
  const workout = store.get().entries.find((e) => e.type === "workout");
  assert.ok(workout, "the exercises were not lost");
  assert.equal(workout.exercises[0].muscle, "quadriceps");
  assert.equal(entryDetail(workout), "2 sets · 1 exercise");
  assert.equal(store.get().entries.find((e) => e.type === "cardio").minutes, 12);
  assert.equal(inferMuscle("Hip abduction machine"), "abductors");
  assert.equal(inferMuscle("Seated leg curl"), "hamstring");
  assert.equal(inferMuscle("Incline dumbbell curl"), "biceps");
  assert.equal(inferMuscle("Juggling"), "");
});

// A stand-in for /api/nutrition: every food gets a typical portion.
const nutritionReply = (body) => ({
  foods: body.foods.map((f) => ({ name: f.name, servings: f.servings ?? 1, portion: `typical ${f.name}`, calories: 150, protein: 3, carbs: 30, fat: 1 })),
});

test("several log calls in one reply run as one log, and every food is estimated by the app without asking", async () => {
  const data = makeStore();
  let chat = emptyChat();
  const store = { get: () => chat, set: (fn) => (chat = fn(chat)) };
  const entries = gymEntries();
  const bodies = [];
  const nutritionBodies = [];
  const replies = [
    { message: { role: "assistant", content: null, tool_calls: entries.map((e, i) => call("log_entries", { entries: [e] }, `c${i}`)) } },
    { message: { role: "assistant", content: "Logged your cardio, workout and food. What reps did you do?", tool_calls: null } },
  ];
  const fetchImpl = async (url, opts) => {
    const body = JSON.parse(opts.body);
    if (url === "/api/nutrition") {
      nutritionBodies.push(body);
      return { ok: true, json: async () => nutritionReply(body) };
    }
    bodies.push(body);
    return { ok: true, json: async () => replies.shift() };
  };
  await runTurn({ text: gymMessage, store, data, logDate: TODAY, today: TODAY, fetchImpl });
  assert.equal(data.get().entries.filter((e) => e.type === "workout").length, 1);
  assert.equal(chat.messages.filter((m) => m.card?.kind === "logged").length, 1, "one card, including the estimated foods");
  const merged = chat.messages.filter((m) => m.role === "tool" && JSON.parse(m.content).combinedWith === "c0");
  assert.equal(merged.length, entries.length - 1);
  assert.equal(bodies.length, 2, "no retry was needed");
  assert.equal(bodies[1].forceTool, undefined);
  assert.equal(nutritionBodies.length, 1);
  // The model's own guesses (fish, eggs) are replaced by the app's estimate too.
  assert.deepEqual(nutritionBodies[0].foods, [{ name: "Pink perch, fried", servings: 3 }, { name: "eggs, fried", servings: 2 }, { name: "potato", servings: null }, { name: "rice", servings: null }]);
  assert.equal(nutritionBodies[0].description, gymMessage);
  const meal = data.get().entries.find((e) => e.type === "food");
  assert.deepEqual(
    meal.items.map(({ name, servings, calories, estimated, estimateNote }) => ({ name, servings, calories, estimated, estimateNote })),
    [
      { name: "Pink perch, fried", servings: 3, calories: 150, estimated: true, estimateNote: "typical Pink perch, fried" },
      { name: "eggs, fried", servings: 2, calories: 150, estimated: true, estimateNote: "typical eggs, fried" },
      { name: "potato", servings: 1, calories: 150, estimated: true, estimateNote: "typical potato" },
      { name: "rice", servings: 1, calories: 150, estimated: true, estimateNote: "typical rice" },
    ],
  );
  assert.deepEqual(chat.pending.map((p) => p.type), ["workout"], "only the workout reps remain");
  const result = JSON.parse(chat.messages.find((m) => m.role === "tool" && m.tool_call_id === "c0").content);
  assert.deepEqual(result.needsDetails.map((n) => n.type), ["workout"], "the model is never told to ask about food");
  assert.match(result.nutrition, /estimated by the app/);
  const card = chat.messages.find((m) => m.card?.kind === "logged").card;
  assert.equal(card.pendingIds.length, 1);
  assert.equal(card.entries.find((e) => e.type === "food").detail.includes("4 foods"), true);
});

test("if nutrition can't be estimated, the foods stay waiting with their questions", async () => {
  const data = makeStore();
  let chat = emptyChat();
  const store = { get: () => chat, set: (fn) => (chat = fn(chat)) };
  const replies = [
    { message: { role: "assistant", content: null, tool_calls: [call("log_entries", { entries: gymEntries() }, "first")] } },
    { message: { role: "assistant", content: "How much potato and rice?", tool_calls: null } },
  ];
  const fetchImpl = async (url) =>
    url === "/api/nutrition" ? { ok: false, status: 503, json: async () => ({ error: "AI is not connected." }) } : { ok: true, json: async () => replies.shift() };
  await runTurn({ text: gymMessage, store, data, logDate: TODAY, today: TODAY, fetchImpl });
  assert.equal(data.get().entries.find((e) => e.type === "food").items.length, 2);
  const food = chat.pending.find((p) => p.type === "food");
  assert.deepEqual(food.questions, ["Potato: roughly how much did you have?", "Rice: roughly how much did you have?"]);
  assert.equal(chat.messages.at(-1).content, "How much potato and rice?");
});

test("a reply that re-sends the whole day with made-up numbers saves no duplicates and none of the made-up reps", async () => {
  const data = makeStore();
  let chat = emptyChat();
  const store = { get: () => chat, set: (fn) => (chat = fn(chat)) };
  const invented = gymEntries().map((e) =>
    e.type === "workout" ? { ...e, exercises: e.exercises.map((x) => ({ ...x, sets: x.sets.map((t) => ({ ...t, reps: t.reps ?? 10, weight: t.weight ?? 50 })) })) } : e,
  );
  const replies = [
    { message: { role: "assistant", content: null, tool_calls: [call("log_entries", { entries: gymEntries() }, "first")] } },
    { message: { role: "assistant", content: null, tool_calls: [call("log_entries", { entries: invented }, "again")] } },
    { message: { role: "assistant", content: "Logged. What reps did you do?", tool_calls: null } },
  ];
  const fetchImpl = async (url, opts) =>
    url === "/api/nutrition" ? { ok: true, json: async () => nutritionReply(JSON.parse(opts.body)) } : { ok: true, json: async () => replies.shift() };
  await runTurn({ text: gymMessage, store, data, logDate: TODAY, today: TODAY, fetchImpl });
  const entries = data.get().entries;
  assert.equal(entries.filter((e) => e.type === "workout").length, 1, "no second workout");
  assert.equal(entries.filter((e) => e.type === "food").length, 1, "no second meal");
  assert.equal(entries.filter((e) => e.type === "cardio").length, 1);
  assert.deepEqual(entries.find((e) => e.type === "workout").exercises.map((x) => x.name), ["Deadlift", "Leg extension", "Hamstring curl"], "made-up reps were not accepted");
  assert.equal(entries.find((e) => e.type === "food").items.length, 4);
  assert.deepEqual(chat.pending.map((p) => p.type), ["workout"]);
  const again = JSON.parse(chat.messages.find((m) => m.tool_call_id === "again").content);
  assert.deepEqual(again.notInUserMessage, ["Leg press", "Romanian deadlift", "Hip abduction", "Hip adduction"]);
});

test("an answer with a number missing for one exercise keeps asking for that one (real conversation, 2026-09-13)", () => {
  const store = makeStore();
  const first = executeToolCall(call("log_entries", { entries: gymEntries() }, "gym"), ctx(store, { userText: gymMessage }));
  let chat = applyEffects(emptyChat(), first.effects);
  const gym = first.result.needsDetails.find((w) => w.type === "workout");
  const answerText = "Romanian Deadlift: how many reps? - 12 reps\nHip Abduction: how many reps in each set? - 12 reps\nHip Adduction: how many reps in each set? - reps";
  // What the model sent: it filled in 12 for adduction although the user typed no number.
  const answer = executeToolCall(
    call("log_entries", { entries: [raw("workout", { source: answerText, resolves: gym.id, exercises: [ex("Romanian Deadlift", sets(1, 12, 40)), ex("Hip abduction", sets(2, 12, 60)), ex("Hip adduction", sets(2, 12, 60))] })] }, "answer"),
    ctx(store, { state: store.get(), pending: chat.pending, turnId: "turn-2", userText: `${gymMessage}\n${answerText}`, latestUserText: answerText }),
  );
  chat = applyEffects(chat, answer.effects);
  const workout = store.get().entries.find((e) => e.type === "workout");
  assert.ok(workout.exercises.some((x) => x.name === "Romanian deadlift" || x.name === "Romanian Deadlift"), "Romanian deadlift was saved");
  assert.ok(workout.exercises.some((x) => x.name === "Hip abduction"), "Hip abduction was saved");
  assert.ok(!workout.exercises.some((x) => x.name === "Hip adduction"), "Hip adduction was not saved with made-up reps");
  const waiting = chat.pending.find((p) => p.type === "workout");
  assert.deepEqual(waiting.questions, ["Leg press: reps and weight for each set?", "Hip adduction: how many reps in each set?"]);
  assert.deepEqual(answer.result.notInUserMessage, ["Hip adduction"]);
  assert.match(answer.result.replyGuidance, /no number for Hip adduction/);
  assert.equal(answer.effects.retry, undefined, "no forced retry for a number the user didn't give");

  // Correcting through update_entry is held to the same rule.
  const update = executeToolCall(
    call("update_entry", { id: workout.id, changes: raw("workout", { exercises: [ex("Hip adduction", sets(2, 12, 60))] }) }, "fix"),
    ctx(store, { state: store.get(), pending: chat.pending, turnId: "turn-2", userText: answerText, latestUserText: answerText }),
  );
  assert.match(update.result.error, /no number for Hip adduction/);
  assert.ok(!store.get().entries.find((e) => e.type === "workout").exercises.some((x) => x.name === "Hip adduction"));

  // The user then gives the number.
  const later = executeToolCall(
    call("log_entries", { entries: [raw("workout", { source: "adduction 12", resolves: waiting.id, exercises: [ex("Hip adduction", sets(2, 12, 60))] })] }, "later"),
    ctx(store, { state: store.get(), pending: chat.pending, turnId: "turn-3", userText: "adduction 12", latestUserText: "adduction 12" }),
  );
  chat = applyEffects(chat, later.effects);
  assert.ok(store.get().entries.find((e) => e.type === "workout").exercises.some((x) => x.name === "Hip adduction"));
});

test("numbers are matched to the exercise they were written for", async () => {
  const { numbersForPart } = await import("../src/chat-tools.js");
  const names = ["Romanian deadlift", "Hip abduction", "Hip adduction", "Leg press", "Deadlift"];
  const answer = "Romanian Deadlift: how many reps? - 12 reps\nHip Abduction: how many reps in each set? - 12 reps\nHip Adduction: how many reps in each set? - reps";
  assert.deepEqual(numbersForPart(answer, "Hip adduction", names), []);
  assert.deepEqual(numbersForPart(answer, "Hip abduction", names), [12]);
  assert.deepEqual(numbersForPart("hip abduction and adduction were 12 reps each set", "Hip adduction", names), [12]);
  assert.deepEqual(numbersForPart("12 each", "Hip adduction", names), [12], "a message naming nothing answers every question");
  assert.deepEqual(numbersForPart("romanian 12, abduction 15", "Hip adduction", names), [], "an exercise the answer skipped gets no numbers");
  assert.deepEqual(numbersForPart("romanian 12, abduction 15", "Hip abduction", names), [15]);
  assert.deepEqual(numbersForPart("40kg of Romanian Deadlifts. 6 reps of deadlifts at 80", "Deadlift", names), [6, 80], "Romanian deadlift is not Deadlift");
  assert.deepEqual(numbersForPart("abduction twelve reps, adduction the same", "Hip adduction", names), [12]);
  assert.deepEqual(numbersForPart("leg press 12,10,10,8 at 40,70,90,100", "Leg press", names), [12, 10, 10, 8, 40, 70, 90, 100]);
});

test("re-logging the whole workout in a later message joins the saved one and keeps saved values", () => {
  const store = makeStore();
  const first = executeToolCall(call("log_entries", { entries: gymEntries() }, "gym"), ctx(store, { userText: gymMessage }));
  const chat = applyEffects(emptyChat(), first.effects);
  const again = executeToolCall(
    call("log_entries", {
      entries: [
        raw("workout", {
          title: "Leg day",
          source: "leg press 12,10,10,8; RDL 3x10; hips 12 reps",
          exercises: [
            ex("Deadlift", sets(1, 5, 999)),
            ex("Leg press", [{ reps: 12, weight: 40, done: true }, { reps: 10, weight: 70, done: true }, { reps: 10, weight: 90, done: true }, { reps: 8, weight: 100, done: true }]),
            ex("Romanian deadlift", sets(3, 10, 40)),
            ex("Hip abduction", sets(2, 12, 60)),
            ex("Hip adduction", sets(2, 12, 60)),
          ],
        }),
      ],
    }, "later"),
    ctx(store, { state: store.get(), pending: chat.pending, turnId: "turn-2", turnTargets: [], userText: "leg press 12,10,10,8; RDL 3x10; hips 12 reps" }),
  );
  const next = applyEffects(chat, again.effects);
  const workouts = store.get().entries.filter((e) => e.type === "workout");
  assert.equal(workouts.length, 1);
  assert.equal(workouts[0].exercises.length, 7);
  assert.equal(workouts[0].exercises.find((x) => x.name === "Deadlift").sets[0].weight, 80, "a saved exercise is not overwritten by a re-send");
  assert.deepEqual(next.pending.map((p) => p.type), ["food"], "the workout's waiting item is resolved");
});

test("a past-tense copy marked planned joins the real workout, and a finished meal logged again is not duplicated", () => {
  const store = makeStore();
  const copy = raw("workout", { title: "Leg Press - Set 1", status: "planned", source: "then i did leg press of 4 sets", exercises: [ex("Deadlift", sets(1, 6, 80)), ex("Leg extension", sets(2, 12, 57))] });
  const first = executeToolCall(
    call("log_entries", { entries: [raw("workout", { title: "Gym", source: "6 reps of deadlifts", exercises: [ex("Deadlift", sets(1, 6, 80)), ex("Leg extension", sets(2, 12, 57))] }), copy] }, "a"),
    ctx(store),
  );
  const workouts = store.get().entries.filter((e) => e.type === "workout");
  assert.equal(workouts.length, 1);
  assert.equal(workouts[0].status, "done");
  assert.deepEqual(workouts[0].exercises.map((x) => x.sets.length), [1, 2], "identical copies do not double the sets");
  assert.equal(first.result.needsDetails.length, 0);

  const tomorrow = executeToolCall(
    call("log_entries", { entries: [raw("workout", { title: "Legs", status: "planned", date: "2026-09-14", source: "I'll do legs tomorrow", exercises: [ex("Squat", sets(3, 5, 100))] })] }, "b"),
    ctx(store, { state: store.get(), turnId: "t2" }),
  );
  assert.equal(tomorrow.result.logged[0].status, undefined);
  assert.equal(store.get().entries.find((e) => e.date === "2026-09-14").status, "planned", "real plans stay planned");

  const meal = (id) => call("log_entries", { entries: [raw("food", { title: "Food", source: "fish, eggs, potato and rice", items: [
    { name: "Pink perch", servings: 3, calories: 100, protein: 20, carbs: 0, fat: 5, estimated: true, estimateNote: "" },
    { name: "Fried eggs", servings: 2, calories: 90, protein: 6, carbs: 0, fat: 7, estimated: true, estimateNote: "" },
  ] })] }, id);
  executeToolCall(meal("m1"), ctx(store, { state: store.get(), turnId: "t3" }));
  const again = executeToolCall(meal("m2"), ctx(store, { state: store.get(), turnId: "t4", turnTargets: [] }));
  assert.equal(store.get().entries.filter((e) => e.type === "food").length, 1);
  assert.equal(again.result.duplicates, 1);
});

test("details the user gave but the model left out, and meals without foods, are sent back once", async () => {
  const { mentions } = await import("../src/chat-tools.js");
  assert.equal(mentions("hip abduction and adduction were 12 reps each set", "Hip adduction"), true);
  assert.equal(mentions("hip abduction and adduction were 12 reps each set", "Leg press"), false);
  assert.equal(mentions("romanian deadlifts 3 sets of 10", "Romanian deadlift"), true);

  const store = makeStore();
  const first = executeToolCall(call("log_entries", { entries: gymEntries() }, "gym"), ctx(store, { userText: gymMessage }));
  const chat = applyEffects(emptyChat(), first.effects);
  const gym = first.result.needsDetails.find((w) => w.type === "workout");
  const answerText = "leg press 12,10,10,8 at 40,70,90,100. romanian deadlifts 3 sets of 10. hip abduction and adduction were 12 reps each set";
  const partial = executeToolCall(
    call("log_entries", { entries: [raw("workout", { source: "leg press", resolves: gym.id, exercises: [ex("Leg press", [{ reps: 12, weight: 40, done: true }, { reps: 10, weight: 70, done: true }, { reps: 10, weight: 90, done: true }, { reps: 8, weight: 100, done: true }])] })] }, "p"),
    ctx(store, { state: store.get(), pending: chat.pending, turnId: "t2", turnTargets: [], userText: answerText, latestUserText: answerText }),
  );
  assert.match(partial.result.hint, /gives details for Romanian deadlift, Hip abduction, Hip adduction/);
  assert.deepEqual(partial.effects.retry, { tool: "log_entries", types: ["workout"] });

  const store2 = makeStore();
  const empty = executeToolCall(call("log_entries", { entries: [raw("food", { title: "Food", source: "i ate fish and rice" })] }, "e"), ctx(store2));
  assert.match(empty.result.hint, /had no foods/);
  assert.deepEqual(empty.effects.retry, { tool: "log_entries", types: ["food"] });
});

test("an incomplete fragment of an activity saved in the same message is not left waiting", () => {
  const store = makeStore();
  const out = executeToolCall(
    call("log_entries", { entries: [raw("cardio", { title: "Cardio", minutes: 12, source: "10 minutes of cardio" }), raw("cardio", { title: "Cardio", source: "then 2 minutes at incline 12" })] }, "c"),
    ctx(store),
  );
  assert.equal(store.get().entries.length, 1);
  assert.deepEqual(out.result.needsDetails, []);
  const separate = executeToolCall(
    call("log_entries", { entries: [raw("cardio", { title: "Cycling", source: "cycled in the evening" })] }, "d"),
    ctx(store, { state: store.get(), turnId: "t2", turnTargets: [] }),
  );
  assert.equal(separate.result.needsDetails.length, 1, "a different session still asks for its duration");
});

test("a correction naming some exercises keeps the others and answers the matching waiting questions", () => {
  const store = makeStore();
  const first = executeToolCall(call("log_entries", { entries: gymEntries() }, "gym"), ctx(store, { userText: gymMessage }));
  const chat = applyEffects(emptyChat(), first.effects);
  const workout = store.get().entries.find((e) => e.type === "workout");
  const fix = executeToolCall(
    call("update_entry", { id: workout.id, changes: raw("workout", { exercises: [ex("Romanian deadlift", sets(3, 10, 40)), ex("Hip abduction", sets(2, 12, 60)), ex("Hip adduction", sets(2, 12, 60))] }) }, "u"),
    ctx(store, { state: store.get(), pending: chat.pending, turnId: "t2" }),
  );
  const next = applyEffects(chat, fix.effects);
  const saved = store.get().entries.find((e) => e.type === "workout");
  assert.deepEqual(saved.exercises.map((x) => x.name), ["Deadlift", "Leg extension", "Hamstring curl", "Romanian deadlift", "Hip abduction", "Hip adduction"]);
  const gym = next.pending.find((p) => p.type === "workout");
  assert.deepEqual(gym.questions, ["Leg press: reps and weight for each set?"], "only the leg press is still waiting");
  assert.deepEqual(fix.result.stillNeeded[0].questions, gym.questions);
});

test("waiting items saved under the old rules are re-checked: the session saves as one workout and only real gaps remain", async () => {
  const { staleState } = await import("./fixtures-stale-chat.mjs");
  const { recheckPending, RULES_VERSION } = await import("../src/chat-tools.js");
  const { state, chat: oldChat } = staleState(TODAY);
  const store = makeStore(state);
  const result = recheckPending(oldChat, { state: store.get(), commit: store.commit, today: TODAY, now: "15:40", logDate: TODAY });
  assert.ok(result, "stale items are detected");
  const chat = applyEffects({ ...oldChat, pending: result.current }, result.out.effects);
  const entries = store.get().entries;
  assert.equal(entries.filter((e) => e.type === "cardio").length, 1, "the saved cardio is untouched");
  const workouts = entries.filter((e) => e.type === "workout");
  assert.equal(workouts.length, 1);
  assert.deepEqual(workouts[0].exercises.map((x) => x.name), ["Leg press", "Deadlift", "Leg extension", "Hamstring curl"]);
  const meal = entries.find((e) => e.type === "food");
  assert.deepEqual(meal.items.map((i) => i.name), ["Fried eggs"]);
  assert.ok(chat.pending.every((p) => p.rulesVersion === RULES_VERSION));
  const questions = chat.pending.flatMap((p) => p.questions);
  assert.ok(!questions.some((q) => /how long|minutes/i.test(q)), "no duration questions survive");
  assert.deepEqual(questions, [
    "Romanian deadlift: how many reps?",
    "Hip abduction: how many reps in each set?",
    "Hip adduction: how many reps in each set?",
    "Pink Perch fish: about how many calories?",
    "Potato: roughly how much did you have?",
    "Rice: roughly how much did you have?",
  ]);
  assert.equal(recheckPending(chat, { state: store.get(), commit: store.commit, today: TODAY }), null, "a second load changes nothing");
});

test("an activity identical to one saved earlier that day is not saved again", () => {
  const store = makeStore();
  executeToolCall(call("log_entries", { entries: [raw("cardio", { title: "Cardio", minutes: 12, source: "cardio" })] }, "a"), ctx(store));
  const again = executeToolCall(
    call("log_entries", { entries: [raw("cardio", { title: "Treadmill", notes: "speed 6, incline 3", minutes: 12, source: "cardio again" })] }, "b"),
    ctx(store, { state: store.get(), turnId: "t2", turnTargets: [] }),
  );
  assert.equal(store.get().entries.length, 1);
  assert.equal(again.result.duplicates, 1);
  assert.match(again.result.replyGuidance, /already saved earlier/);
  const evening = executeToolCall(
    call("log_entries", { entries: [raw("cardio", { title: "Cardio", minutes: 12, time: "19:00", source: "cardio in the evening" })] }, "c"),
    ctx(store, { state: store.get(), turnId: "t3", turnTargets: [] }),
  );
  assert.equal(evening.result.logged.length, 1, "a session at a different stated time still saves");
});

test("resending the same message does not save its activities again, even with different details", async () => {
  const data = makeStore();
  let chat = emptyChat();
  const store = { get: () => chat, set: (fn) => (chat = fn(chat)) };
  const say = (content) => ({ message: { role: "assistant", content, tool_calls: null } });
  const cardio = (extra) => ({ message: { role: "assistant", content: null, tool_calls: [call("log_entries", { entries: [raw("cardio", { title: "Cardio", source: "10 minutes of cardio", ...extra })] }, `c${Math.random()}`)] } });
  const replies = [cardio({ minutes: 12 }), say("Logged."), cardio({ title: "Treadmill", minutes: 10, distance: 1 }), say("Logged.")];
  const fetchImpl = async () => ({ ok: true, json: async () => replies.shift() });
  const text = "I went to the gym and did 10 minutes of cardio then 2 minutes at incline 12";
  await runTurn({ text, store, data, logDate: TODAY, today: TODAY, fetchImpl });
  await runTurn({ text, store, data, logDate: TODAY, today: TODAY, fetchImpl });
  assert.equal(data.get().entries.length, 1);
});

test("re-checking gaps from an earlier version keeps them part of the saved workout and meal, and waiting foods join that meal", async () => {
  const { staleState } = await import("./fixtures-stale-chat.mjs");
  const { recheckPending, fillFoodNutrition } = await import("../src/chat-tools.js");
  const { state, chat: oldChat } = staleState(TODAY);
  const store = makeStore(state);
  const first = recheckPending(oldChat, { state: store.get(), commit: store.commit, today: TODAY, now: "15:40", logDate: TODAY });
  // Stored by the previous app version, then opened again.
  let chat = applyEffects({ ...oldChat, pending: first.current }, first.out.effects);
  chat = { ...chat, pending: chat.pending.map((p) => ({ ...p, rulesVersion: 2 })) };
  const again = recheckPending(chat, { state: store.get(), commit: store.commit, today: TODAY, now: "16:00", logDate: TODAY });
  assert.deepEqual(again.out.result.needsDetails.map((n) => n.id), chat.pending.map((p) => p.id), "the same waiting items come back");
  assert.ok(again.out.result.needsDetails.every((n) => n.partOf), "still part of the saved entries");
  const fetchImpl = async (_url, opts) => ({ ok: true, json: async () => ({ foods: JSON.parse(opts.body).foods.map((f) => ({ name: f.name, servings: f.servings ?? 1, portion: "typical", calories: 150, protein: 5, carbs: 20, fat: 4 })) }) });
  const out = await fillFoodNutrition(again.out, { state: store.get(), commit: store.commit, today: TODAY, now: "16:00", logDate: TODAY, pending: again.current, callId: again.callId, description: "potato and rice", fetchImpl });
  chat = applyEffects({ ...chat, pending: again.current }, out.effects);
  const meals = store.get().entries.filter((e) => e.type === "food");
  assert.equal(meals.length, 1, "no second meal");
  assert.deepEqual(meals[0].items.map((i) => [i.name, i.estimated]), [["Fried eggs", false], ["Pink Perch fish", true], ["Potato", true], ["Rice", true]]);
  assert.equal(store.get().entries.filter((e) => e.type === "workout").length, 1, "no second workout");
  assert.deepEqual(chat.pending.map((p) => p.type), ["workout"]);
});

test("the app's muscle for a known exercise wins over the model's pick, and saved assistant workouts are repaired", async () => {
  const { repairAssistantMuscles } = await import("../src/domain.js");
  const store = makeStore();
  executeToolCall(
    call("log_entries", { entries: [raw("workout", { source: "hip adduction and abduction 2x12 at 60", exercises: [ex("Hip adduction", sets(2, 12, 60), "quadriceps"), ex("Hip abduction", sets(2, 12, 60), "gluteal"), ex("Cable woodpecker", sets(1, 10, 20), "obliques")] })] }, "m"),
    ctx(store),
  );
  const saved = store.get().entries.find((e) => e.type === "workout");
  assert.deepEqual(saved.exercises.map((x) => x.muscle), ["adductor", "abductors", "obliques"]);

  const old = { ...store.get(), entries: [{ ...saved, exercises: saved.exercises.map((x) => ({ ...x, muscle: "quadriceps" })) }, { ...saved, id: "manual", sourceBatch: "", exercises: [{ ...saved.exercises[0], muscle: "gluteal" }] }] };
  const { state: repaired, changed } = repairAssistantMuscles(old);
  assert.equal(changed, 2);
  assert.deepEqual(repaired.entries[0].exercises.map((x) => x.muscle), ["adductor", "abductors", "quadriceps"], "unknown exercises keep their muscle");
  assert.equal(repaired.entries[1].exercises[0].muscle, "gluteal", "entries typed in by hand are left alone");
});

test("a corrected meal replaces the saved foods and is re-estimated from the user's words (real conversation, 2026-09-13)", async () => {
  const data = makeStore();
  let chat = emptyChat();
  const store = { get: () => chat, set: (fn) => (chat = fn(chat)) };
  const first = executeToolCall(
    call("log_entries", { entries: [raw("food", { title: "Lunch", source: "fish, eggs, potato and rice", items: [
      { name: "Pink Perch fish", servings: 3, calories: 150, protein: 15, carbs: 3, fat: 8, estimated: true, estimateNote: "typical" },
      { name: "Fried eggs", servings: 2, calories: 90, protein: 6, carbs: 1, fat: 7, estimated: true, estimateNote: "typical" },
      { name: "Potato", servings: 1, calories: 150, protein: 4, carbs: 34, fat: 0, estimated: true, estimateNote: "typical" },
      { name: "Rice", servings: 1, calories: 200, protein: 4, carbs: 44, fat: 0, estimated: true, estimateNote: "typical" },
    ] })] }, "old"),
    ctx(data),
  );
  const mealId = first.result.logged[0].id;
  const words = "i think the calories are wrong. a big plate of red rice, 2 Pink Perch body and tail fried, 2 fried eggs, 1 big piece of fish with curry, potato curry one spoon";
  const food = (name, servings) => ({ name, servings, calories: null, protein: null, carbs: null, fat: null, estimated: false, estimateNote: "" });
  const nutritionBodies = [];
  const replies = [
    { message: { role: "assistant", content: null, tool_calls: [call("update_entry", { id: mealId, replaceList: true, changes: raw("food", { items: [food("red rice", 1), food("Pink Perch, fried", 2), food("eggs, fried", 2), food("fish curry", 1), food("potato curry", 1)] }) }, "fix")] } },
    (body) => {
      const result = JSON.parse(body.messages.at(-1).content);
      assert.match(result.nutrition, /estimated by the app/);
      return { message: { role: "assistant", content: "Updated your lunch with new estimates.", tool_calls: null } };
    },
  ];
  const kcal = { "red rice": 585, "Pink Perch, fried": 360, "eggs, fried": 90, "fish curry": 350, "potato curry": 50 };
  const fetchImpl = async (url, opts) => {
    const body = JSON.parse(opts.body);
    if (url === "/api/nutrition") {
      nutritionBodies.push(body);
      return { ok: true, json: async () => ({ foods: body.foods.map((f) => ({ name: f.name, servings: f.servings ?? 1, portion: "home portion", calories: kcal[f.name], protein: 10, carbs: 20, fat: 10 })) }) };
    }
    let next = replies.shift();
    if (typeof next === "function") next = next(body);
    return { ok: true, json: async () => next };
  };
  await runTurn({ text: words, store, data, logDate: TODAY, today: TODAY, fetchImpl });
  const meals = data.get().entries.filter((e) => e.type === "food");
  assert.equal(meals.length, 1);
  assert.deepEqual(meals[0].items.map((i) => i.name), ["red rice", "Pink Perch, fried", "eggs, fried", "fish curry", "potato curry"], "the old foods are gone");
  assert.equal(totals(data.get().entries).calories, 585 + 720 + 180 + 350 + 50);
  assert.ok(meals[0].items.every((i) => i.estimated && i.estimateNote === "home portion"));
  assert.equal(nutritionBodies[0].description, words);
  assert.equal(chat.messages.at(-1).content, "Updated your lunch with new estimates.");

  // Without replaceList, a correction only changes the foods it names.
  const partial = executeToolCall(
    call("update_entry", { id: mealId, changes: raw("food", { items: [{ name: "potato curry", servings: 2, calories: 50, protein: 1, carbs: 6, fat: 2, estimated: true, estimateNote: "" }] }) }, "partial"),
    ctx(data, { state: data.get() }),
  );
  assert.equal(partial.result.error, undefined);
  assert.equal(data.get().entries.find((e) => e.type === "food").items.length, 5);
});

test("meals estimated earlier are estimated again from the message that logged them; the user's own numbers stay", async () => {
  const { reestimateMeals } = await import("../src/chat-tools.js");
  const store = makeStore();
  const words = "i ate Pink Perch fish fried. 2 big peices of its torso to tail and 1 small curry piece, i had 2 eggs fried, then i had potato curry and 1 plate of rice today.";
  const logged = executeToolCall(
    call("log_entries", { entries: [raw("food", { title: "Food", source: words, items: [
      { name: "Pink Perch fish, fried", servings: 3, calories: 150, protein: 15, carbs: 3, fat: 8, estimated: true, estimateNote: "one piece" },
      { name: "eggs, fried", servings: 2, calories: 70, protein: 6, carbs: 0, fat: 5, estimated: false, estimateNote: "" },
      { name: "rice", servings: 1, calories: 200, protein: 4, carbs: 44, fat: 0, estimated: true, estimateNote: "1 cup" },
    ] })] }, "food"),
    ctx(store),
  );
  const chat = {
    ...emptyChat(),
    messages: [
      { id: "u", role: "user", content: words, turnId: "t1" },
      { id: "c", role: "tool", tool_call_id: "food", name: "log_entries", content: "{}", card: logged.effects.card, turnId: "t1" },
    ],
  };
  const bodies = [];
  const fetchImpl = async (_url, opts) => {
    const body = JSON.parse(opts.body);
    bodies.push(body);
    return { ok: true, json: async () => ({ foods: body.foods.map((f) => ({ name: f.name, servings: f.servings ?? 1, portion: "home portion", calories: f.name === "rice" ? 390 : 250, protein: 10, carbs: 20, fat: 10 })) }) };
  };
  const results = await reestimateMeals({ state: store.get(), chat, today: TODAY, fetchImpl });
  assert.equal(results.length, 1);
  assert.deepEqual(bodies[0].foods, [{ name: "Pink Perch fish, fried", servings: 3 }, { name: "rice", servings: 1 }]);
  assert.equal(bodies[0].description, words);
  assert.deepEqual(results[0].after.items.map((i) => [i.name, i.calories, i.estimated]), [["Pink Perch fish, fried", 250, true], ["eggs, fried", 70, false], ["rice", 390, true]]);
  assert.deepEqual(await reestimateMeals({ state: store.get(), chat: emptyChat(), today: TODAY, fetchImpl }), [], "meals not shown in the conversation are left alone");
  assert.deepEqual(await reestimateMeals({ state: store.get(), chat, today: TODAY, fetchImpl, skip: [results[0].before.id] }), []);
});

test("weights built up set by set are worked out by the app (real conversation, 2026-09-13)", async () => {
  const { statedWeights } = await import("../src/chat-tools.js");
  const message =
    "then i did leg press of 4 sets. 1st set of 40 kg, 2nd i added 2 plates 15kg, 3rd set i added 2 plates 10kg, then 4th set i added 2 plates of 5 kg. rep range 8-12. then i did 6 reps of deadlisfts 80kg. then 40kg of Romanian Deadlifts. then 2 sets of 12 reps leg extention with 57kg, then 2 sets of hip abduction with 60kg the and same 2 sets with 60kg hip adduction.";
  const names = ["Leg press", "Deadlift", "Romanian deadlift", "Leg extension", "Hip abduction", "Hip adduction"];
  assert.deepEqual(statedWeights(message, "Leg press", names).progression, [40, 70, 90, 100]);
  assert.equal(statedWeights(message, "Deadlift", names).single, 80, "a typo in the exercise name still finds its clause");
  assert.equal(statedWeights(message, "Leg extension", names).single, 57);
  assert.equal(statedWeights(message, "Hip adduction", names).single, 60);
  assert.deepEqual(statedWeights("bench 60kg, then added 10kg each side, then added 5kg each side", "Bench press").progression, [60, 80, 90]);
  assert.deepEqual(statedWeights("squat 100kg then removed 2 plates of 10kg", "Squat").progression, [100, 80]);
  assert.equal(statedWeights("leg press 40, 70, 90 and 100 kg", "Leg press").single, null, "a list of weights is not one weight");

  // The model got the plate maths wrong and left the hip weights out.
  const store = makeStore();
  const out = executeToolCall(
    call("log_entries", { entries: [raw("workout", { title: "Legs", source: message, exercises: [
      ex("Leg press", [{ reps: null, weight: 40, done: true }, { reps: null, weight: 70, done: true }, { reps: null, weight: 80, done: true }, { reps: null, weight: 90, done: true }]),
      ex("Deadlift", sets(1, 6, 80)),
      ex("Hip abduction", sets(2, null, null)),
      ex("Hip adduction", sets(2, 12, null)),
    ] })] }, "legs"),
    ctx(store, { userText: message, latestUserText: message }),
  );
  const waiting = applyEffects(emptyChat(), out.effects).pending[0];
  const legPress = waiting.draft.entry.exercises.find((x) => x.name === "Leg press");
  assert.deepEqual(legPress.sets.map((x) => x.weight), [40, 70, 90, 100]);
  assert.deepEqual(waiting.questions, ["Leg press: how many reps in each set?", "Hip abduction: how many reps in each set?"], "only the reps they didn't give are asked");
  const saved = store.get().entries.find((e) => e.type === "workout");
  assert.deepEqual(saved.exercises.find((x) => x.name === "Hip adduction").sets.map((x) => x.weight), [60, 60]);
  assert.deepEqual(out.result.weightsWorkedOut, ["Leg press: 40, 70, 90, 100 kg", "Hip abduction: 60 kg", "Hip adduction: 60 kg"]);

  // A set-by-set change on a later set doesn't shrink the exercise.
  const later = makeStore();
  executeToolCall(
    call("log_entries", { entries: [raw("workout", { source: "x", exercises: [ex("Squat", [{ reps: 5, weight: 60, done: true }, { reps: 5, weight: 60, done: true }, { reps: 5, weight: 70, done: true }])] })] }, "sq"),
    ctx(later, { userText: "squat 3 sets of 5 at 60kg and added 10kg for the last set", latestUserText: "squat 3 sets of 5 at 60kg and added 10kg for the last set" }),
  );
  assert.deepEqual(later.get().entries[0].exercises[0].sets.map((x) => x.weight), [60, 60, 70]);
});

test("correcting weights keeps the reps already saved", () => {
  const store = makeStore();
  const first = executeToolCall(
    call("log_entries", { entries: [raw("workout", { source: "leg press", exercises: [ex("Leg press", [{ reps: 12, weight: 40, done: true }, { reps: 12, weight: 70, done: true }, { reps: 10, weight: 20, done: true }, { reps: 10, weight: 10, done: true }])] })] }, "a"),
    ctx(store),
  );
  const id = first.result.logged[0].id;
  const words = "my leg press sets were 40, 70, 90 and 100 kg";
  const fix = executeToolCall(
    call("update_entry", { id, changes: raw("workout", { title: "Workout", notes: "4 sets · 1 exercise", exercises: [ex("Leg press", [{ reps: 12, weight: 40, done: true }, { reps: 12, weight: 70, done: true }, { reps: 10, weight: 90, done: true }, { reps: 10, weight: 100, done: true }])] }) }, "b"),
    ctx(store, { state: store.get(), userText: words, latestUserText: words }),
  );
  assert.equal(fix.result.error, undefined);
  assert.deepEqual(store.get().entries[0].exercises[0].sets.map((x) => [x.reps, x.weight]), [[12, 40], [12, 70], [10, 90], [10, 100]]);
  assert.deepEqual([store.get().entries[0].title, store.get().entries[0].notes], ["", ""], "a copied summary and a generic title are not saved");
  assert.ok(!fix.result.changes.some((c) => /title/.test(c)));
});

test("a leg press of 4 sets never saves as 6, however the model repeats the sets", () => {
  const message = "then i did leg press of 4 sets. 1st set of 40 kg, 2nd i added 2 plates 15kg, 3rd set i added 2 plates 10kg, then 4th set i added 2 plates of 5 kg. rep range 8-12.";
  const lp = (weights, reps = 12) => ex("Leg press", weights.map((weight) => ({ reps, weight, done: true })));
  // Repeated inside one exercise.
  const one = makeStore();
  executeToolCall(call("log_entries", { entries: [raw("workout", { source: message, exercises: [lp([40, 70, 90, 100, 90, 100])] })] }, "a"), ctx(one, { userText: message, latestUserText: message }));
  assert.deepEqual(one.get().entries[0].exercises[0].sets.map((x) => x.weight), [40, 70, 90, 100]);
  // Split across two entries of the same session.
  const two = makeStore();
  executeToolCall(
    call("log_entries", { entries: [raw("workout", { source: message, exercises: [lp([40, 70, 90, 100])] }), raw("workout", { title: "Leg press sets 3-4", source: "3rd and 4th sets", exercises: [lp([90, 100])] })] }, "b"),
    ctx(two, { userText: message, latestUserText: message }),
  );
  assert.deepEqual(two.get().entries.filter((e) => e.type === "workout").flatMap((e) => e.exercises.map((x) => x.sets.map((s) => s.weight))), [[40, 70, 90, 100]]);
});

test("corrections change only what the user corrected", () => {
  const set = (reps, weight) => ({ reps, weight, done: true });
  const saved = () => {
    const store = makeStore();
    const out = executeToolCall(
      call("log_entries", { entries: [raw("workout", { source: "gym", exercises: [ex("Leg press", [set(12, 40), set(12, 70), set(10, 20), set(10, 10)]), ex("Deadlift", sets(1, 6, 80)), ex("Leg extension", sets(2, 12, 57))] })] }, "s"),
      ctx(store),
    );
    return { store, id: out.result.logged[0].id };
  };
  const fix = (store, id, words, changes, extra = {}) =>
    executeToolCall(call("update_entry", { id, changes: raw("workout", changes), ...extra }, "f"), ctx(store, { state: store.get(), userText: words, latestUserText: words }));
  const legPress = (store) => store.get().entries[0].exercises.find((x) => x.name === "Leg press").sets.map((x) => [x.reps, x.weight]);

  // The model repeats the corrected sets: still 4 sets.
  let { store, id } = saved();
  fix(store, id, "my leg press sets were 40, 70, 90 and 100 kg", { exercises: [ex("Leg press", [set(12, 40), set(12, 70), set(10, 90), set(10, 100), set(10, 90), set(10, 100)])] });
  assert.deepEqual(legPress(store), [[12, 40], [12, 70], [10, 90], [10, 100]]);

  // The model marks one exercise as the whole list: the others stay.
  ({ store, id } = saved());
  fix(store, id, "leg press was 40, 70, 90, 100", { exercises: [ex("Leg press", [set(12, 40), set(12, 70), set(10, 90), set(10, 100)])] }, { replaceList: true });
  assert.deepEqual(store.get().entries[0].exercises.map((x) => x.name), ["Leg press", "Deadlift", "Leg extension"]);

  // The model changes reps the user didn't mention: the saved reps stay.
  ({ store, id } = saved());
  const out = fix(store, id, "fix my leg press, i kept adding weight: 40, 70, 90, 100", { exercises: [ex("Leg press", [set(12, 40), set(12, 70), set(12, 90), set(10, 100)])] });
  assert.equal(out.result.error, undefined);
  assert.deepEqual(legPress(store), [[12, 40], [12, 70], [10, 90], [10, 100]]);

  // More sets the user did report are kept.
  ({ store, id } = saved());
  fix(store, id, "I did 2 more sets of leg press at 100 kg, 10 reps", { exercises: [ex("Leg press", [set(12, 40), set(12, 70), set(10, 20), set(10, 10), set(10, 100), set(10, 100)])] });
  assert.equal(legPress(store).length, 6);
});

test("sleep and nap durations are worked out from start and end times (real conversation, 2026-09-13)", async () => {
  const { minutesBetween } = await import("../src/day-import.js");
  assert.equal(minutesBetween("03:00", "08:40"), 340);
  assert.equal(minutesBetween("15:30", "18:40"), 190);
  assert.equal(minutesBetween("23:00", "07:00"), 480, "past midnight");
  assert.equal(minutesBetween("", "07:00"), 0);

  const store = makeStore();
  const words = "i slept at 3 am in the morning woke up at 8:40 am. then i took a nap at 3:30 pm then woke up at 6:40";
  const out = executeToolCall(
    call("log_entries", { entries: [
      raw("sleep", { title: "Sleep", time: "03:00", endTime: "08:40", minutes: null, source: "i slept at 3 am in the morning woke up at 8:40 am" }),
      raw("sleep", { title: "Nap", time: "15:30", endTime: "18:40", minutes: 200, source: "then i took a nap at 3:30 pm then woke up at 6:40" }),
    ] }, "sleep"),
    ctx(store, { userText: words, latestUserText: words }),
  );
  assert.deepEqual(out.result.needsDetails, [], "nothing is asked");
  assert.deepEqual(store.get().entries.map((e) => [e.title, e.time, e.minutes]), [["Sleep", "03:00", 340], ["Nap", "15:30", 190]], "the app's arithmetic replaces the model's");
  assert.equal(totals(store.get().entries).sleep, 530);

  // A sleep that was waiting for its duration is completed from the times.
  const waiting = makeStore();
  const first = executeToolCall(call("log_entries", { entries: [raw("sleep", { title: "Sleep", time: "23:30", source: "went to bed at 11:30" })] }, "w"), ctx(waiting));
  const pending = applyEffects(emptyChat(), first.effects).pending;
  assert.equal(pending.length, 1);
  executeToolCall(
    call("log_entries", { entries: [raw("sleep", { title: "Sleep", time: "23:30", endTime: "07:15", resolves: pending[0].id, source: "woke up at 7:15" })] }, "w2"),
    ctx(waiting, { state: waiting.get(), pending }),
  );
  assert.equal(waiting.get().entries[0].minutes, 465);

  // A model without strict schemas can leave endTime out.
  const loose = makeStore();
  const noEnd = raw("cardio", { title: "Run", minutes: 30, source: "ran 30 min" });
  delete noEnd.endTime;
  assert.equal(executeToolCall(call("log_entries", { entries: [noEnd] }, "l"), ctx(loose)).result.error, undefined);
});

test("a waiting meditation gets its rating and a corrected date, whichever tool the model uses (real conversation, 2026-09-14)", async () => {
  const { loggingDay } = await import("../src/domain.js");
  assert.equal(loggingDay(new Date("2026-09-14T00:06:00")), "2026-09-13", "just after midnight it's still the day that ended");
  assert.equal(loggingDay(new Date("2026-09-14T04:00:00")), "2026-09-14");

  const TOMORROW = "2026-09-14";
  const first = (store) => {
    const out = executeToolCall(call("log_entries", { entries: [raw("meditation", { title: "Meditation", minutes: 5, source: "i meditated for 5 minutes today" })] }, "m1"), ctx(store, { today: TOMORROW, logDate: TOMORROW }));
    return applyEffects(emptyChat(), out.effects);
  };
  const words = "i meditated for 5 minutes of september 13th not september 14th. it was 1 out of 5 rating";

  // The model aims update_entry at the waiting item.
  let store = makeStore();
  let chat = first(store);
  assert.deepEqual(chat.pending[0].questions, ["Rate meditation quality from 1 to 5."]);
  const viaUpdate = executeToolCall(
    call("update_entry", { id: chat.pending[0].id, changes: raw("meditation", { date: "2026-09-13", quality: 1 }) }, "m2"),
    ctx(store, { today: TOMORROW, logDate: TOMORROW, pending: chat.pending, userText: words, latestUserText: words }),
  );
  chat = applyEffects(chat, viaUpdate.effects);
  assert.deepEqual(store.get().entries.map((e) => [e.date, e.minutes, e.quality]), [["2026-09-13", 5, 1]]);
  assert.deepEqual(chat.pending, []);

  // The model logs it again without resolves.
  store = makeStore();
  chat = first(store);
  const viaLog = executeToolCall(
    call("log_entries", { entries: [raw("meditation", { title: "Meditation", date: "2026-09-13", minutes: 5, quality: 1, source: words })] }, "m3"),
    ctx(store, { today: TOMORROW, logDate: TOMORROW, pending: chat.pending, userText: words, latestUserText: words }),
  );
  chat = applyEffects(chat, viaLog.effects);
  assert.equal(store.get().entries.length, 1);
  assert.deepEqual(chat.pending, [], "the waiting item is cleared");
});

test("a waiting item completed once in a reply isn't saved again by a second call", async () => {
  const data = makeStore();
  let chat = emptyChat();
  const store = { get: () => chat, set: (fn) => (chat = fn(chat)) };
  const DAY = "2026-09-14";
  const replies = [
    { message: { role: "assistant", content: null, tool_calls: [call("log_entries", { entries: [raw("meditation", { title: "Meditation", minutes: 5, source: "i meditated for 5 minutes today" })] }, "a")] } },
    { message: { role: "assistant", content: "How would you rate it?", tool_calls: null } },
    (body) => {
      const id = body.context.pending[0].id;
      return { message: { role: "assistant", content: null, tool_calls: [
        call("log_entries", { entries: [raw("meditation", { title: "Meditation", date: "2026-09-13", minutes: 5, quality: 1, source: "5 minutes on september 13th, 1 out of 5" })] }, "b"),
        call("update_entry", { id, changes: raw("meditation", { date: "2026-09-14", quality: 1 }) }, "c"),
      ] } };
    },
    (body) => ({ message: { role: "assistant", content: null, tool_calls: [call("log_entries", { entries: [raw("meditation", { title: "Meditation", date: "2026-09-14", minutes: 5, quality: 1, resolves: JSON.parse(body.messages.find((m) => m.tool_call_id === "c").content).alreadySaved ? "p-gone" : "p-gone", source: "again" })] }, "d")] } }),
    { message: { role: "assistant", content: "Saved for September 13th.", tool_calls: null } },
  ];
  let pendingId = null;
  const fetchImpl = async (_url, opts) => {
    const body = JSON.parse(opts.body);
    let next = replies.shift();
    if (typeof next === "function") next = next(body);
    if (next.message.tool_calls?.[0]?.id === "d") {
      const args = JSON.parse(next.message.tool_calls[0].function.arguments);
      args.entries[0].resolves = pendingId;
      next.message.tool_calls[0].function.arguments = JSON.stringify(args);
    }
    return { ok: true, json: async () => next };
  };
  await runTurn({ text: "i meditated for 5 minutes today", store, data, logDate: DAY, today: DAY, fetchImpl });
  pendingId = chat.pending[0].id;
  await runTurn({ text: "i meditated for 5 minutes of september 13th not september 14th. it was 1 out of 5 rating", store, data, logDate: DAY, today: DAY, fetchImpl });
  assert.deepEqual(data.get().entries.map((e) => [e.date, e.quality]), [["2026-09-13", 1]], "saved once, on the 13th");
  assert.deepEqual(chat.pending, []);
  const second = JSON.parse(chat.messages.find((m) => m.tool_call_id === "c").content);
  assert.ok(second.alreadySaved, "the second call is told it was already saved");
});

test("'yesterday' counts from the real date, not the date picked in the composer (real conversation, 2026-09-14)", async () => {
  const { statedDay } = await import("../src/chat-tools.js");
  const DAY = "2026-09-14"; // a Monday
  assert.equal(statedDay("i had one more friend egg yesterday", DAY, "10:43"), "2026-09-13");
  assert.equal(statedDay("i had one more friend egg yesterday", DAY, "00:30"), "2026-09-12", "after midnight, yesterday is the day before the one that just ended");
  assert.equal(statedDay("brushed my teeth last night", DAY, "00:30"), "2026-09-13");
  assert.equal(statedDay("brushed my teeth last night", DAY, "08:00"), "2026-09-13");
  assert.equal(statedDay("went for a run today", DAY, "00:30"), "2026-09-13");
  assert.equal(statedDay("did legs on friday", DAY, "18:00"), "2026-09-11");
  assert.equal(statedDay("gym last monday", DAY, "18:00"), "2026-09-07");
  assert.equal(statedDay("meditated on september 13th not 14th", DAY, "10:00"), null, "an explicit date is left to the model");
  assert.equal(statedDay("ran yesterday and read today", DAY, "10:00"), null, "two different days");
  assert.equal(statedDay("i'll run tomorrow", DAY, "10:00"), null);

  const store = makeStore();
  const words = "i had one more friend egg yesterday";
  const out = executeToolCall(
    call("log_entries", { entries: [raw("food", { title: "Food", date: "2026-09-12", source: words, items: [{ name: "fried egg", servings: 1, calories: 98, protein: 6, carbs: 0.5, fat: 7.5, estimated: true, estimateNote: "one egg" }] })] }, "egg"),
    ctx(store, { today: DAY, now: "10:43", logDate: "2026-09-13", userText: words, latestUserText: words }),
  );
  assert.equal(store.get().entries[0].date, "2026-09-13");
  assert.deepEqual(out.result.datedFromTheirWords, ["2026-09-13"]);
  assert.equal(out.effects.card.entries[0].date, "2026-09-13", "the card shows the saved date");

  const split = makeStore();
  const both = "ran 5k yesterday and read 20 pages of deep work today";
  executeToolCall(
    call("log_entries", { entries: [
      raw("cardio", { title: "Run", minutes: 30, date: "2026-09-12", source: "ran 5k yesterday" }),
      raw("reading", { bookTitle: "Deep Work", pages: 20, date: "2026-09-13", source: "read 20 pages of deep work today" }),
    ] }, "two"),
    ctx(split, { today: DAY, now: "10:43", logDate: "2026-09-13", userText: both, latestUserText: both }),
  );
  assert.deepEqual(split.get().entries.map((e) => [e.type, e.date]), [["cardio", "2026-09-13"], ["reading", "2026-09-14"]], "each entry uses the day in its own words");
});

test("the chat never deletes what the user didn't ask to delete, and moves entries by changing their date (real conversation, 2026-09-14)", async () => {
  const { namesEntry } = await import("../src/chat-tools.js");
  const DAY = "2026-09-14";
  const base = { status: "done", notes: "", minutes: 0, pages: 0, chapters: 0, steps: 0, distance: 0, bpm: 0, value: 0, quality: 3, mood: "Neutral", lucid: false, section: "", unit: "", bookId: "", songId: "", habitId: "", exercises: [], items: [] };
  const item = (name, servings, calories) => ({ name, servings, calories, protein: 5, carbs: 10, fat: 5, estimated: true, estimateNote: "typical" });
  const state = emptyState();
  state.entries = [
    { ...base, id: "lunch", type: "food", date: "2026-09-13", time: "14:55", title: "Lunch", items: [item("Pink Perch fish, fried", 3, 350), item("eggs, fried", 2, 90)] },
    { ...base, id: "egg12", type: "food", date: "2026-09-12", time: "10:43", title: "", items: [item("fried egg", 1, 98)] },
    { ...base, id: "sleep14", type: "sleep", date: DAY, time: "01:03", title: "Sleep", minutes: 527 },
  ];
  const store = makeStore(validateState(state));
  const at = (words, extra = {}) => ctx(store, { state: store.get(), today: DAY, now: "10:55", logDate: "2026-09-13", userText: words, latestUserText: words, ...extra });
  const ids = () => store.get().entries.map((e) => e.id);

  const move = "move the fried egg from September 12th to September 13th";
  assert.match(executeToolCall(call("delete_entries", { ids: ["sleep14"] }, "d1"), at(move)).result.error, /didn't ask to delete/);
  assert.match(executeToolCall(call("delete_entries", { ids: ["lunch"] }, "d2"), at(move)).result.error, /didn't ask to delete/);
  assert.deepEqual(ids(), ["lunch", "egg12", "sleep14"], "nothing was deleted");

  const moved = executeToolCall(call("update_entry", { id: "egg12", changes: raw("food", { date: "2026-09-13" }) }, "u1"), at(move));
  assert.equal(moved.result.error, undefined);
  assert.equal(store.get().entries.find((e) => e.id === "egg12").date, "2026-09-13");

  assert.match(executeToolCall(call("delete_entries", { ids: ["sleep14"] }, "d3"), at("delete the fried egg I logged twice")).result.error, /doesn't match/);
  assert.equal(namesEntry("delete the fried egg", store.get().entries.find((e) => e.id === "egg12"), store.get()), true);
  executeToolCall(call("delete_entries", { ids: ["egg12"] }, "d4"), at("delete the fried egg I logged twice"));
  assert.deepEqual(ids(), ["lunch", "sleep14"]);
  executeToolCall(call("delete_entries", { ids: ["sleep14"] }, "d5"), at("remove that, it was wrong", { recentLoggedIds: ["sleep14"] }));
  assert.deepEqual(ids(), ["lunch"], "a just-logged entry can be removed without naming it");

  const more = "i had one more friend egg yesterday";
  const out = executeToolCall(
    call("log_entries", { entries: [raw("food", { title: "Food", date: "2026-09-13", source: more, items: [item("eggs, fried", 1, 98)] })] }, "l1"),
    at(more, { now: "10:55" }),
  );
  assert.equal(out.result.duplicates, 0, "one more egg isn't treated as the lunch sent again");
  assert.equal(store.get().entries.filter((e) => e.type === "food").length, 2);
  assert.match(executeToolCall(call("undo_batch", { batchId: out.result.batchId }, "x"), at("thanks", { findBatch: () => out.effects.card })).result.error, /didn't ask to undo/);

  const context = buildContext(validateState(state), emptyChat(), { today: DAY, logDate: "2026-09-13" });
  assert.deepEqual(context.recentEntries.map((e) => [e.id, e.date]), [["egg12", "2026-09-12"], ["sleep14", DAY]]);
  assert.deepEqual(context.recentEntries[0].names, ["fried egg"]);
});

test("'I meant the 13th, not the 12th' moves the entry just logged instead of logging it again", () => {
  const DAY = "2026-09-14";
  const item = (name, calories) => ({ name, servings: 1, calories, protein: 6, carbs: 1, fat: 7, estimated: true, estimateNote: "one egg" });
  const store = makeStore();
  const first = executeToolCall(call("log_entries", { entries: [raw("food", { title: "Food", date: "2026-09-12", source: "one more egg", items: [item("fried egg", 98)] })] }, "e1"), ctx(store, { today: DAY, now: "10:43", logDate: "2026-09-13" }));
  const eggId = first.result.logged[0].id;
  const words = "\"i had one more friend egg yesterday\" meaning 13th sept not 12th";
  const fix = executeToolCall(
    call("log_entries", { entries: [raw("food", { title: "Food", date: "2026-09-13", source: words, items: [item("eggs, fried", 90)] })] }, "e2"),
    ctx(store, { state: store.get(), today: DAY, now: "10:50", logDate: "2026-09-13", userText: words, latestUserText: words, recentLoggedIds: [eggId] }),
  );
  assert.deepEqual(store.get().entries.map((e) => [e.id, e.date]), [[eggId, "2026-09-13"]], "one egg, now on the 13th");
  assert.deepEqual(fix.result.moved, [{ id: eggId, title: "Food", from: "2026-09-12", to: "2026-09-13" }]);
  assert.equal(fix.effects.card.mode, "updated");
  store.commit((s) => undoBatch(s, fix.effects.card));
  assert.equal(store.get().entries[0].date, "2026-09-12", "Undo moves it back");
});

test("'move the fried egg from September 12th to September 13th' moves that egg and nothing else (real conversation, 2026-09-14)", () => {
  const DAY = "2026-09-14";
  const base = { status: "done", notes: "", minutes: 0, pages: 0, chapters: 0, steps: 0, distance: 0, bpm: 0, value: 0, quality: 3, mood: "Neutral", lucid: false, section: "", unit: "", bookId: "", songId: "", habitId: "", exercises: [], items: [] };
  const item = (name, servings, calories) => ({ name, servings, calories, protein: 10, carbs: 20, fat: 10, estimated: true, estimateNote: "typical" });
  const seed = () => {
    const state = emptyState();
    state.entries = [
      { ...base, id: "dinner13", type: "food", date: "2026-09-13", time: "19:00", title: "Dinner", items: [item("ghee dosa", 3, 400), item("chicken curry", 1, 380), item("chicken", 3, 250)] },
      { ...base, id: "egg12", type: "food", date: "2026-09-12", time: "10:43", title: "", items: [item("fried egg", 1, 98)] },
    ];
    return makeStore(validateState(state));
  };
  const words = "move the fried egg from September 12th to September 13th";
  const at = (store) => ctx(store, { state: store.get(), today: DAY, now: "11:10", logDate: DAY, userText: words, latestUserText: words });

  // What the model did: add an egg to the 13th's dinner and rename it.
  let store = seed();
  const wrong = executeToolCall(call("update_entry", { id: "dinner13", changes: raw("food", { title: "Food", items: [item("fried egg", 1, 98)] }) }, "w"), at(store));
  assert.match(wrong.result.error, /is on 2026-09-13/);
  assert.match(wrong.result.hint, /id egg12/);
  assert.deepEqual(store.get().entries.find((e) => e.id === "dinner13").items.length, 3, "dinner untouched");

  // The right entry, with extra fields the model shouldn't change.
  const right = executeToolCall(call("update_entry", { id: "egg12", changes: raw("food", { title: "Food", date: "2026-09-13", items: [item("fried egg", 2, 90)] }) }, "r"), at(store));
  assert.equal(right.result.error, undefined);
  const egg = store.get().entries.find((e) => e.id === "egg12");
  assert.deepEqual([egg.date, egg.title, egg.items[0].servings, egg.items[0].calories], ["2026-09-13", "", 1, 98], "only the date moved");

  // Logged as a new egg: the existing one is moved instead.
  store = seed();
  const relog = executeToolCall(call("log_entries", { entries: [raw("food", { title: "Food", date: "2026-09-13", source: words, items: [item("fried egg", 1, 98)] })] }, "l"), at(store));
  assert.deepEqual(store.get().entries.map((e) => [e.id, e.date]), [["dinner13", "2026-09-13"], ["egg12", "2026-09-13"]]);
  assert.equal(relog.result.moved[0].id, "egg12");

  // A specific meal name is never swapped for a generic one.
  store = seed();
  const rename = "add a fried egg to my dinner on the 13th";
  executeToolCall(call("update_entry", { id: "dinner13", changes: raw("food", { title: "Food", items: [item("fried egg", 1, 98)] }) }, "t"), ctx(store, { state: store.get(), today: DAY, now: "11:10", logDate: DAY, userText: rename, latestUserText: rename }));
  assert.equal(store.get().entries.find((e) => e.id === "dinner13").title, "Dinner");
});

test("a clear move request is done by the app without the model (real conversation, 2026-09-14)", async () => {
  const DAY = "2026-09-14";
  const base = { status: "done", notes: "", minutes: 0, pages: 0, chapters: 0, steps: 0, distance: 0, bpm: 0, value: 0, quality: 3, mood: "Neutral", lucid: false, section: "", unit: "", bookId: "", songId: "", habitId: "", exercises: [], items: [] };
  const item = (name, servings, calories) => ({ name, servings, calories, protein: 10, carbs: 20, fat: 10, estimated: true, estimateNote: "typical" });
  const state = emptyState();
  state.entries = [
    { ...base, id: "dinner13", type: "food", date: "2026-09-13", time: "19:00", title: "Dinner", items: [item("ghee dosa", 3, 400), item("chicken curry", 1, 380)] },
    { ...base, id: "egg12", type: "food", date: "2026-09-12", time: "10:43", title: "", items: [item("fried egg", 1, 98)] },
  ];
  const data = makeStore(validateState(state));
  let chat = emptyChat();
  const store = { get: () => chat, set: (fn) => (chat = fn(chat)) };
  let modelCalls = 0;
  const fetchImpl = async () => {
    modelCalls++;
    return { ok: true, json: async () => ({ message: { role: "assistant", content: "ok", tool_calls: null } }) };
  };
  await runTurn({ text: "move the fried egg from September 12th to September 13th", store, data, logDate: DAY, today: DAY, fetchImpl });
  assert.equal(modelCalls, 0);
  assert.deepEqual(data.get().entries.map((e) => [e.id, e.date, e.title, e.items.length]), [["dinner13", "2026-09-13", "Dinner", 2], ["egg12", "2026-09-13", "", 1]]);
  const card = chat.messages.find((m) => m.card)?.card;
  assert.equal(card.mode, "updated");
  assert.deepEqual(card.changes, ["date 2026-09-12 → 2026-09-13"]);
  assert.match(chat.messages.at(-1).content, /Moved Food \(98 kcal · 1 food\) from Sat 12 Sept to Sun 13 Sept\./);
  const { toApiMessages } = await import("../src/chat-history.js");
  assert.deepEqual(toApiMessages(chat.messages).map((m) => m.role), ["user", "assistant", "tool", "assistant"], "the history stays well formed for the model");

  // Nothing on that day matches: the model handles it.
  await runTurn({ text: "move my run from September 10th to September 11th", store, data, logDate: DAY, today: DAY, fetchImpl });
  assert.equal(modelCalls, 1);
});

test("grams and millilitres are amounts, not servings, and those foods are still estimated (real message, 2026-09-15)", async () => {
  const { weightsAsAmounts } = await import("../src/chat-tools.js");
  const said = "today i ate 250 gm broasted chicken, 1 kuboos, 1 porotta and 50 gm hummus.";
  const data = makeStore();
  let chat = emptyChat();
  const store = { get: () => chat, set: (fn) => (chat = fn(chat)) };
  const food = (name, servings) => ({ name, servings, calories: null, protein: null, carbs: null, fat: null, estimated: false, estimateNote: "" });
  const replies = [
    { message: { role: "assistant", content: null, tool_calls: [call("log_entries", { entries: [raw("food", { source: said, items: [food("broasted chicken", 250), food("kuboos", 1), food("porotta", 1), food("hummus", 50)] })] }, "meal")] } },
    { message: { role: "assistant", content: "Logged your food.", tool_calls: null } },
  ];
  const nutritionBodies = [];
  const fetchImpl = async (url, opts) => {
    if (url !== "/api/nutrition") return { ok: true, json: async () => replies.shift() };
    const body = JSON.parse(opts.body);
    nutritionBodies.push(body);
    return { ok: true, json: async () => nutritionReply(body) };
  };
  await runTurn({ text: said, store, data, logDate: TODAY, today: TODAY, fetchImpl });
  assert.equal(nutritionBodies.length, 1);
  assert.deepEqual(nutritionBodies[0].foods, [{ name: "broasted chicken, 250 g", servings: 1 }, { name: "kuboos", servings: 1 }, { name: "porotta", servings: 1 }, { name: "hummus, 50 g", servings: 1 }]);
  const meal = data.get().entries.find((e) => e.type === "food");
  assert.deepEqual(meal.items.map((i) => [i.name, i.servings, i.estimated]), [["broasted chicken, 250 g", 1, true], ["kuboos", 1, true], ["porotta", 1, true], ["hummus, 50 g", 1, true]]);
  assert.deepEqual(chat.pending, [], "nothing asks for calories");

  // Without the lookup, the log itself still stores one serving of the amount.
  const offline = makeStore();
  const out = executeToolCall(call("log_entries", { entries: [raw("food", { source: said, items: [food("broasted chicken", 250), food("hummus", 50)] })] }, "offline"), ctx(offline, { userText: said, latestUserText: said }));
  const waiting = out.effects.pendingAdd.find((p) => p.type === "food");
  assert.deepEqual(waiting.draft.entry.items.map((i) => [i.name, i.servings]), [["broasted chicken, 250 g", 1], ["hummus, 50 g", 1]]);

  // Counts stay counts, even with a weight elsewhere in the message.
  assert.equal(weightsAsAmounts([food("almonds", 10)], "10 almonds and 10 g dark chocolate").changed, false);
  assert.equal(weightsAsAmounts([food("eggs", 2)], "2 eggs and 200 ml milk").changed, false);
  assert.deepEqual(weightsAsAmounts([food("chicken", 200)], "chicken 200g").items[0].name, "chicken, 200 g");
  assert.deepEqual(weightsAsAmounts([{ ...food("rice", 300), calories: 390, estimated: false }], "300 g rice, 390 kcal").items[0], { ...food("rice, 300 g", 1), calories: 390, estimated: false }, "a number the user gave is kept");
});

test("foods left waiting by gram amounts are filled on reload from the message that logged them", async () => {
  const { fillFoodNutrition } = await import("../src/chat-tools.js");
  const said = "today i ate 250 gm broasted chicken, 1 kuboos, 1 porotta and 50 gm hummus.";
  const store = makeStore();
  const food = (name, servings) => ({ name, servings, calories: null, protein: null, carbs: null, fat: null, estimated: false, estimateNote: "" });
  // What the previous version left behind: 250 and 50 servings, every food asking for calories.
  const stuck = executeToolCall(call("log_entries", { entries: [raw("food", { items: [food("broasted chicken", 250), food("kuboos", 1), food("porotta", 1), food("hummus", 50)] })] }, "old"), ctx(store));
  const waiting = stuck.effects.pendingAdd.filter((p) => p.type === "food");
  assert.equal(waiting.length, 1);
  assert.equal(waiting[0].draft.entry.items[0].servings, 250);
  const bodies = [];
  const fetchImpl = async (_url, opts) => {
    const body = JSON.parse(opts.body);
    bodies.push(body);
    return { ok: true, json: async () => nutritionReply(body) };
  };
  const out = await fillFoodNutrition(
    { result: { logged: [], needsDetails: [] }, effects: { pendingAdd: waiting, pendingResolve: [] } },
    { state: store.get(), commit: store.commit, today: TODAY, now: "16:00", logDate: TODAY, pending: waiting, callId: "reload", description: "why cant it fetch?", saidFor: () => said, fetchImpl },
  );
  assert.equal(bodies[0].description, said);
  assert.deepEqual(bodies[0].foods.map((f) => [f.name, f.servings]), [["broasted chicken, 250 g", 1], ["kuboos", 1], ["porotta", 1], ["hummus, 50 g", 1]]);
  assert.deepEqual(out.effects.pendingResolve, [waiting[0].id]);
  assert.deepEqual(store.get().entries.find((e) => e.type === "food").items.map((i) => [i.name, i.servings, i.estimated]), [["broasted chicken, 250 g", 1, true], ["kuboos", 1, true], ["porotta", 1, true], ["hummus, 50 g", 1, true]]);
});
