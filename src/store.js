import { useState, useCallback, useEffect, useRef } from "react";
import { emptyState, repairAssistantMuscles, validateState } from "./domain";
import { applyChanges, diffState, hasChanges, recordCount } from "./sync";
import { chatFromValue, loadChat, saveChat, trimChat } from "./chat-history";

// Where records live:
// - "database": the SQLite database of the computer running Daybook (/api/data). Every browser on
//   that computer shares it. Saves go out right after each change; unsaved ones are kept in this
//   browser and retried, so nothing is lost if the server restarts.
// - "browser": this browser's localStorage, used by other devices on the network and whenever the
//   database can't be reached.
export const STORAGE_KEY = "daybook.v1";
const MOVED_KEY = "daybook.movedToDatabase";
const UNSAVED_KEY = "daybook.unsavedChanges";
const MUSCLE_REPAIR_KEY = "daybook.repair.muscles.v1";
const RETRY_MS = 5000;
const CHECK_MS = 10000;

export function readState(storage) {
  const raw = storage.getItem(STORAGE_KEY);
  return raw ? validateState(JSON.parse(raw)) : emptyState();
}
const readSafely = (fn, fallback) => {
  try {
    return fn();
  } catch {
    return fallback;
  }
};

// Once per browser: muscles the assistant picked before the app's own mapping won.
function repairMuscles(state) {
  if (readSafely(() => localStorage.getItem(MUSCLE_REPAIR_KEY), "done")) return state;
  readSafely(() => localStorage.setItem(MUSCLE_REPAIR_KEY, new Date().toISOString()));
  const { state: repaired, changed } = repairAssistantMuscles(state);
  return changed ? readSafely(() => validateState(repaired), state) : state;
}

async function request(url, options = {}) {
  try {
    const res = await fetch(url, { cache: "no-store", ...options, headers: { "Content-Type": "application/json", ...options.headers } });
    const body = await res.json().catch(() => ({}));
    return { ok: res.ok, status: res.status, body };
  } catch {
    return { ok: false, status: 0, body: {} };
  }
}

export function useDaybook() {
  const [ready, setReady] = useState(false);
  const [mode, setMode] = useState("browser");
  const [reason, setReason] = useState("");
  const [databaseFile, setDatabaseFile] = useState("");
  const [data, setData] = useState(() => emptyState());
  const ref = useRef(data);
  const [error, setError] = useState("");
  const blocked = useRef(false);
  const [initialChat, setInitialChat] = useState(null);
  const [remoteChat, setRemoteChat] = useState(null);
  const [notice, setNotice] = useState(null);
  const [sync, setSync] = useState({ unsaved: 0, failing: false });
  const modeRef = useRef("browser");
  const queue = useRef([]); // { changes } | { state, moving? } | { chat }
  const version = useRef(0);
  const flushing = useRef(false);
  const failing = useRef(false);
  const stale = useRef(false);
  const retryTimer = useRef(null);
  const chatTimer = useRef(null);

  const keepUnsaved = useCallback(() => {
    readSafely(() => (queue.current.length ? localStorage.setItem(UNSAVED_KEY, JSON.stringify(queue.current)) : localStorage.removeItem(UNSAVED_KEY)));
    setSync({ unsaved: queue.current.length, failing: failing.current });
  }, []);

  const show = useCallback((state) => {
    ref.current = state;
    setData(state);
  }, []);

  // Reload from the database after another tab, browser or refused save changed it.
  const refresh = useCallback(async () => {
    if (queue.current.length) {
      stale.current = true;
      return;
    }
    const res = await request("/api/data");
    if (!res.ok || queue.current.length) {
      if (queue.current.length) stale.current = true;
      return;
    }
    try {
      show(validateState(res.body.state));
      version.current = res.body.version;
      setRemoteChat({ chat: chatFromValue(res.body.chat), version: res.body.version });
    } catch {
      /* keep what is on screen */
    }
  }, [show]);

  const flush = useCallback(async () => {
    if (flushing.current || modeRef.current !== "database") return;
    flushing.current = true;
    clearTimeout(retryTimer.current);
    try {
      while (queue.current.length) {
        const item = queue.current[0];
        const res = item.state
          ? await request("/api/data", { method: "PUT", body: JSON.stringify({ state: item.state }) })
          : item.chat
            ? await request("/api/data/chat", { method: "PUT", body: JSON.stringify({ chat: item.chat }) })
            : await request("/api/data/changes", { method: "POST", body: JSON.stringify({ changes: item.changes }) });
        if (res.status === 0 || res.status >= 500) {
          failing.current = true; // server unreachable: keep everything and try again soon
          keepUnsaved();
          retryTimer.current = setTimeout(() => void flush(), RETRY_MS);
          return;
        }
        // Remove the item that was sent, not whatever is first now: while it was on its way, a
        // newer conversation save may have replaced it and put a record change in front.
        queue.current = queue.current.filter((queued) => queued !== item);
        if (!res.ok) {
          setError(res.body.error || "A change couldn't be saved to the database, so Daybook reloaded what is saved.");
          stale.current = true;
        } else {
          if (res.body.version !== version.current + 1) stale.current = true; // someone else saved in between
          version.current = res.body.version;
          if (item.moving) readSafely(() => localStorage.setItem(MOVED_KEY, new Date().toISOString()));
        }
        failing.current = false;
        keepUnsaved();
      }
      if (stale.current) {
        stale.current = false;
        await refresh();
      }
    } finally {
      flushing.current = false;
    }
  }, [keepUnsaved, refresh]);

  // Start: the database when this computer has one, otherwise this browser's storage.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await request("/api/data");
      if (cancelled) return;
      if (res.ok && res.body.mode === "database") {
        modeRef.current = "database";
        let state = emptyState();
        try {
          state = validateState(res.body.state);
        } catch {
          blocked.current = true;
          setError("The database has records Daybook couldn't read. Restore a backup to continue; nothing has been overwritten.");
        }
        let chat = chatFromValue(res.body.chat);
        version.current = res.body.version;
        // Changes that didn't reach the database last time.
        const unsaved = readSafely(() => JSON.parse(localStorage.getItem(UNSAVED_KEY) || "[]"), []);
        for (const item of Array.isArray(unsaved) ? unsaved : []) {
          try {
            if (item.state) state = validateState(item.state);
            else if (item.chat) chat = chatFromValue(item.chat);
            else if (item.changes) state = validateState(applyChanges(state, item.changes));
            queue.current.push(item);
          } catch {
            /* a change that no longer fits is dropped */
          }
        }
        // First time on this computer's database: bring this browser's data in.
        let moved = null;
        if (res.body.empty && !queue.current.length && !readSafely(() => localStorage.getItem(MOVED_KEY), null)) {
          const local = readSafely(() => readState(localStorage), null);
          const localChat = readSafely(() => loadChat(localStorage), null);
          if (local && recordCount(local) > 0) {
            state = local;
            queue.current.push({ state: local, moving: true });
            moved = { entries: local.entries.length, books: local.books.length, songs: local.songs.length, habits: local.habits.length };
          }
          if (localChat?.messages.length) {
            chat = localChat;
            queue.current.push({ chat: trimChat(localChat) });
          }
        }
        const repaired = repairMuscles(state);
        if (repaired !== state) {
          queue.current.push({ changes: diffState(state, repaired) });
          state = repaired;
        }
        show(state);
        setInitialChat(chat);
        setDatabaseFile(res.body.file || "");
        setMode("database");
        setNotice(moved ? { kind: "moved", ...moved } : null);
        setReady(true);
        keepUnsaved();
        void flush();
      } else {
        modeRef.current = "browser";
        setReason(res.status === 403 ? "other-device" : "unavailable");
        try {
          const loaded = readState(localStorage);
          const repaired = repairMuscles(loaded);
          show(repaired);
          if (repaired !== loaded) readSafely(() => localStorage.setItem(STORAGE_KEY, JSON.stringify(repaired)));
        } catch {
          blocked.current = true;
          setError("Your saved data could not be opened. Download a recovery copy below, or restore a valid backup. Existing data has not been overwritten.");
        }
        setInitialChat(readSafely(() => loadChat(localStorage), null));
        setMode("browser");
        setReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [flush, keepUnsaved, show]);

  const commit = useCallback(
    (update, restore = false) => {
      if (blocked.current && !restore) throw Error("Restore a valid backup before saving new entries.");
      const prev = ref.current;
      const next = validateState(typeof update === "function" ? update(prev) : update);
      if (modeRef.current === "database") {
        if (restore) queue.current = [...queue.current.filter((item) => item.chat), { state: next }];
        else {
          const changes = diffState(prev, next);
          if (hasChanges(changes)) queue.current.push({ changes });
        }
        keepUnsaved();
        void flush();
      } else {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      }
      show(next);
      setError("");
      blocked.current = false;
    },
    [flush, keepUnsaved, show],
  );

  // The conversation is one document; only its latest version needs saving.
  const persistChat = useCallback(
    (chat) => {
      if (modeRef.current !== "database") return saveChat(localStorage, chat);
      queue.current = [...queue.current.filter((item) => !item.chat), { chat: trimChat(chat) }];
      keepUnsaved();
      clearTimeout(chatTimer.current);
      chatTimer.current = setTimeout(() => void flush(), 300);
      return true;
    },
    [flush, keepUnsaved],
  );

  // Other tabs and browsers: localStorage events in browser mode, a version check in database mode.
  useEffect(() => {
    if (!ready) return;
    if (mode === "browser") {
      const onStorage = (e) => {
        if (e.key !== STORAGE_KEY) return;
        try {
          show(readState(localStorage));
          setError("");
          blocked.current = false;
        } catch {
          blocked.current = true;
          setError("Saved data changed but could not be loaded. Restore a backup to continue.");
        }
      };
      window.addEventListener("storage", onStorage);
      return () => window.removeEventListener("storage", onStorage);
    }
    const check = async () => {
      if (flushing.current || queue.current.length) return;
      const res = await request("/api/data/version");
      if (res.ok && res.body.version > version.current) await refresh();
    };
    const timer = setInterval(check, CHECK_MS);
    const onFocus = () => void check();
    window.addEventListener("focus", onFocus);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", onFocus);
    };
  }, [ready, mode, refresh, show]);

  const get = useCallback(() => ref.current, []);
  return {
    ready,
    mode,
    reason,
    databaseFile,
    data,
    commit,
    error,
    get,
    sync,
    notice,
    clearNotice: () => setNotice(null),
    initialChat,
    remoteChat,
    persistChat,
    browserCopy: () => readSafely(() => readState(localStorage), null),
  };
}

export function downloadFile(name, data, type = "application/json") {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
