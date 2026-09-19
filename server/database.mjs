// The Daybook database: one SQLite file on this computer (data/daybook.db by default).
// Records keep their shape from src/domain.js. Entries are indexed by type and date, and each
// record's full JSON is stored with it, so the app's own validation stays the single rulebook.
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { emptyState, validateState } from "../src/domain.js";

export const COLLECTIONS = ["entries", "books", "songs", "habits", "templates", "favorites"];
const MAX_CHAT_BYTES = 1_000_000;

export function openDatabase(file) {
  if (file !== ":memory:") fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new Database(file);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(`
    CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS profile (id INTEGER PRIMARY KEY CHECK (id = 1), data TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS entries (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      date TEXT NOT NULL,
      time TEXT NOT NULL,
      status TEXT NOT NULL,
      data TEXT NOT NULL,
      position INTEGER NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS entries_by_date ON entries (date, time);
    CREATE INDEX IF NOT EXISTS entries_by_type ON entries (type, date);
    CREATE TABLE IF NOT EXISTS books (id TEXT PRIMARY KEY, data TEXT NOT NULL, position INTEGER NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS songs (id TEXT PRIMARY KEY, data TEXT NOT NULL, position INTEGER NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS habits (id TEXT PRIMARY KEY, data TEXT NOT NULL, position INTEGER NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS templates (id TEXT PRIMARY KEY, data TEXT NOT NULL, position INTEGER NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS favorites (id TEXT PRIMARY KEY, data TEXT NOT NULL, position INTEGER NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS chat (id INTEGER PRIMARY KEY CHECK (id = 1), data TEXT NOT NULL, updated_at TEXT NOT NULL);
    INSERT OR IGNORE INTO meta (key, value) VALUES ('schema', '1'), ('version', '0');
  `);
  return createStore(db);
}

function createStore(db) {
  const now = () => new Date().toISOString();
  const getMeta = db.prepare("SELECT value FROM meta WHERE key = ?");
  const setMeta = db.prepare("INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value");
  const version = () => Number(getMeta.get("version")?.value || 0);
  const bump = () => {
    const next = version() + 1;
    setMeta.run("version", String(next));
    return next;
  };
  const selectAll = Object.fromEntries(COLLECTIONS.map((c) => [c, db.prepare(`SELECT data FROM ${c} ORDER BY position, rowid`)]));
  const upsert = {
    entries: db.prepare(
      "INSERT INTO entries (id, type, date, time, status, data, position, updated_at) VALUES (@id, @type, @date, @time, @status, @data, @position, @updated_at) ON CONFLICT(id) DO UPDATE SET type = excluded.type, date = excluded.date, time = excluded.time, status = excluded.status, data = excluded.data, position = excluded.position, updated_at = excluded.updated_at",
    ),
    ...Object.fromEntries(
      COLLECTIONS.filter((c) => c !== "entries").map((c) => [
        c,
        db.prepare(`INSERT INTO ${c} (id, data, position, updated_at) VALUES (@id, @data, @position, @updated_at) ON CONFLICT(id) DO UPDATE SET data = excluded.data, position = excluded.position, updated_at = excluded.updated_at`),
      ]),
    ),
  };
  const remove = Object.fromEntries(COLLECTIONS.map((c) => [c, db.prepare(`DELETE FROM ${c} WHERE id = ?`)]));
  const clear = Object.fromEntries(COLLECTIONS.map((c) => [c, db.prepare(`DELETE FROM ${c}`)]));
  const positionOf = Object.fromEntries(COLLECTIONS.map((c) => [c, db.prepare(`SELECT position FROM ${c} WHERE id = ?`)]));
  const lastPosition = Object.fromEntries(COLLECTIONS.map((c) => [c, db.prepare(`SELECT COALESCE(MAX(position), -1) AS position FROM ${c}`)]));
  const readProfile = db.prepare("SELECT data FROM profile WHERE id = 1");
  const writeProfile = db.prepare("INSERT INTO profile (id, data, updated_at) VALUES (1, ?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at");
  const readChat = db.prepare("SELECT data, updated_at FROM chat WHERE id = 1");
  const writeChat = db.prepare("INSERT INTO chat (id, data, updated_at) VALUES (1, ?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at");
  const counts = db.prepare(`SELECT ${COLLECTIONS.map((c) => `(SELECT COUNT(*) FROM ${c}) AS ${c}`).join(", ")}, (SELECT COUNT(*) FROM profile) AS profile`);

  function readState() {
    const profile = readProfile.get();
    const state = { ...emptyState(), ...(profile ? { profile: JSON.parse(profile.data) } : {}) };
    for (const c of COLLECTIONS) state[c] = selectAll[c].all().map((row) => JSON.parse(row.data));
    return state;
  }
  const isEmpty = () => Object.values(counts.get()).every((n) => n === 0);
  const writeRecord = (collection, record, position, stamp) =>
    upsert[collection].run(
      collection === "entries"
        ? { id: record.id, type: record.type, date: record.date, time: record.time, status: record.status, data: JSON.stringify(record), position, updated_at: stamp }
        : { id: record.id, data: JSON.stringify(record), position, updated_at: stamp },
    );
  function writeAll(state) {
    const stamp = now();
    for (const c of COLLECTIONS) {
      clear[c].run();
      state[c].forEach((record, i) => writeRecord(c, record, i, stamp));
    }
    writeProfile.run(JSON.stringify(state.profile), stamp);
  }

  return {
    version,
    isEmpty,
    readState,
    /** Replace everything (restoring a backup, or copying this browser's data in the first time). */
    replaceState: db.transaction((input) => {
      const state = validateState(input);
      writeAll(state);
      return bump();
    }),
    /**
     * Apply one save from the app: changed or new records by id, removed ids, and the profile.
     * The result must still pass the app's validation, or nothing is written.
     */
    applyChanges: db.transaction((changes) => {
      const current = readState();
      const next = { ...current };
      for (const c of COLLECTIONS) {
        const removed = new Set(changes?.remove?.[c] || []);
        const upserts = changes?.upsert?.[c] || [];
        if (!Array.isArray(upserts) || ![...removed].every((id) => typeof id === "string")) throw Error("Invalid changes.");
        const byId = new Map(upserts.map((r) => [r?.id, r]));
        next[c] = [...current[c].filter((r) => !removed.has(r.id)).map((r) => byId.get(r.id) || r), ...upserts.filter((r) => !current[c].some((x) => x.id === r?.id))];
      }
      if (changes?.profile) next.profile = changes.profile;
      const valid = validateState(next); // the whole result must be valid; only what changed is written
      const stamp = now();
      for (const c of COLLECTIONS) {
        for (const id of changes?.remove?.[c] || []) remove[c].run(id);
        let end = lastPosition[c].get().position;
        for (const record of changes?.upsert?.[c] || []) {
          const saved = valid[c].find((r) => r.id === record.id);
          const position = positionOf[c].get(record.id)?.position ?? ++end;
          writeRecord(c, saved, position, stamp);
        }
      }
      if (changes?.profile) writeProfile.run(JSON.stringify(valid.profile), stamp);
      return bump();
    }),
    readChat() {
      const row = readChat.get();
      return row ? JSON.parse(row.data) : null;
    },
    writeChat: db.transaction((chat) => {
      const text = JSON.stringify(chat);
      if (!chat || chat.version !== 1 || !Array.isArray(chat.messages) || text.length > MAX_CHAT_BYTES) throw Error("Invalid conversation.");
      writeChat.run(text, now());
      return bump();
    }),
    close: () => db.close(),
  };
}
