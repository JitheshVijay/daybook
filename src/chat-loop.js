// Runs one user turn: post the conversation, execute any tool calls locally, post the
// results back, and stop at a text reply (the server forces text on the 4th call).
import { dateKey, entryTitle, fmtDate, id } from "./domain.js";
import { blankRaw, executeToolCall, fillFoodNutrition, moveRequest, namesEntry, prefillNutrition } from "./chat-tools.js";
import {
  agePending,
  applyEffects,
  buildContext,
  findBatchCard,
  recentUserText,
  toApiMessages,
} from "./chat-history.js";

const MAX_CALLS = 4;
const squash = (text) => String(text || "").toLowerCase().replace(/\s+/g, " ").trim();
// The user sent the same words as an earlier message in this conversation.
function isRepeatedMessage(messages, userId) {
  const latest = messages.find((m) => m.id === userId);
  if (!latest || squash(latest.content).length < 20) return false;
  return messages.some((m) => m.role === "user" && m.id !== userId && squash(m.content) === squash(latest.content));
}
const CALL_TIMEOUT_MS = 100_000;
const nowTime = () => new Date().toTimeString().slice(0, 5);

export class ChatError extends Error {}

function withTimeout(signal, ms) {
  const timeout = AbortSignal.timeout(ms);
  if (!signal) return timeout;
  if (typeof AbortSignal.any === "function") return AbortSignal.any([signal, timeout]);
  return signal;
}

const turnMessages = (chat, turnId) => chat.messages.filter((m) => m.turnId === turnId);

function patchMessage(chat, messageId, patch) {
  return {
    ...chat,
    messages: chat.messages.map((m) => (m.id === messageId ? { ...m, ...patch } : m)),
  };
}

// Remove an assistant tool_calls message whose calls were never all answered.
function dropUnansweredCalls(chat, turnId) {
  const mine = turnMessages(chat, turnId);
  const answered = new Set(mine.filter((m) => m.role === "tool").map((m) => m.tool_call_id));
  const dangling = mine.filter(
    (m) => m.role === "assistant" && m.tool_calls?.some((c) => !answered.has(c.id)),
  );
  if (!dangling.length) return chat;
  const drop = new Set(dangling.map((m) => m.id));
  return { ...chat, messages: chat.messages.filter((m) => !drop.has(m.id)) };
}

/**
 * runTurn({ text, retryMessageId, store, data, logDate, signal, fetchImpl, onNewBooks, onNewSongs })
 * store: { get(), set(updater) } for chat state; data: { get(), commit(updater) } for records.
 * Resolves when the turn finishes; never throws. Failures are recorded on the user message.
 */
export async function runTurn({
  text,
  retryMessageId,
  store,
  data,
  logDate,
  signal,
  fetchImpl = fetch,
  onNewBooks,
  onNewSongs,
  today = dateKey(),
}) {
  let userId = retryMessageId;
  let turnId;
  if (retryMessageId) {
    const message = store.get().messages.find((m) => m.id === retryMessageId);
    if (!message) return;
    turnId = message.turnId;
    store.set((chat) => patchMessage(dropUnansweredCalls(chat, turnId), retryMessageId, { status: undefined, error: undefined }));
  } else {
    userId = id();
    turnId = id();
    store.set((chat) => {
      const aged = agePending(chat, logDate || today);
      return {
        ...aged,
        messages: [
          ...aged.messages,
          { id: userId, role: "user", content: text, turnId, at: Date.now() },
        ],
      };
    });
  }

  // "Move the fried egg from September 12th to September 13th": when exactly one entry on that day
  // matches, the app moves it itself; the model isn't needed for a request this clear.
  if (!retryMessageId) {
    const now = nowTime();
    const asked = moveRequest(text, today, now);
    const state = data.get();
    const matches = asked ? state.entries.filter((e) => e.date === asked.from && e.status === "done" && namesEntry(text, e, state)) : [];
    if (matches.length === 1) {
      const entry = matches[0];
      const call = {
        id: `move-${turnId}`,
        type: "function",
        function: { name: "update_entry", arguments: JSON.stringify({ id: entry.id, replaceList: false, changes: { ...blankRaw(entry.type), status: entry.status, date: asked.to } }) },
      };
      const current = store.get();
      const out = executeToolCall(call, {
        state,
        commit: data.commit,
        today,
        now,
        logDate: logDate || today,
        turnId,
        userText: recentUserText(current.messages),
        latestUserText: text,
        pending: current.pending,
        findBatch: (batchId) => findBatchCard(store.get(), batchId),
      });
      if (!out.result.error) {
        const said = `Moved ${entryTitle(entry, state)} (${out.result.updated?.detail || ""}) from ${fmtDate(asked.from, { weekday: "short", day: "numeric", month: "short" })} to ${fmtDate(asked.to, { weekday: "short", day: "numeric", month: "short" })}.`;
        store.set((c) =>
          applyEffects(
            {
              ...c,
              events: [],
              messages: [
                ...c.messages,
                { id: id(), role: "assistant", content: null, tool_calls: [call], turnId, at: Date.now() },
                { id: id(), role: "tool", tool_call_id: call.id, name: "update_entry", content: JSON.stringify(out.result), ...(out.effects.card ? { card: out.effects.card } : {}), turnId, at: Date.now() },
                { id: id(), role: "assistant", content: said.replace(" ()", ""), turnId, at: Date.now() },
              ],
            },
            out.effects,
          ),
        );
        return;
      }
    }
  }

  let toolErrors = 0;
  let forceTool = null; // ask the model to call this tool next (used once per turn)
  let forceScope = null; // entry types accepted from that forced call
  let forcedOnce = false;
  const turnTargets = []; // workouts and meals saved in this turn, so repeats join them
  const turnSignatures = new Set(); // activities saved during this turn, to drop repeats
  const turnResolved = new Map(); // waiting items completed during this turn → the entries saved
  try {
    for (let call = 1; call <= MAX_CALLS; call++) {
      const chat = store.get();
      const body = {
        turnId,
        iteration: call,
        ...(forceTool && call < MAX_CALLS ? { forceTool } : {}),
        context: buildContext(data.get(), chat, { today, now: nowTime(), logDate: logDate || today }),
        messages: toApiMessages(chat.messages),
      };
      const response = await fetchImpl("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: withTimeout(signal, CALL_TIMEOUT_MS),
      });
      let payload = {};
      try {
        payload = await response.json();
      } catch {
        payload = {};
      }
      if (!response.ok || !payload.message)
        throw new ChatError(payload.error || "The assistant could not respond. Try again.");

      const scope = forceTool ? forceScope : null;
      forceTool = null;
      forceScope = null;
      const reply = payload.message;
      const calls = Array.isArray(reply.tool_calls) ? reply.tool_calls : [];
      // Models sometimes log one activity per call; run them as a single log so a
      // gym session stays one workout and nothing is saved twice.
      const logCalls = calls.filter((c) => c.function?.name === "log_entries");
      let combinedLog = null;
      if (logCalls.length > 1) {
        try {
          const entries = logCalls.flatMap((c) => JSON.parse(c.function.arguments || "{}").entries || []);
          combinedLog = { id: logCalls[0].id, arguments: JSON.stringify({ entries }) };
        } catch {
          combinedLog = null;
        }
      }
      store.set((c) => ({
        ...c,
        messages: [
          ...c.messages,
          {
            id: id(),
            role: "assistant",
            content: reply.content || "",
            ...(calls.length ? { tool_calls: calls } : {}),
            turnId,
            at: Date.now(),
          },
        ],
      }));
      if (!calls.length) {
        store.set((c) => ({ ...c, events: [] }));
        return;
      }

      let stopQuestion = null;
      // A question pauses the turn only when it is the reply's single tool call; asked
      // alongside other tools, the model has not seen their results (e.g. what is pending).
      const questionAllowed = calls.every((c) => c.function?.name === "ask_user");
      let asked = false;
      for (const toolCall of calls) {
        if (signal?.aborted) throw new DOMException("Stopped", "AbortError");
        const current = store.get();
        const isQuestion = toolCall.function?.name === "ask_user";
        const mergedAway = combinedLog && toolCall.function?.name === "log_entries" && toolCall.id !== combinedLog.id;
        let runCall = combinedLog && toolCall.id === combinedLog.id ? { ...toolCall, function: { ...toolCall.function, arguments: combinedLog.arguments } } : toolCall;
        const prefilled = mergedAway ? { call: runCall, estimated: [] } : await prefillNutrition(runCall, { state: data.get(), description: recentUserText(current.messages, 1), fetchImpl, signal });
        runCall = prefilled.call;
        const toolCtx = {
          state: data.get(),
          commit: data.commit,
          today,
          now: nowTime(),
          logDate: logDate || today,
          turnId,
          userText: recentUserText(current.messages),
          latestUserText: recentUserText(current.messages, 1),
          repeatedMessage: isRepeatedMessage(current.messages, userId),
          pending: current.pending,
          findBatch: (batchId) => findBatchCard(store.get(), batchId),
          onNewBooks,
          onNewSongs,
          turnSignatures,
          turnTargets,
          turnResolved,
          recentLoggedIds: current.messages.slice(-40).flatMap((m) => (m.card?.kind === "logged" && !m.card.undone ? (m.card.entries || []).map((e) => e.id) : [])),
          autoNutrition: true,
          ...(scope && runCall.function?.name === "log_entries" ? { allowTypes: scope } : {}),
        };
        let out = mergedAway
          ? { result: { combinedWith: combinedLog.id, note: "These entries were logged together with the first log_entries call in this reply; see that result." }, effects: {} }
          : isQuestion && (!questionAllowed || asked)
            ? {
                result: {
                  asked: false,
                  note: asked
                    ? "Only one question can be shown at a time. Ask this after the user answers."
                    : "Not shown: read the other tool results first, then ask one question.",
                },
                effects: {},
              }
            : executeToolCall(runCall, toolCtx);
        if (!mergedAway && runCall.function?.name === "log_entries" && out.effects.pendingAdd?.some((p) => p.type === "food")) {
          out = await fillFoodNutrition(out, {
            ...toolCtx,
            state: data.get(),
            callId: runCall.id,
            description: recentUserText(current.messages, 1),
            fetchImpl,
            signal,
          });
        }
        if (prefilled.estimated.length && !out.result.error)
          out = { ...out, result: { ...out.result, nutrition: `Calories and macros for ${prefilled.estimated.join(", ")} were estimated by the app from the user's words. Mention that they are estimates; never ask the user for calories or portions.` } };
        for (const pendingId of out.effects.pendingResolve || []) turnResolved.set(pendingId, (out.result.logged || []).map((e) => e.id));
        if (isQuestion && out.effects.stop) asked = true;
        if (out.effects.retry && !forcedOnce) {
          forceTool = out.effects.retry.tool;
          forceScope = out.effects.retry.types || null;
          forcedOnce = true;
        }
        store.set((c) =>
          applyEffects(
            {
              ...c,
              messages: [
                ...c.messages,
                {
                  id: id(),
                  role: "tool",
                  tool_call_id: toolCall.id,
                  name: toolCall.function?.name,
                  content: JSON.stringify(out.result),
                  ...(out.effects.card ? { card: out.effects.card } : {}),
                  turnId,
                  at: Date.now(),
                },
              ],
            },
            out.effects,
          ),
        );
        if (out.effects.error) toolErrors++;
        if (out.effects.stop) stopQuestion = out.effects.card?.question || "";
      }
      if (stopQuestion !== null) {
        store.set((c) => ({
          ...c,
          events: [],
          messages: [
            ...c.messages,
            { id: id(), role: "assistant", content: stopQuestion || "(question)", synthetic: true, turnId, at: Date.now() },
          ],
        }));
        return;
      }
      if (toolErrors >= 2)
        throw new ChatError("The assistant couldn't complete that request. Anything shown as logged was saved.");
    }
    store.set((c) => ({
      ...c,
      events: [],
      messages: [
        ...c.messages,
        { id: id(), role: "assistant", content: "(finished)", synthetic: true, turnId, at: Date.now() },
      ],
    }));
  } catch (error) {
    const stopped = error?.name === "AbortError" && signal?.aborted;
    const timedOut = error?.name === "TimeoutError" || (error?.name === "AbortError" && !signal?.aborted);
    const message = stopped
      ? "Stopped."
      : timedOut
        ? "The assistant took too long. Try again."
        : error instanceof ChatError
          ? error.message
          : "Could not reach Daybook's assistant. Check that the app server is running.";
    store.set((chat) => {
      let next = dropUnansweredCalls(chat, turnId);
      const hasReplies = turnMessages(next, turnId).some((m) => m.role !== "user");
      next = patchMessage(next, userId, {
        status: stopped ? "stopped" : "error",
        error: message,
      });
      if (hasReplies && stopped)
        next = {
          ...next,
          messages: [
            ...next.messages,
            { id: id(), role: "assistant", content: "(stopped)", synthetic: true, turnId, at: Date.now() },
          ],
        };
      return next;
    });
  }
}
