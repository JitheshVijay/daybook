#!/usr/bin/env node
// Manual live check of the chat engine against the configured provider.
// Runs the real middleware and tool executor in-process on in-memory data; nothing
// touches browser storage. Prints tool activity and replies only, never credentials.
// Usage: [SMOKE_STATE=state.json] node scripts/chat-smoke.mjs ["message one" "message two" ...]
import { Readable } from "node:stream";
import { loadEnv } from "vite";
import { assistantMiddleware } from "../server/assistant.mjs";
import { bookProgress, emptyState, validateState, dateKey } from "../src/domain.js";
import { emptyChat } from "../src/chat-history.js";
import { runTurn } from "../src/chat-loop.js";

const env = { ...loadEnv("development", process.cwd(), ""), ...process.env };
const handler = assistantMiddleware(env);
const today = dateKey();

async function localFetch(url, options) {
  const req = Readable.from([options.body]);
  Object.assign(req, {
    url,
    method: options.method,
    headers: { origin: "http://localhost:5173", host: "localhost:5173", "content-type": "application/json" },
    socket: { remoteAddress: "smoke" },
  });
  let status = 200;
  let body = "";
  await handler(req, {
    set statusCode(v) {
      status = v;
    },
    setHeader() {},
    end(v) {
      body = v;
    },
  }, () => {});
  return { ok: status < 400, status, json: async () => JSON.parse(body) };
}

// SMOKE_STATE=path/to/state.json starts from saved records instead of an empty journal.
let state = process.env.SMOKE_STATE ? validateState(JSON.parse(await import("node:fs").then((fs) => fs.readFileSync(process.env.SMOKE_STATE, "utf8")))) : emptyState();
const data = {
  get: () => state,
  commit: (update) => {
    state = validateState(typeof update === "function" ? update(state) : update);
  },
};
let chat = emptyChat();
const store = { get: () => chat, set: (fn) => (chat = fn(chat)) };

const turns = process.argv.slice(2).length
  ? process.argv.slice(2)
  : [
      "Meditated 15 min at 7am, quality 4, felt calm. Did bench press 3x10 at 40kg, about 45 minutes, at 6pm. Dinner was 2 eggs and 2 slices of toast. Also read some Deep Work.",
      "25 pages",
      "How's my protein looking this week? Show me a chart.",
    ];

for (const text of turns) {
  const before = chat.messages.length;
  const started = Date.now();
  await runTurn({ text, store, data, logDate: process.env.SMOKE_LOGDATE || today, today, fetchImpl: localFetch });
  console.log(`\n> ${text}   (${((Date.now() - started) / 1000).toFixed(1)}s)`);
  for (const m of chat.messages.slice(before)) {
    if (m.role === "user" && m.status) console.log(`  ! ${m.status}: ${m.error}`);
    if (m.role === "assistant" && m.tool_calls)
      for (const c of m.tool_calls) console.log(`  → ${c.function.name} ${c.function.arguments.length > 600 ? c.function.arguments.slice(0, 600) + "…" : c.function.arguments}`);
    if (m.role === "tool") {
      const result = JSON.parse(m.content);
      const brief = { ...result };
      if (brief.points) brief.points = `${brief.points.length} points`;
      console.log(`  ← ${m.name}: ${JSON.stringify(brief)}`);
      if (m.card) console.log(`    card: ${m.card.kind}${m.card.spec ? " " + JSON.stringify(m.card.spec) : ""}`);
    }
    if (m.role === "assistant" && m.content) console.log(`  ${m.synthetic ? "(synthetic) " : ""}Daybook: ${m.content}`);
  }
}
for (const e of state.entries) {
  if (e.type === "workout") console.log(`  workout "${e.title}": ${e.exercises.map((x) => `${x.name} ${x.sets.map((t) => `${t.reps}x${t.weight}`).join(" ")}`).join(" | ")}`);
  else if (e.type === "reading") console.log(`  reading ${state.books.find((b) => b.id === e.bookId)?.title}: ${e.pages} pages, ${e.chapters} chapters`);
  else if (e.type === "food") console.log(`  food "${e.title}": ${e.items.map((i) => `${i.servings}× ${i.name} ${i.calories}kcal${i.estimated ? " est" : ""}`).join(" | ")}`);
  else console.log(`  ${e.type} "${e.title}" ${e.minutes ?? ""} min`);
}
for (const b of state.books) { const p = bookProgress(b, state.entries); console.log(`  book "${b.title}": ${p.pages}/${b.totalPages || "?"} pages, ${p.chapters}/${b.totalChapters || "?"} chapters`); }
console.log(`\nSaved entries: ${state.entries.length} · books: ${state.books.map((b) => b.title).join(", ") || "none"} · pending: ${JSON.stringify(chat.pending.map(({ id, type, questions }) => ({ id, type, questions })))}`);
