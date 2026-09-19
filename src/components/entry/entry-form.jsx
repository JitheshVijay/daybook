import { useContext, useEffect, useId, useState } from "react"
import {
  CheckIcon,
  CircleAlertIcon,
  LoaderCircleIcon,
  PauseIcon,
  PlayIcon,
  PlusIcon,
  RotateCcwIcon,
  SparklesIcon,
  TimerIcon,
  Trash2Icon,
  XIcon,
} from "lucide-react"

import { EXERCISES, GUITAR_RATINGS, LABELS, MUSCLES, TYPES, dateKey, id, num, upsertEntry, validateEntry } from "@/domain"
import { fillSongCovers } from "@/song-covers"
import { TypeIcon } from "@/lib/entry-meta"
import { applyEstimate, estimateNutrition } from "@/nutrition"
import { AppContext } from "@/components/app/app-context"
import { cn } from "@/lib/utils"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select"
import { Textarea } from "@/components/ui/textarea"

const newSet = () => ({ reps: 10, weight: 0, done: true })
const newExercise = () => ({ name: "", muscle: "chest", sets: [newSet(), newSet(), newSet()] })
const newFood = () => ({ name: "", servings: 1, calories: 0, protein: 0, carbs: 0, fat: 0 })

export function makeEntry(type, date = dateKey()) {
  return {
    id: id(),
    type,
    date,
    time: new Date().toTimeString().slice(0, 5),
    status: "done",
    title: "",
    notes: "",
    minutes: 0,
    pages: 0,
    chapters: 0,
    steps: 0,
    distance: 0,
    bpm: 0,
    value: 1,
    unit: "",
    bookId: "",
    songId: "",
    habitId: "",
    section: "",
    quality: type === "guitar" ? "" : 3,
    mood: "Neutral",
    lucid: false,
    exercises: [newExercise()],
    items: [newFood()],
  }
}

// A copy of the entry with any missing fields filled from a blank entry of the same type.
function initialDraft(entry, initialType, date) {
  if (!entry) return makeEntry(initialType, date)
  const draft = structuredClone(entry)
  const base = makeEntry(draft.type || initialType, draft.date || date)
  for (const [key, value] of Object.entries(base)) if (draft[key] === undefined) draft[key] = value
  return draft
}

const QUALITY_LABELS = {
  dream: ["Faint fragments", "Hazy", "Some clear details", "Very clear", "Exceptionally vivid"],
  meditation: ["Very distracted", "Often distracted", "Mixed focus", "Mostly focused", "Deeply focused"],
}
const MOODS = ["Neutral", "Calm", "Happy", "Curious", "Energized", "Sad", "Anxious", "Restless"]
const NUTRITION = [
  ["servings", "Servings"],
  ["calories", "Calories (kcal)"],
  ["protein", "Protein (g)"],
  ["carbs", "Carbs (g)"],
  ["fat", "Fat (g)"],
]
const SET_GRID = "grid grid-cols-[1.5rem_minmax(0,1fr)_minmax(0,1fr)_2rem_1.75rem] items-center gap-2"

function TextField({ label, className, description, ...props }) {
  const fieldId = useId()
  return (
    <Field className={className}>
      <FieldLabel htmlFor={fieldId}>{label}</FieldLabel>
      <Input id={fieldId} {...props} />
      {description && <FieldDescription>{description}</FieldDescription>}
    </Field>
  )
}

function NumberField({ label, value, onChange, min = 0, max = 1000000, step = 1, className, ...props }) {
  const fieldId = useId()
  return (
    <Field className={className}>
      <FieldLabel htmlFor={fieldId}>{label}</FieldLabel>
      <Input
        id={fieldId}
        type="number"
        inputMode={step === 1 ? "numeric" : "decimal"}
        min={min}
        max={max}
        step={step}
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value === "" ? "" : Number(e.target.value))}
        className="tabular-nums"
        {...props}
      />
    </Field>
  )
}

function SelectField({ label, description, className, children, ...props }) {
  const fieldId = useId()
  return (
    <Field className={className}>
      <FieldLabel htmlFor={fieldId}>{label}</FieldLabel>
      <NativeSelect id={fieldId} className="w-full" {...props} aria-describedby={description ? `${fieldId}-description` : undefined}>
        {children}
      </NativeSelect>
      {description && <FieldDescription id={`${fieldId}-description`}>{description}</FieldDescription>}
    </Field>
  )
}

function CheckboxField({ label, checked, onCheckedChange }) {
  const fieldId = useId()
  return (
    <Field orientation="horizontal">
      <Checkbox id={fieldId} checked={checked} onCheckedChange={(value) => onCheckedChange(value === true)} />
      <FieldLabel htmlFor={fieldId} className="font-normal">
        {label}
      </FieldLabel>
    </Field>
  )
}

function Hint({ children }) {
  return <FieldDescription>{children}</FieldDescription>
}

export function RestTimer() {
  const [seconds, setSeconds] = useState(90)
  const [running, setRunning] = useState(false)
  useEffect(() => {
    if (!running) return
    const end = Date.now() + seconds * 1000
    const interval = setInterval(() => {
      const left = Math.max(0, Math.ceil((end - Date.now()) / 1000))
      setSeconds(left)
      if (left === 0) setRunning(false)
    }, 250)
    return () => clearInterval(interval)
    // The countdown restarts from the current value only when it is started or paused.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running])
  return (
    <div className="flex items-center gap-2 rounded-lg border bg-muted/50 py-1.5 pr-1.5 pl-3">
      <TimerIcon className="size-4 text-muted-foreground" aria-hidden="true" />
      <span className="text-sm">Rest timer</span>
      <span aria-live="off" className="ml-auto font-mono text-sm font-medium tabular-nums">
        {Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, "0")}
      </span>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label={running ? "Pause rest timer" : "Start rest timer"}
        onClick={() => {
          if (!seconds) setSeconds(90)
          setRunning(!running)
        }}
      >
        {running ? <PauseIcon /> : <PlayIcon />}
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label="Reset rest timer"
        onClick={() => {
          setRunning(false)
          setSeconds(90)
        }}
      >
        <RotateCcwIcon />
      </Button>
    </div>
  )
}

// Create a book, song, or habit without leaving the log form.
const QUICK_ADD = {
  book: {
    label: "New book",
    collection: "books",
    fields: [
      ["title", "Book title", "e.g. Deep Work"],
      ["author", "Author (optional)", "e.g. Cal Newport"],
    ],
    make: (v) => ({
      id: id(),
      title: v.title,
      author: v.author,
      totalPages: 0,
      totalChapters: 0,
      startPages: 0,
      startChapters: 0,
      cover: "",
      status: "Reading",
    }),
    empty: "No books yet. Add one here and log this session right away.",
    hint: "Page count, cover, and status can be added later.",
  },
  song: {
    label: "New song",
    collection: "songs",
    fields: [
      ["title", "Song title", "e.g. Blackbird"],
      ["artist", "Artist (optional)", "e.g. The Beatles"],
    ],
    make: (v) => ({ id: id(), title: v.title, artist: v.artist, targetBpm: 0, status: "Learning", cover: "", added: dateKey() }),
    empty: "No songs yet. Add one here to track it in your setlist.",
    hint: "Target tempo and learning status can be set later.",
  },
  habit: {
    label: "New habit",
    collection: "habits",
    fields: [
      ["name", "Habit name", "e.g. Drink water"],
      ["unit", "Unit", "e.g. glasses"],
    ],
    make: (v) => ({ id: id(), name: v.name, unit: v.unit || "times", goal: 0 }),
    empty: "No habits yet. Name one here and log it right away.",
    hint: "A daily goal can be set later in Settings.",
  },
}

export function QuickAdd({ kind, commit, records, onCreated }) {
  const spec = QUICK_ADD[kind]
  const baseId = useId()
  const [open, setOpen] = useState(!records.length)
  const [values, setValues] = useState({})
  const [error, setError] = useState("")

  function add() {
    const v = Object.fromEntries(spec.fields.map(([key]) => [key, (values[key] || "").trim()]))
    const [primaryKey, primaryLabel] = spec.fields[0]
    if (!v[primaryKey]) {
      setError(`Enter a ${primaryLabel.toLowerCase()}.`)
      return
    }
    try {
      const record = spec.make(v)
      commit((s) => ({ ...s, [spec.collection]: [...s[spec.collection], record] }))
      if (kind === "song") void fillSongCovers(commit, [record])
      onCreated(record)
      setValues({})
      setError("")
      setOpen(false)
    } catch (err) {
      setError(err.message)
    }
  }

  if (!open)
    return (
      <div>
        <Button type="button" variant="ghost" size="sm" className="-ml-2" onClick={() => setOpen(true)}>
          <PlusIcon data-icon="inline-start" />
          {spec.label}
        </Button>
      </div>
    )

  return (
    <div role="group" aria-label={spec.label} className="flex flex-col gap-3 rounded-lg border bg-muted/30 p-3">
      {!records.length && <p className="text-sm text-muted-foreground">{spec.empty}</p>}
      <div className="grid gap-3 sm:grid-cols-2">
        {spec.fields.map(([key, label, placeholder]) => (
          <Field key={key}>
            <FieldLabel htmlFor={`${baseId}-${key}`}>{label}</FieldLabel>
            <Input
              id={`${baseId}-${key}`}
              placeholder={placeholder}
              maxLength={300}
              value={values[key] || ""}
              onChange={(e) => setValues((x) => ({ ...x, [key]: e.target.value }))}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault()
                  add()
                }
              }}
            />
          </Field>
        ))}
      </div>
      <FieldError>{error}</FieldError>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="secondary" size="sm" onClick={add}>
          <PlusIcon data-icon="inline-start" />
          Add {kind}
        </Button>
        {records.length > 0 && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              setOpen(false)
              setError("")
            }}
          >
            Cancel
          </Button>
        )}
      </div>
      <p className="text-xs text-muted-foreground">{spec.hint}</p>
    </div>
  )
}

function focusDialog(event) {
  // Match the old modal: focus the dialog itself so phones don't pop a keyboard or picker.
  event.preventDefault()
  event.currentTarget?.focus?.()
}

export function EntryDialog({
  open,
  onOpenChange,
  state,
  commit,
  entry,
  initialType = "workout",
  date,
  onSaved,
  onDraftSave,
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        aria-describedby={undefined}
        onOpenAutoFocus={focusDialog}
        className="flex max-h-[calc(100svh-2rem)] flex-col sm:max-w-2xl"
      >
        <EntryFormBody
          key={entry?.id ?? `${initialType}-${date ?? ""}`}
          state={state}
          commit={commit}
          entry={entry}
          initialType={initialType}
          date={date}
          onSaved={onSaved}
          onDraftSave={onDraftSave}
          onClose={() => onOpenChange?.(false)}
        />
      </DialogContent>
    </Dialog>
  )
}

function EntryFormBody({ state, commit, entry, initialType, date, onSaved, onDraftSave, onClose }) {
  const formId = useId()
  const [draft, setDraft] = useState(() => initialDraft(entry, initialType, date))
  const [error, setError] = useState("")
  const [saveTemplate, setSaveTemplate] = useState(false)
  const [saveFavorite, setSaveFavorite] = useState(false)
  // Decided once when the dialog opens, so the title doesn't flip while it closes after a save.
  const [editing] = useState(() => !!entry && state.entries.some((e) => e.id === entry.id))
  const drafting = !!onDraftSave
  const canEstimate = Boolean(useContext(AppContext)?.aiStatus?.configured)
  const [estimating, setEstimating] = useState(false)
  const update = (key, value) => setDraft((d) => ({ ...d, [key]: value }))

  function changeType(type) {
    setDraft((d) => makeEntry(type, d.date))
    setSaveTemplate(false)
    setSaveFavorite(false)
    setError("")
  }
  function patchExercise(index, patch) {
    setDraft((d) => ({
      ...d,
      exercises: d.exercises.map((x, i) => (i === index ? { ...x, ...patch(x) } : x)),
    }))
  }
  function patchSet(index, j, key, value) {
    patchExercise(index, (x) => ({ sets: x.sets.map((s, i) => (i === j ? { ...s, [key]: value } : s)) }))
  }
  function patchItem(index, key, value) {
    // Typing your own calories or macros replaces the estimate.
    const own = ["calories", "protein", "carbs", "fat"].includes(key) ? { estimated: false, estimateNote: "" } : {}
    setDraft((d) => ({ ...d, items: d.items.map((x, j) => (j === index ? { ...x, [key]: value, ...own } : x)) }))
  }
  // Fill calories and macros for foods without them (or all foods when every one has numbers).
  async function estimateFoods() {
    const named = draft.items.map((item, index) => ({ item, index })).filter(({ item }) => String(item.name ?? "").trim())
    if (!named.length) return setError("Add a food name first, then estimate.")
    const blank = named.filter(({ item }) => !(num(item.calories) > 0) || item.estimated)
    const targets = blank.length ? blank : named
    setError("")
    setEstimating(true)
    try {
      const foods = await estimateNutrition({
        foods: targets.map(({ item }) => ({ name: String(item.name).trim(), servings: num(item.servings) > 0 ? num(item.servings) : null })),
        meal: String(draft.title ?? "").trim(),
        description: targets.map(({ item }) => String(item.name).trim()).join(", "),
      })
      setDraft((d) => ({
        ...d,
        items: d.items.map((x, j) => {
          const at = targets.findIndex((t) => t.index === j)
          if (at < 0 || !foods[at]) return x
          return applyEstimate(x, foods[at])
        }),
      }))
    } catch (err) {
      setError(err.message || "Nutrition could not be estimated. Try again.")
    } finally {
      setEstimating(false)
    }
  }
  function loadTemplate(t) {
    if (t)
      setDraft((d) => ({
        ...d,
        title: t.title,
        minutes: t.minutes,
        exercises: structuredClone(t.exercises).map((e) => ({
          ...e,
          sets: e.sets.map((s) => ({ ...s, done: d.status === "done" })),
        })),
      }))
  }

  function submit(e) {
    e.preventDefault()
    setError("")
    try {
      const clean = { ...draft }
      for (const key of ["minutes", "pages", "chapters", "steps", "distance", "bpm", "value"]) clean[key] = num(clean[key])
      clean.title = String(clean.title ?? "").trim()
      clean.exercises = (clean.exercises || []).map((x) => ({
        ...x,
        name: String(x.name ?? "").trim(),
        sets: x.sets.map((s) => ({ ...s, weight: num(s.weight), reps: num(s.reps) })),
      }))
      clean.items = (clean.items || []).map((i) => ({
        ...i,
        name: String(i.name ?? "").trim(),
        servings: num(i.servings),
        calories: num(i.calories),
        protein: num(i.protein),
        carbs: num(i.carbs),
        fat: num(i.fat),
      }))
      if (clean.status === "done" && clean.date > dateKey()) throw Error("Future activities should be saved as planned.")
      if (clean.type === "reading" && !state.books.some((b) => b.id === clean.bookId)) throw Error("Add or choose a book first.")
      if (clean.type === "habit" && !state.habits.some((h) => h.id === clean.habitId)) throw Error("Choose or add a habit first.")
      if (clean.type === "reading" && !clean.pages && !clean.chapters && !clean.minutes)
        throw Error("Enter pages, chapters, or minutes for this session.")
      if (["guitar", "cardio", "sleep"].includes(clean.type) && !clean.minutes) throw Error("Enter the session duration.")
      if (clean.type === "guitar") clean.quality = [1, 2, 3, 4].includes(Number(clean.quality)) && clean.quality !== "" ? Number(clean.quality) : ""
      validateEntry(clean)
      if (drafting) {
        onDraftSave(clean)
        onClose()
        return
      }
      commit((s) => {
        let next = upsertEntry(s, clean)
        if (saveTemplate && clean.type === "workout") {
          if (!clean.title) throw Error("Name the workout to save it as a routine.")
          next = {
            ...next,
            templates: [...next.templates, { id: id(), title: clean.title, minutes: clean.minutes, exercises: clean.exercises }],
          }
        }
        if (saveFavorite && clean.type === "food") {
          if (!clean.title) throw Error("Name the meal to save it as a favorite.")
          next = { ...next, favorites: [...next.favorites, { id: id(), title: clean.title, items: clean.items }] }
        }
        return next
      })
      onSaved?.(editing ? "Entry updated" : draft.status === "planned" ? "Activity planned" : "Activity logged")
      onClose()
    } catch (err) {
      setError(err.message)
    }
  }

  const title = drafting ? "Review activity details" : editing ? "Edit activity" : "Log activity"
  const saveLabel = drafting
    ? "Update draft"
    : editing
      ? "Save changes"
      : draft.status === "planned"
        ? "Save plan"
        : `Save ${LABELS[draft.type].toLowerCase()}`
  const isDream = draft.type === "dream"

  return (
    <>
      <DialogHeader className="pr-8">
        <DialogTitle>{title}</DialogTitle>
      </DialogHeader>
      <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col gap-4">
        <div className="-mx-4 min-h-0 flex-1 overflow-y-auto px-4 py-1">
          <FieldGroup className="gap-4">
            {!editing && !drafting && (
              <div role="group" aria-label="Activity type" className="flex flex-wrap gap-1.5">
                {TYPES.map((t) => (
                  <Button
                    key={t}
                    type="button"
                    variant="outline"
                    size="sm"
                    aria-pressed={draft.type === t}
                    className="aria-pressed:border-primary aria-pressed:bg-muted dark:aria-pressed:bg-muted"
                    onClick={() => changeType(t)}
                  >
                    <TypeIcon type={t} data-icon="inline-start" />
                    {LABELS[t]}
                  </Button>
                ))}
              </div>
            )}

            <div className="grid gap-3 sm:grid-cols-3">
              <TextField label="Date" type="date" required value={draft.date} onChange={(e) => update("date", e.target.value)} />
              <TextField label="Time" type="time" required value={draft.time} onChange={(e) => update("time", e.target.value)} />
              <SelectField label="Activity status" value={draft.status} onChange={(e) => update("status", e.target.value)}>
                <NativeSelectOption value="done">Completed</NativeSelectOption>
                <NativeSelectOption value="planned">Planned</NativeSelectOption>
              </SelectField>
            </div>

            {draft.type === "workout" && (
              <>
                {state.templates.length > 0 && (
                  <SelectField
                    label="Use a saved routine"
                    defaultValue=""
                    onChange={(e) => loadTemplate(state.templates.find((t) => t.id === e.target.value))}
                  >
                    <NativeSelectOption value="">Choose a routine</NativeSelectOption>
                    {state.templates.map((t) => (
                      <NativeSelectOption key={t.id} value={t.id}>
                        {t.title}
                      </NativeSelectOption>
                    ))}
                  </SelectField>
                )}
                <div className="grid gap-3 sm:grid-cols-2">
                  <TextField
                    label="Workout name"
                    placeholder="e.g. Upper body"
                    maxLength={200}
                    value={draft.title}
                    onChange={(e) => update("title", e.target.value)}
                  />
                  <NumberField
                    label="Duration (minutes)"
                    placeholder="Optional"
                    min={0}
                    max={1440}
                    value={draft.minutes || ""}
                    onChange={(v) => update("minutes", v)}
                  />
                </div>
                <datalist id={`${formId}-exercises`}>
                  {EXERCISES.map((x) => (
                    <option key={x.name} value={x.name} />
                  ))}
                </datalist>
                {draft.exercises.map((exercise, index) => (
                  <div
                    key={index}
                    role="group"
                    aria-labelledby={`${formId}-exercise-${index}`}
                    className="flex flex-col gap-3 rounded-lg border p-3"
                  >
                    <div className="flex min-h-7 items-center justify-between gap-2">
                      <h3 id={`${formId}-exercise-${index}`} className="text-sm font-medium">
                        Exercise {index + 1}
                      </h3>
                      {draft.exercises.length > 1 && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          aria-label={`Remove exercise ${index + 1}`}
                          onClick={() => update("exercises", draft.exercises.filter((_, i) => i !== index))}
                        >
                          <Trash2Icon />
                        </Button>
                      )}
                    </div>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <TextField
                        label="Exercise name"
                        list={`${formId}-exercises`}
                        required
                        maxLength={200}
                        placeholder="Search or enter an exercise"
                        value={exercise.name}
                        onChange={(e) => {
                          const name = e.target.value
                          const match = EXERCISES.find((x) => x.name === name)
                          patchExercise(index, (x) => ({ name, muscle: match?.muscle || x.muscle }))
                        }}
                      />
                      <SelectField
                        label="Primary muscle"
                        value={exercise.muscle}
                        onChange={(e) => patchExercise(index, () => ({ muscle: e.target.value }))}
                      >
                        {MUSCLES.map((m) => (
                          <NativeSelectOption key={m} value={m}>
                            {m.replaceAll("-", " ")}
                          </NativeSelectOption>
                        ))}
                      </SelectField>
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <div aria-hidden="true" className={cn(SET_GRID, "text-xs text-muted-foreground")}>
                        <span>Set</span>
                        <span className="truncate">Weight (kg)</span>
                        <span>Reps</span>
                        <span className="text-center">Done</span>
                        <span />
                      </div>
                      {exercise.sets.map((s, j) => (
                        <div key={j} className={SET_GRID}>
                          <span className="text-sm text-muted-foreground tabular-nums">{j + 1}</span>
                          <Input
                            aria-label={`Exercise ${index + 1} set ${j + 1} weight`}
                            required={drafting}
                            type="number"
                            min="0"
                            max="2000"
                            step="0.25"
                            inputMode="decimal"
                            className="tabular-nums"
                            value={s.weight ?? ""}
                            onChange={(e) => patchSet(index, j, "weight", e.target.value)}
                          />
                          <Input
                            aria-label={`Exercise ${index + 1} set ${j + 1} reps`}
                            type="number"
                            min="1"
                            max="10000"
                            required
                            inputMode="numeric"
                            className="tabular-nums"
                            value={s.reps ?? ""}
                            onChange={(e) => patchSet(index, j, "reps", e.target.value)}
                          />
                          <div className="flex justify-center">
                            <Checkbox
                              aria-label={`Exercise ${index + 1} set ${j + 1} completed`}
                              checked={!!s.done}
                              onCheckedChange={(value) => patchSet(index, j, "done", value === true)}
                            />
                          </div>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-sm"
                            aria-label={`Remove exercise ${index + 1} set ${j + 1}`}
                            disabled={exercise.sets.length === 1}
                            onClick={() => patchExercise(index, (x) => ({ sets: x.sets.filter((_, i) => i !== j) }))}
                          >
                            <XIcon />
                          </Button>
                        </div>
                      ))}
                    </div>
                    <div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="-ml-2"
                        onClick={() => patchExercise(index, (x) => ({ sets: [...x.sets, { ...(x.sets.at(-1) || newSet()) }] }))}
                      >
                        <PlusIcon data-icon="inline-start" />
                        Add set
                      </Button>
                    </div>
                  </div>
                ))}
                <Button type="button" variant="outline" className="w-full" onClick={() => update("exercises", [...draft.exercises, newExercise()])}>
                  <PlusIcon data-icon="inline-start" />
                  Add exercise
                </Button>
                <RestTimer />
                {!drafting && <CheckboxField label="Save as a reusable routine" checked={saveTemplate} onCheckedChange={setSaveTemplate} />}
              </>
            )}

            {draft.type === "reading" && (
              <>
                <SelectField label="Book" required value={draft.bookId} onChange={(e) => update("bookId", e.target.value)}>
                  <NativeSelectOption value="">Choose a book</NativeSelectOption>
                  {state.books.map((b) => (
                    <NativeSelectOption key={b.id} value={b.id}>
                      {b.title}
                    </NativeSelectOption>
                  ))}
                </SelectField>
                {commit ? (
                  <QuickAdd kind="book" commit={commit} records={state.books} onCreated={(b) => update("bookId", b.id)} />
                ) : (
                  !state.books.length && <Hint>No books yet. Add a book first, then log this session.</Hint>
                )}
                <div className="grid gap-3 sm:grid-cols-3">
                  <NumberField label="Pages read" value={draft.pages} onChange={(v) => update("pages", v)} />
                  <NumberField label="Chapters read" value={draft.chapters} onChange={(v) => update("chapters", v)} />
                  <NumberField label="Minutes read" max={1440} value={draft.minutes} onChange={(v) => update("minutes", v)} />
                </div>
                <Hint>Enter how much you read in this session, not the page you stopped on.</Hint>
              </>
            )}

            {draft.type === "food" && (
              <>
                {!!state.favorites.length && (
                  <SelectField
                    label="Use a saved meal"
                    defaultValue=""
                    onChange={(e) => {
                      const f = state.favorites.find((x) => x.id === e.target.value)
                      if (f) setDraft((d) => ({ ...d, title: f.title, items: structuredClone(f.items) }))
                    }}
                  >
                    <NativeSelectOption value="">Choose a favorite</NativeSelectOption>
                    {state.favorites.map((f) => (
                      <NativeSelectOption key={f.id} value={f.id}>
                        {f.title}
                      </NativeSelectOption>
                    ))}
                  </SelectField>
                )}
                <TextField
                  label="Meal name"
                  required
                  maxLength={200}
                  placeholder="e.g. Breakfast"
                  value={draft.title}
                  onChange={(e) => update("title", e.target.value)}
                  description={
                    canEstimate
                      ? "Nutrition values are per serving. Don't know them? Name the foods and use Estimate calories."
                      : "Nutrition values are per serving. Use the label or your own estimate."
                  }
                />
                {draft.items.map((item, i) => (
                  <div
                    key={i}
                    role="group"
                    aria-labelledby={`${formId}-food-${i}`}
                    className="flex flex-col gap-3 rounded-lg border p-3"
                  >
                    <div className="flex min-h-7 items-center gap-2">
                      <h3 id={`${formId}-food-${i}`} className="text-sm font-medium">
                        Food {i + 1}
                      </h3>
                      {item.estimated && <Badge variant="secondary">Estimated</Badge>}
                      {draft.items.length > 1 && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          className="ml-auto"
                          aria-label={`Remove food ${i + 1}`}
                          onClick={() => update("items", draft.items.filter((_, j) => i !== j))}
                        >
                          <Trash2Icon />
                        </Button>
                      )}
                    </div>
                    {item.estimated && item.estimateNote && <Hint>{item.estimateNote}</Hint>}
                    <TextField
                      label="Food name"
                      required
                      maxLength={200}
                      placeholder="e.g. Oats with milk"
                      value={item.name}
                      onChange={(e) => patchItem(i, "name", e.target.value)}
                    />
                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                      {NUTRITION.map(([key, label]) => (
                        <NumberField
                          key={key}
                          label={label}
                          step={0.1}
                          min={key === "servings" ? 0.1 : 0}
                          required
                          value={item[key]}
                          onChange={(v) => patchItem(i, key, v)}
                        />
                      ))}
                    </div>
                  </div>
                ))}
                <div className={cn("grid gap-2", canEstimate && "sm:grid-cols-2")}>
                  <Button type="button" variant="outline" className="w-full" onClick={() => update("items", [...draft.items, newFood()])}>
                    <PlusIcon data-icon="inline-start" />
                    Add food
                  </Button>
                  {canEstimate && (
                    <Button type="button" variant="secondary" className="w-full" disabled={estimating} onClick={estimateFoods}>
                      {estimating ? <LoaderCircleIcon data-icon="inline-start" className="animate-spin" /> : <SparklesIcon data-icon="inline-start" />}
                      {estimating ? "Estimating…" : "Estimate calories"}
                    </Button>
                  )}
                </div>
                {!drafting && <CheckboxField label="Save this meal to favorites" checked={saveFavorite} onCheckedChange={setSaveFavorite} />}
              </>
            )}

            {draft.type === "guitar" && (
              <>
                <SelectField label="Song" value={draft.songId} onChange={(e) => update("songId", e.target.value)}>
                  <NativeSelectOption value="">Technique / general practice</NativeSelectOption>
                  {state.songs.map((s) => (
                    <NativeSelectOption key={s.id} value={s.id}>
                      {s.title}
                    </NativeSelectOption>
                  ))}
                </SelectField>
                {commit && <QuickAdd kind="song" commit={commit} records={state.songs} onCreated={(s) => update("songId", s.id)} />}
                <TextField
                  label="Focus or song section"
                  maxLength={200}
                  placeholder="e.g. Verse chord changes"
                  value={draft.section}
                  onChange={(e) => update("section", e.target.value)}
                />
                <div className="grid gap-3 sm:grid-cols-2">
                  <NumberField
                    label="Practice minutes"
                    required
                    min={1}
                    max={1440}
                    value={draft.minutes || ""}
                    onChange={(v) => update("minutes", v)}
                  />
                  <NumberField label="Tempo (BPM)" max={400} value={draft.bpm} onChange={(v) => update("bpm", v)} />
                </div>
                <SelectField
                  label="How did it go?"
                  value={draft.quality === "" || draft.quality === null || draft.quality === undefined ? "" : String(draft.quality)}
                  onChange={(e) => update("quality", e.target.value === "" ? "" : Number(e.target.value))}
                  description={draft.songId ? "Your rating schedules this song's next review." : "Pick a song to schedule reviews from your ratings."}
                >
                  <NativeSelectOption value="">Not rated</NativeSelectOption>
                  {GUITAR_RATINGS.map((label, i) => (
                    <NativeSelectOption key={label} value={String(i + 1)}>
                      {label}
                    </NativeSelectOption>
                  ))}
                </SelectField>
              </>
            )}

            {draft.type === "cardio" && (
              <>
                <TextField
                  label="Activity"
                  required
                  placeholder="e.g. Cycling, walking, running"
                  maxLength={200}
                  value={draft.title}
                  onChange={(e) => update("title", e.target.value)}
                />
                <div className="grid gap-3 sm:grid-cols-2">
                  <NumberField
                    label="Duration (minutes)"
                    required
                    min={1}
                    max={1440}
                    value={draft.minutes || ""}
                    onChange={(v) => update("minutes", v)}
                  />
                  <NumberField label="Distance (km, optional)" step={0.1} value={draft.distance} onChange={(v) => update("distance", v)} />
                </div>
              </>
            )}

            {draft.type === "steps" && (
              <>
                <NumberField label="Total steps for this day" required value={draft.steps} onChange={(v) => update("steps", v)} />
                <Hint>Saving replaces the existing step total for this date.</Hint>
              </>
            )}

            {draft.type === "screentime" && (
              <>
                <NumberField
                  label="Total screen time (minutes)"
                  required
                  max={1440}
                  value={draft.minutes}
                  onChange={(v) => update("minutes", v)}
                />
                <Hint>Copy the total from your phone’s screen-time report. Saving replaces this date’s existing total.</Hint>
              </>
            )}

            {draft.type === "sleep" && (
              <NumberField
                label="Sleep duration (minutes)"
                required
                min={1}
                max={1440}
                value={draft.minutes || ""}
                onChange={(v) => update("minutes", v)}
              />
            )}

            {draft.type === "habit" && (
              <>
                <SelectField
                  label="Habit"
                  required
                  value={draft.habitId}
                  onChange={(e) => {
                    const habitId = e.target.value
                    const h = state.habits.find((x) => x.id === habitId)
                    setDraft((d) => ({ ...d, habitId, unit: h?.unit || "" }))
                  }}
                >
                  <NativeSelectOption value="">Choose a habit</NativeSelectOption>
                  {state.habits.map((h) => (
                    <NativeSelectOption key={h.id} value={h.id}>
                      {h.name}
                    </NativeSelectOption>
                  ))}
                </SelectField>
                {commit ? (
                  <QuickAdd
                    kind="habit"
                    commit={commit}
                    records={state.habits}
                    onCreated={(h) => setDraft((d) => ({ ...d, habitId: h.id, unit: h.unit }))}
                  />
                ) : (
                  !state.habits.length && <Hint>Create a custom habit in Settings first.</Hint>
                )}
                <NumberField
                  label={`Amount (${draft.unit || "times"})`}
                  step={0.1}
                  required
                  value={draft.value}
                  onChange={(v) => update("value", v)}
                />
              </>
            )}

            {(draft.type === "meditation" || isDream) && (
              <>
                <TextField
                  label={isDream ? "Dream title" : "Meditation style (optional)"}
                  maxLength={200}
                  placeholder={isDream ? "e.g. The house by the sea" : "e.g. Breath awareness"}
                  value={draft.title}
                  onChange={(e) => update("title", e.target.value)}
                />
                {!isDream && (
                  <NumberField
                    label="Meditation minutes"
                    required
                    min={1}
                    max={1440}
                    value={draft.minutes || ""}
                    onChange={(v) => update("minutes", v)}
                  />
                )}
                <div className="grid gap-3 sm:grid-cols-2">
                  <SelectField
                    label={isDream ? "Dream vividness" : "Session quality"}
                    value={draft.quality ?? ""}
                    onChange={(e) => update("quality", Number(e.target.value))}
                  >
                    <NativeSelectOption value="" disabled>
                      Choose a rating
                    </NativeSelectOption>
                    {QUALITY_LABELS[draft.type].map((label, i) => (
                      <NativeSelectOption key={i} value={i + 1}>
                        {i + 1} — {label}
                      </NativeSelectOption>
                    ))}
                  </SelectField>
                  <SelectField
                    label={isDream ? "Mood on waking" : "How you felt afterward"}
                    value={draft.mood}
                    onChange={(e) => update("mood", e.target.value)}
                  >
                    {MOODS.map((m) => (
                      <NativeSelectOption key={m} value={m}>
                        {m}
                      </NativeSelectOption>
                    ))}
                  </SelectField>
                </div>
                {isDream ? (
                  <CheckboxField label="I knew I was dreaming (lucid dream)" checked={!!draft.lucid} onCheckedChange={(v) => update("lucid", v)} />
                ) : (
                  <Hint>A personal check-in, not a grade. A distracted session still counts as time spent practicing.</Hint>
                )}
              </>
            )}

            <Field>
              <FieldLabel htmlFor={`${formId}-notes`}>{isDream ? "Your dream" : "Notes (optional)"}</FieldLabel>
              <Textarea
                id={`${formId}-notes`}
                required={isDream}
                maxLength={5000}
                rows={isDream ? 7 : 3}
                className={isDream ? "min-h-40" : "min-h-20"}
                value={draft.notes ?? ""}
                onChange={(e) => update("notes", e.target.value)}
                placeholder={
                  isDream ? "What happened? Who was there? Write any fragments you remember…" : "Anything you want to remember…"
                }
              />
            </Field>
          </FieldGroup>
        </div>

        {error && (
          <Alert variant="destructive">
            <CircleAlertIcon />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <DialogFooter className="flex-row justify-end">
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit">
            <CheckIcon data-icon="inline-start" />
            {saveLabel}
          </Button>
        </DialogFooter>
      </form>
    </>
  )
}
