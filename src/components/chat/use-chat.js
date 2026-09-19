import * as React from "react"
import { applyImport, PART_KEY } from "@/day-import"
import { dateKey, loggingDay, shiftDate, upsertEntry, validateState } from "@/domain"
import { fillBookCovers } from "@/book-covers"
import { fillSongCovers } from "@/song-covers"
import { describeChanges, fillFoodNutrition, recheckPending, reestimateCandidate, reestimateMeals, undoBatch, summarizeEntry } from "@/chat-tools"
import { needsNutrition } from "@/nutrition"
import { applyEffects, CHAT_KEY, dismissPending, emptyChat, loadChat, markBatchUndone, saveChat } from "@/chat-history"
import { runTurn } from "@/chat-loop"

const REESTIMATE_KEY = "daybook.repair.nutrition.v2"

/**
 * Conversation state backed by localStorage, plus the actions the chat UI needs.
 * data: { get(), commit(updater) } from useDaybook.
 */
export function useChat(data, { today = dateKey(), initialChat = null, persistChat = null, remoteChat = null, mode = "browser" } = {}) {
  const [chat, setChat] = React.useState(() => initialChat || loadChat(localStorage))
  const ref = React.useRef(chat)
  const [busy, setBusy] = React.useState(false)
  // The chat logs to the logging day (until 4 am, the day that just ended) unless a date is picked.
  const [pickedDate, setPickedDate] = React.useState(null)
  const [autoDay, setAutoDay] = React.useState(() => loggingDay())
  React.useEffect(() => {
    const timer = setInterval(() => setAutoDay((current) => (current === loggingDay() ? current : loggingDay())), 60_000)
    return () => clearInterval(timer)
  }, [])
  React.useEffect(() => setPickedDate(null), [today])
  const logDate = pickedDate ?? autoDay
  const setLogDate = React.useCallback((date) => setPickedDate(date === loggingDay() ? null : date), [])
  const controller = React.useRef(null)

  const store = React.useMemo(
    () => ({
      get: () => ref.current,
      set: (update) => {
        ref.current = update(ref.current)
        setChat(ref.current)
        if (persistChat) persistChat(ref.current)
        else saveChat(localStorage, ref.current)
      },
    }),
    [persistChat],
  )

  // Another tab or browser changed the conversation.
  React.useEffect(() => {
    if (!remoteChat || busy || JSON.stringify(remoteChat.chat) === JSON.stringify(ref.current)) return
    ref.current = remoteChat.chat
    setChat(ref.current)
  }, [remoteChat, busy])
  React.useEffect(() => {
    if (mode === "database") return
    const onStorage = (event) => {
      if (event.key !== CHAT_KEY || busy) return
      ref.current = loadChat(localStorage)
      setChat(ref.current)
    }
    window.addEventListener("storage", onStorage)
    return () => window.removeEventListener("storage", onStorage)
  }, [busy, mode])

  React.useEffect(() => () => controller.current?.abort(), [])

  // Items still waiting from before a rules change are re-checked with the current rules,
  // and foods without calories are estimated.
  const rechecking = React.useRef(false)
  React.useEffect(() => {
    if (rechecking.current) return
    rechecking.current = true
    const ctx = { state: data.get(), commit: data.commit, today: dateKey(), now: new Date().toTimeString().slice(0, 5), logDate: loggingDay() }
    let result = null
    try {
      result = recheckPending(ref.current, ctx)
    } catch {
      result = null
    }
    if (!result) {
      const foods = ref.current.pending.filter((p) => p.type === "food" && (p.draft?.entry?.items || []).some(needsNutrition))
      if (foods.length) result = {
        stale: [],
        current: ref.current.pending,
        callId: `nutrition-${foods.map((p) => p.id).join("-").slice(0, 60)}`,
        out: { result: { logged: [], needsDetails: [] }, effects: { pendingAdd: foods, pendingResolve: [] } },
      }
    }
    void (async () => {
      const fresh = result ? await finishRecheck(result, ctx) : []
      await refreshEstimates(fresh)
    })()
  }, [data, store])

  // Once per browser: meals estimated before the estimator improved are estimated again,
  // shown as an update card with Undo when the total changes noticeably.
  // fresh: entries just estimated with the current estimator during this load.
  const refreshEstimates = React.useCallback(async (fresh = []) => {
    let record = { done: [], complete: false }
    try {
      record = { ...record, ...JSON.parse(localStorage.getItem(REESTIMATE_KEY) || "{}") }
    } catch {
      /* start fresh */
    }
    if (record.complete) return
    record.done = [...new Set([...(Array.isArray(record.done) ? record.done : []), ...fresh])]
    const today = dateKey()
    const from = shiftDate(today, -14)
    let results = []
    try {
      results = await reestimateMeals({ state: data.get(), chat: ref.current, today, fetchImpl: fetch, skip: record.done })
    } catch {
      return
    }
    const kcal = (entry) => entry.items.reduce((total, i) => total + (Number(i.calories) || 0) * (Number(i.servings) || 0), 0)
    for (const { before, after } of results) {
      if (controller.current) continue // a message is being answered; try again next visit
      record.done.push(before.id)
      const current = data.get().entries.find((e) => e.id === before.id)
      if (!current || JSON.stringify(current.items) !== JSON.stringify(before.items)) continue
      const oldKcal = kcal(before)
      const newKcal = kcal(after)
      if (oldKcal > 0 && Math.abs(newKcal - oldKcal) / oldKcal < 0.1) continue
      try {
        data.commit((state) => validateState(upsertEntry(state, after)))
      } catch {
        record.done.pop()
        continue
      }
      const saved = data.get()
      const updated = saved.entries.find((e) => e.id === before.id)
      const batchId = `reestimate-${before.id}`.slice(0, 64)
      const summary = summarizeEntry(updated, saved)
      const card = {
        kind: "logged",
        mode: "updated",
        batchId,
        date: before.date,
        entries: [summary],
        previous: [summarizeEntry(before, saved)],
        changes: describeChanges(before, updated),
        replaced: [before],
        newLibrary: { books: [], songs: [], habits: [] },
        pendingIds: [],
        undone: false,
      }
      store.set((c) => {
        const lastTurn = [...c.messages].reverse().find((m) => m.turnId)?.turnId
        return {
          ...c,
          messages: [
            ...c.messages,
            { id: `${batchId}-card`, role: "tool", tool_call_id: batchId, name: "update_entry", content: JSON.stringify({ updated: summary, changes: card.changes }), card, turnId: lastTurn, at: Date.now() },
            {
              id: `${batchId}-note`,
              role: "assistant",
              synthetic: true,
              content: `Calorie estimates are more accurate now, so I estimated ${summary.title} again from what you told me: ${Math.round(oldKcal).toLocaleString("en-GB")} → ${Math.round(newKcal).toLocaleString("en-GB")} kcal. Undo keeps the old numbers.`,
              turnId: lastTurn,
              at: Date.now(),
            },
          ],
        }
      })
    }
    const left = data.get().entries.filter((e) => reestimateCandidate(e, ref.current, from, today) && !record.done.includes(e.id))
    record.complete = left.length === 0
    try {
      localStorage.setItem(REESTIMATE_KEY, JSON.stringify(record))
    } catch {
      /* try again next visit */
    }
  }, [data, store])

  const finishRecheck = React.useCallback(async (result, ctx) => {
    const lastUser = [...ref.current.messages].reverse().find((m) => m.role === "user")
    let out = result.out
    try {
      // The message that left a meal waiting has its amounts ("250 gm chicken").
      const saidFor = (p) => {
        const card = ref.current.messages.find((m) => m.card?.pendingIds?.includes(p.id))
        return (card?.turnId && ref.current.messages.find((m) => m.role === "user" && m.turnId === card.turnId)?.content) || ""
      }
      out = await fillFoodNutrition(out, { ...ctx, state: data.get(), pending: result.current, callId: result.callId, description: lastUser?.content || "", saidFor })
    } catch {
      out = result.out
    }
    const { current, callId } = result
    store.set((c) => {
      // Cards stop showing waiting items that are gone; items still waiting keep their card.
      const gone = (pid) => result.stale.some((p) => p.id === pid) && !(out.effects.pendingAdd || []).some((p) => p.id === pid)
      const keptCards = c.messages.map((m) =>
        m.card?.kind === "logged" && m.card.pendingIds?.some(gone)
          ? { ...m, card: { ...m.card, pendingIds: m.card.pendingIds.filter((pid) => !gone(pid)) } }
          : m,
      )
      const lastTurn = [...c.messages].reverse().find((m) => m.turnId)?.turnId
      const notes = out.effects.card
        ? [
            { id: `${callId}-card`, role: "tool", tool_call_id: callId, name: "log_entries", content: JSON.stringify(out.result), card: out.effects.card, turnId: lastTurn, at: Date.now() },
            {
              id: `${callId}-note`,
              role: "assistant",
              synthetic: true,
              content: [
                result.stale.length ? "I re-checked what was still waiting." : "",
                out.result.nutrition ? "I estimated the calories for the foods that were waiting and saved them." : "",
                out.result.needsDetails?.length ? "Only the details above are still needed." : "Everything is saved now.",
              ]
                .filter(Boolean)
                .join(" "),
              turnId: lastTurn,
              at: Date.now(),
            },
          ]
        : []
      return applyEffects({ ...c, pending: current, messages: [...keptCards, ...notes] }, out.effects)
    })
    return (out.result.logged || []).map((entry) => entry.id)
  }, [data, store])

  const run = React.useCallback(
    async (options) => {
      if (controller.current) return
      controller.current = new AbortController()
      setBusy(true)
      try {
        await runTurn({
          ...options,
          store,
          data,
          logDate: pickedDate ?? loggingDay(),
          today: dateKey(),
          signal: controller.current.signal,
          onNewBooks: (books) => void fillBookCovers(data.commit, books),
          onNewSongs: (songs) => void fillSongCovers(data.commit, songs),
        })
      } finally {
        controller.current = null
        setBusy(false)
      }
    },
    [store, data, pickedDate],
  )

  const send = React.useCallback(
    (text) => {
      const value = text.trim()
      if (!value) return
      return run({ text: value.slice(0, 4000) })
    },
    [run],
  )
  const retry = React.useCallback((messageId) => run({ retryMessageId: messageId }), [run])
  const stop = React.useCallback(() => controller.current?.abort(), [])

  const newChat = React.useCallback(() => {
    controller.current?.abort()
    store.set(() => ({ ...emptyChat(), logDate }))
  }, [store, logDate])

  const undo = React.useCallback(
    (batchId) => {
      const message = ref.current.messages.find((m) => m.card?.kind === "logged" && m.card.batchId === batchId)
      if (!message || message.card.undone) return
      data.commit((state) => undoBatch(state, message.card))
      store.set((c) => markBatchUndone(c, batchId))
    },
    [data, store],
  )

  const dismiss = React.useCallback((pendingId) => store.set((c) => dismissPending(c, pendingId)), [store])

  // Save a pending item completed in the manual form, and move it into its card.
  const completePending = React.useCallback(
    (pendingId, entry) => {
      const pending = ref.current.pending.find((p) => p.id === pendingId)
      if (!pending) return
      const target = pending.attachTo && data.get().entries.find((e) => e.id === pending.attachTo)
      if (target) {
        // The remaining exercises or foods join the workout or meal they belong to.
        const key = PART_KEY[target.type]
        data.commit((state) => {
          const current = state.entries.find((e) => e.id === target.id)
          const byName = new Map(current[key].map((p) => [p.name.trim().toLowerCase(), p]))
          for (const part of entry[key] || []) byName.set(part.name.trim().toLowerCase(), part)
          return validateState(upsertEntry(state, { ...current, [key]: [...byName.values()] }))
        })
      } else {
        const draft = { entry, questions: [], warnings: [], included: true, reviewed: true }
        data.commit((state) => applyImport(state, { drafts: [draft], libraries: pending.draft.libraries }, dateKey()))
      }
      const savedId = target ? target.id : entry.id
      const saved = data.get().entries.find((e) => e.id === savedId)
      const summary = saved ? summarizeEntry(saved, data.get()) : null
      store.set((c) => ({
        ...c,
        pending: c.pending.filter((p) => p.id !== pendingId),
        events: [...c.events, `The user filled in pending item ${pendingId} manually and it was saved.`].slice(-3),
        messages: c.messages.map((m) =>
          m.card?.kind === "logged" && m.card.pendingIds?.includes(pendingId)
            ? {
                ...m,
                card: {
                  ...m.card,
                  pendingIds: m.card.pendingIds.filter((id) => id !== pendingId),
                  entries: summary ? [...m.card.entries.filter((e) => e.id !== summary.id), summary] : m.card.entries,
                },
              }
            : m,
        ),
      }))
    },
    [data, store],
  )

  return { chat, busy, send, retry, stop, newChat, undo, dismiss, completePending, logDate, setLogDate, lateNight: pickedDate === null && autoDay !== dateKey() }
}
