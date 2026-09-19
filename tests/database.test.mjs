import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { openDatabase } from "../server/database.mjs";
import { dataMiddleware } from "../server/data-api.mjs";
import { emptyState } from "../src/domain.js";

const temp = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), "daybook-db-")), "daybook.db");
const book = { id: "b1", title: "Deep Work", author: "Cal Newport", totalPages: 304, totalChapters: 0, startPages: 0, startChapters: 0, status: "Reading", cover: "" };
const reading = (id, pages) => ({ id, type: "reading", date: "2026-09-14", time: "21:00", status: "done", title: "", notes: "", minutes: 20, pages, chapters: 0, steps: 0, distance: 0, bpm: 0, value: 0, quality: "", mood: "Neutral", lucid: false, section: "", unit: "", bookId: "b1", songId: "", habitId: "", exercises: [], items: [] });

test("the database keeps records across restarts, applies saves by id, and refuses invalid data", () => {
  const file = temp();
  let db = openDatabase(file);
  assert.equal(db.isEmpty(), true);
  const state = { ...emptyState(), books: [book], entries: [reading("r1", 10)] };
  state.profile.name = "Jithe";
  assert.equal(db.replaceState(state), 1);
  assert.equal(db.applyChanges({ upsert: { entries: [reading("r2", 25), { ...reading("r1", 12) }] } }), 2);
  assert.throws(() => db.applyChanges({ remove: { books: ["b1"] } }), /without its book/, "an entry can't lose its book");
  assert.throws(() => db.applyChanges({ upsert: { entries: [{ ...reading("r3", 5), date: "not a date" }] } }), /invalid date/);
  db.writeChat({ version: 1, messages: [{ id: "u1", role: "user", content: "read 12 pages" }], pending: [], events: [], logDate: null });
  db.close();

  db = openDatabase(file); // reopen from disk
  const saved = db.readState();
  assert.equal(db.version(), 3);
  assert.deepEqual(saved.entries.map((e) => [e.id, e.pages]), [["r1", 12], ["r2", 25]], "order kept, r1 updated in place");
  assert.equal(saved.books[0].title, "Deep Work");
  assert.equal(saved.profile.name, "Jithe");
  assert.equal(db.readChat().messages[0].content, "read 12 pages");
  db.applyChanges({ remove: { entries: ["r1", "r2"] }, profile: { ...saved.profile, stepsGoal: 9000 } });
  assert.deepEqual(db.readState().entries, []);
  assert.equal(db.readState().profile.stepsGoal, 9000);
  db.close();
});

async function call(handler, { url, method = "GET", body, remote = "127.0.0.1", origin = "http://localhost:5173", contentType = "application/json" }) {
  const req = Readable.from(body === undefined ? [] : [JSON.stringify(body)]);
  Object.assign(req, { url, method, headers: { host: "localhost:5173", origin, "content-type": contentType }, socket: { remoteAddress: remote } });
  let status = 200;
  let text = "";
  let passed = false;
  await handler(req, { set statusCode(v) { status = v; }, setHeader() {}, end(v) { text = v; } }, () => (passed = true));
  return { status, data: text ? JSON.parse(text) : null, passed };
}

test("the data API serves this computer only, checks where writes come from, and saves", async () => {
  const handler = dataMiddleware({ file: temp() });
  assert.equal((await call(handler, { url: "/api/chat" })).passed, true, "other routes pass through");
  const lan = await call(handler, { url: "/api/data", remote: "192.168.1.20" });
  assert.equal(lan.status, 403);
  assert.equal(lan.data.mode, "browser");
  const first = await call(handler, { url: "/api/data" });
  assert.deepEqual([first.status, first.data.mode, first.data.empty, first.data.version], [200, "database", true, 0]);
  assert.equal((await call(handler, { url: "/api/data", method: "PUT", body: { state: { ...emptyState(), books: [book] } }, origin: "https://evil.example" })).status, 403);
  assert.equal((await call(handler, { url: "/api/data", method: "PUT", body: { state: { ...emptyState(), books: [book] } }, contentType: "text/plain" })).status, 415);
  assert.deepEqual((await call(handler, { url: "/api/data", method: "PUT", body: { state: { ...emptyState(), books: [book] } } })).data, { version: 1 });
  assert.deepEqual((await call(handler, { url: "/api/data/changes", method: "POST", body: { changes: { upsert: { entries: [reading("r1", 30)] } } } })).data, { version: 2 });
  const bad = await call(handler, { url: "/api/data/changes", method: "POST", body: { changes: { upsert: { entries: [{ ...reading("x", 1), bookId: "missing" }] } } } });
  assert.equal(bad.status, 400);
  assert.match(bad.data.error, /^Not saved:/);
  assert.deepEqual((await call(handler, { url: "/api/data/chat", method: "PUT", body: { chat: { version: 1, messages: [], pending: [], events: [] } } })).data, { version: 3 });
  const after = await call(handler, { url: "/api/data" });
  assert.deepEqual([after.data.empty, after.data.version, after.data.state.entries.length, after.data.chat.messages.length], [false, 3, 1, 0]);
  assert.deepEqual((await call(handler, { url: "/api/data/version" })).data, { version: 3 });
});
