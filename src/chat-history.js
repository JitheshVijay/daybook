// Conversation state: persistence, the per-call context the model sees, and history
// compaction that never separates a tool call from its result.
import { bookProgress, dateKey, parseDate, shiftDate } from "./domain.js";
import { recentDays } from "./insights.js";
import { entryFields, summarizeEntry } from "./chat-tools.js";

export const CHAT_KEY = "daybook.chat.v1";
const MAX_STORED_MESSAGES = 120;
const MAX_STORED_BYTES = 500_000;
const MAX_API_MESSAGES = 24;
const FULL_DETAIL_TURNS = 2;
const PENDING_MAX_TURNS = 8;

export const emptyChat = () => ({ version: 1, messages: [], pending: [], events: [], logDate: null });

export function loadChat(storage) {
  try {
    return chatFromValue(JSON.parse(storage.getItem(CHAT_KEY) || "null"));
  } catch {
    return emptyChat();
  }
}

// A conversation read from storage or the database, with any missing parts filled in.
export function chatFromValue(raw) {
  try {
    if (!raw || raw.version !== 1 || !Array.isArray(raw.messages)) return emptyChat();
    return {
      ...emptyChat(),
      ...raw,
      pending: Array.isArray(raw.pending) ? raw.pending : [],
      events: Array.isArray(raw.events) ? raw.events : [],
    };
  } catch {
    return emptyChat();
  }
}

export function trimChat(chat) {
  let messages = chat.messages;
  const startAtTurn = (list) => {
    const first = list.findIndex((m) => m.role === "user");
    return first > 0 ? list.slice(first) : list;
  };
  if (messages.length > MAX_STORED_MESSAGES)
    messages = startAtTurn(messages.slice(-MAX_STORED_MESSAGES));
  let next = { ...chat, messages };
  while (next.messages.length > 2 && JSON.stringify(next).length > MAX_STORED_BYTES) {
    const secondTurn = next.messages.findIndex((m, i) => i > 0 && m.role === "user");
    if (secondTurn < 0) break;
    next = { ...next, messages: next.messages.slice(secondTurn) };
  }
  return next;
}

export function saveChat(storage, chat) {
  try {
    storage.setItem(CHAT_KEY, JSON.stringify(trimChat(chat)));
    return true;
  } catch {
    return false;
  }
}

// Group messages into turns: each starts with a user message.
export function groupTurns(messages) {
  const turns = [];
  for (const m of messages) {
    if (m.role === "user" || !turns.length) turns.push({ user: m.role === "user" ? m : null, replies: [] });
    if (m.role !== "user") turns.at(-1).replies.push(m);
  }
  return turns;
}

const clip = (text, max) =>
  typeof text === "string" && text.length > max ? `${text.slice(0, max)}…` : text || "";

// Only well-formed tool exchanges survive: an assistant tool_calls message followed by
// a tool result for every call id, in order.
function wellFormed(replies) {
  const out = [];
  for (let i = 0; i < replies.length; i++) {
    const m = replies[i];
    if (m.role === "assistant" && m.tool_calls?.length) {
      const ids = m.tool_calls.map((c) => c.id);
      const results = replies.slice(i + 1, i + 1 + ids.length);
      const complete =
        results.length === ids.length &&
        results.every((r, k) => r.role === "tool" && r.tool_call_id === ids[k]);
      if (!complete) {
        if (m.content) out.push({ role: "assistant", content: clip(m.content, 8000) });
        continue;
      }
      out.push({
        role: "assistant",
        content: m.content ? clip(m.content, 8000) : null,
        tool_calls: m.tool_calls.map((c) => ({
          id: c.id,
          type: "function",
          function: { name: c.function.name, arguments: c.function.arguments },
        })),
      });
      for (const r of results)
        out.push({ role: "tool", tool_call_id: r.tool_call_id, content: clip(r.content, 16000) });
      i += ids.length;
    } else if (m.role === "assistant" && m.content) {
      out.push({ role: "assistant", content: clip(m.content, 8000) });
    }
  }
  return out;
}

export function toApiMessages(messages) {
  const turns = groupTurns(messages).filter(
    (t) => t.user && !(["error", "stopped"].includes(t.user.status) && !t.replies.length),
  );
  const shaped = turns.map((turn, index) => {
    const recent = index >= turns.length - FULL_DETAIL_TURNS;
    const replies = recent
      ? wellFormed(turn.replies)
      : turn.replies
          .filter((m) => m.role === "assistant" && m.content)
          .map((m) => ({ role: "assistant", content: clip(m.content, 8000) }));
    const isLast = index === turns.length - 1;
    // A finished turn must end with assistant text before the next user message.
    if (!isLast && (!replies.length || replies.at(-1).role !== "assistant" || replies.at(-1).tool_calls))
      replies.push({ role: "assistant", content: "(reply interrupted)" });
    return [{ role: "user", content: clip(turn.user.content, 4000) }, ...replies];
  });
  const picked = [];
  let count = 0;
  for (let i = shaped.length - 1; i >= 0; i--) {
    if (picked.length && count + shaped[i].length > MAX_API_MESSAGES) break;
    picked.unshift(shaped[i]);
    count += shaped[i].length;
  }
  return picked.flat();
}

// The latest user words, used to check that quoted sources came from the user.
export function recentUserText(messages, count = 3) {
  return messages
    .filter((m) => m.role === "user")
    .slice(-count)
    .map((m) => m.content)
    .join("\n");
}

export function buildContext(state, chat, { today = dateKey(), now, logDate }) {
  const day = logDate || today;
  const { name, ...goals } = state.profile;
  return {
    today,
    weekday: parseDate(today).toLocaleDateString("en-GB", { weekday: "long" }),
    now,
    logDate: day,
    user: { name: name || null, goals },
    books: state.books.slice(-60).map((book) => {
      const progress = bookProgress(book, state.entries);
      return { id: book.id, title: book.title, author: book.author, status: book.status, pagesRead: progress.pages, totalPages: book.totalPages || null, chaptersRead: progress.chapters, totalChapters: book.totalChapters || null };
    }),
    songs: state.songs.slice(-60).map(({ id, title, artist, status }) => ({ id, title, artist, status })),
    habits: state.habits.slice(-30).map(({ id, name: habit, unit, goal }) => ({ id, name: habit, unit, goal })),
    entriesOnLogDate: state.entries
      .filter((e) => e.date === day)
      .sort((a, b) => a.time.localeCompare(b.time))
      .slice(-40)
      .map((e) => {
        const { estimated, ...row } = summarizeEntry(e, state);
        return { ...row, fields: entryFields(e, state) };
      }),
    // Other days close to today, so an entry can be found by id to move, fix or delete.
    recentEntries: state.entries
      .filter((e) => e.date !== day && e.date >= shiftDate(today, -3) && e.date <= shiftDate(today, 1))
      .sort((a, b) => `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`))
      .slice(-40)
      .map((e) => {
        const { id, type, date, time, status, title, detail } = summarizeEntry(e, state);
        const names = [...(e.items || []).map((i) => i.name), ...(e.exercises || []).map((x) => x.name)];
        return { id, type, date, time, status, title, detail, ...(names.length ? { names } : {}) };
      }),
    recentDays: recentDays(state, today, 7),
    pending: chat.pending.slice(-5).map(({ id, type, date, known, questions, attachTo }) => ({ id, type, date, known, questions, ...(attachTo ? { partOf: attachTo } : {}) })),
    events: chat.events.slice(-3),
  };
}

export function findBatchCard(chat, batchId) {
  for (const m of chat.messages) if (m.card?.kind === "logged" && m.card.batchId === batchId) return m.card;
  return null;
}

export function markBatchUndone(chat, batchId) {
  const card = findBatchCard(chat, batchId);
  return {
    ...chat,
    messages: chat.messages.map((m) =>
      m.card?.kind === "logged" && m.card.batchId === batchId
        ? { ...m, card: { ...m.card, undone: true } }
        : m,
    ),
    pending: chat.pending.filter((p) => !card?.pendingIds?.includes(p.id)),
    events: [
      ...chat.events,
      `The user undid batch ${batchId} (${card?.entries.length || 0} entries removed).`,
    ].slice(-3),
  };
}

export function applyEffects(chat, effects) {
  let next = chat;
  if (effects.pendingAdd?.length || effects.pendingResolve?.length) {
    const replacing = new Set([...(effects.pendingAdd || []).map((p) => p.id), ...(effects.pendingResolve || [])]);
    next = {
      ...next,
      pending: [...next.pending.filter((p) => !replacing.has(p.id)), ...(effects.pendingAdd || [])],
    };
  }
  if (effects.undoBatch) next = markBatchUndone(next, effects.undoBatch);
  return next;
}

// Called before a new (non-retry) turn: age pending items and forget stale ones.
export function agePending(chat, logDate) {
  const dateChanged = chat.logDate && chat.logDate !== logDate;
  return {
    ...chat,
    logDate,
    pending: dateChanged
      ? []
      : chat.pending
          .map((p) => ({ ...p, turnsOpen: (p.turnsOpen || 0) + 1 }))
          .filter((p) => p.turnsOpen <= PENDING_MAX_TURNS),
  };
}

export function dismissPending(chat, id) {
  return { ...chat, pending: chat.pending.filter((p) => p.id !== id) };
}
