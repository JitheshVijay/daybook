import * as React from "react"
import { CheckIcon, ChevronLeftIcon, ChevronRightIcon, PlusIcon, CalendarPlusIcon } from "lucide-react"
import { toast } from "sonner"
import { completed, dateKey, fmtDate, id, LABELS, monthDates, parseDate, shiftDate, sum, totals, TYPES, upsertEntry, validateState } from "@/domain"
import { TypeIcon } from "@/lib/entry-meta"
import { formatValue } from "@/lib/format"
import { cn } from "@/lib/utils"
import { useApp } from "@/components/app/app-context"
import { EntryRow } from "@/components/app/entry-row"
import { LoggingHeatmap } from "./logging-heatmap"
import { Page, PageHeader } from "@/components/app/page"
import { Stat } from "@/components/app/stat"
import { Button } from "@/components/ui/button"
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { ItemGroup } from "@/components/ui/item"
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select"

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
const QUICK = ["steps", "sleep", "screentime", "meditation", "food", "habit"]

export function JournalPage() {
  const { state, commit, today, openEntry, logEntry } = useApp()
  // Yes-or-no habits (once a day) are checked off with one tap.
  const checkOff = (habit) => {
    const entry = {
      id: id(), type: "habit", date: selected, time: selected === today ? new Date().toTimeString().slice(0, 5) : "21:00", status: "done", title: "", notes: "",
      minutes: 0, pages: 0, chapters: 0, steps: 0, distance: 0, bpm: 0, value: 1, quality: 3, mood: "Neutral", lucid: false, section: "", unit: habit.unit,
      bookId: "", songId: "", habitId: habit.id, exercises: [], items: [],
    }
    try {
      commit((s) => validateState(upsertEntry(s, entry)))
      toast.success(`${habit.name} done`, { action: { label: "Undo", onClick: () => commit((s) => ({ ...s, entries: s.entries.filter((e) => e.id !== entry.id) })) } })
    } catch (error) {
      toast.error(error.message)
    }
  }
  const [selected, setSelected] = React.useState(today)
  const [month, setMonth] = React.useState(`${today.slice(0, 7)}-01`)
  const [filter, setFilter] = React.useState("all")

  const byDate = React.useMemo(() => {
    const map = new Map()
    for (const e of state.entries) {
      if (!map.has(e.date)) map.set(e.date, [])
      map.get(e.date).push(e)
    }
    return map
  }, [state.entries])

  const days = monthDates(month)
  const dayEntries = (byDate.get(selected) || [])
    .filter((e) => filter === "all" || e.type === filter)
    .sort((a, b) => a.time.localeCompare(b.time))
  const dayTotals = totals(byDate.get(selected) || [])
  const activeMinutes = dayTotals.workoutMinutes + dayTotals.cardio
  const moveMonth = (delta) => {
    const d = parseDate(month)
    d.setMonth(d.getMonth() + delta)
    setMonth(`${dateKey(d).slice(0, 7)}-01`)
  }
  const choose = (key) => {
    setSelected(key)
    if (key.slice(0, 7) !== month.slice(0, 7)) setMonth(`${key.slice(0, 7)}-01`)
  }

  return (
    <Page>
      <PageHeader
        title="Journal"
        description="Every entry, day by day. Tap one to edit or delete it."
        actions={
          <>
            <Button variant="outline" size="sm" onClick={() => logEntry("workout", { date: selected, status: "planned" })}>
              <CalendarPlusIcon data-icon="inline-start" />
              Plan
            </Button>
            <Button size="sm" onClick={() => logEntry(undefined, { date: selected > today ? today : selected })}>
              <PlusIcon data-icon="inline-start" />
              Log activity
            </Button>
          </>
        }
      />
      <LoggingHeatmap selected={selected} onSelect={choose} />
      <div className="grid min-w-0 gap-6 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
        <Card className="h-fit w-full min-w-0 lg:max-w-none">
          <CardHeader>
            <CardTitle>{fmtDate(month, { month: "long", year: "numeric" })}</CardTitle>
            <CardAction className="flex items-center gap-1">
              <Button variant="ghost" size="icon-sm" aria-label="Previous month" onClick={() => moveMonth(-1)}>
                <ChevronLeftIcon />
              </Button>
              <Button variant="ghost" size="sm" onClick={() => (setMonth(`${today.slice(0, 7)}-01`), setSelected(today))}>
                Today
              </Button>
              <Button variant="ghost" size="icon-sm" aria-label="Next month" onClick={() => moveMonth(1)}>
                <ChevronRightIcon />
              </Button>
            </CardAction>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-7 gap-1 text-center text-xs text-muted-foreground" aria-hidden="true">
              {WEEKDAYS.map((d) => (
                <span key={d} className="py-1">{d}</span>
              ))}
            </div>
            <div className="grid grid-cols-7 gap-1" role="grid" aria-label="Month calendar">
              {days.map((key) => {
                const logs = byDate.get(key) || []
                const done = completed(logs).length
                const planned = logs.length - done
                const outside = key.slice(0, 7) !== month.slice(0, 7)
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => choose(key)}
                    aria-label={`${fmtDate(key, { weekday: "long", day: "numeric", month: "long" })}: ${done} logged${planned ? `, ${planned} planned` : ""}`}
                    aria-pressed={key === selected}
                    className={cn(
                      "flex h-11 min-w-0 flex-col items-center justify-center gap-0.5 rounded-md text-sm tabular-nums transition-colors hover:bg-muted",
                      outside && "text-muted-foreground/50",
                      key === today && "font-semibold text-foreground ring-1 ring-border",
                      key === selected && "bg-primary text-primary-foreground hover:bg-primary/90",
                    )}
                  >
                    {parseDate(key).getDate()}
                    <span className="flex h-1.5 gap-0.5" aria-hidden="true">
                      {done > 0 && <span className={cn("size-1.5 rounded-full", key === selected ? "bg-primary-foreground" : "bg-chart-1")} />}
                      {planned > 0 && <span className={cn("size-1.5 rounded-full border", key === selected ? "border-primary-foreground" : "border-muted-foreground")} />}
                    </span>
                  </button>
                )
              })}
            </div>
            <p className="mt-3 flex items-center gap-3 text-xs text-muted-foreground">
              <span className="flex items-center gap-1"><span className="size-1.5 rounded-full bg-chart-1" /> Logged</span>
              <span className="flex items-center gap-1"><span className="size-1.5 rounded-full border border-muted-foreground" /> Planned</span>
            </p>
          </CardContent>
        </Card>

        <div className="flex min-w-0 flex-col gap-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-1">
              <Button variant="ghost" size="icon-sm" aria-label="Previous day" onClick={() => choose(shiftDate(selected, -1))}>
                <ChevronLeftIcon />
              </Button>
              <h2 className="font-heading text-lg font-semibold">
                {selected === today ? "Today" : fmtDate(selected, { weekday: "long", day: "numeric", month: "long" })}
              </h2>
              <Button variant="ghost" size="icon-sm" aria-label="Next day" onClick={() => choose(shiftDate(selected, 1))}>
                <ChevronRightIcon />
              </Button>
            </div>
            <NativeSelect aria-label="Activity filter" value={filter} onChange={(e) => setFilter(e.target.value)} size="sm">
              <NativeSelectOption value="all">All activities</NativeSelectOption>
              {TYPES.map((type) => (
                <NativeSelectOption key={type} value={type}>{LABELS[type]}</NativeSelectOption>
              ))}
            </NativeSelect>
          </div>
          <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
            <Stat label="Calories" value={formatValue(dayTotals.calories || null, "kcal")} />
            <Stat label="Steps" value={dayTotals.steps ? formatValue(dayTotals.steps, "") : "—"} />
            <Stat label="Active time" value={activeMinutes ? formatValue(activeMinutes, "min") : "—"} />
            <Stat label="Entries" value={completed(byDate.get(selected) || []).length} hint={(byDate.get(selected) || []).some((e) => e.status === "planned") ? "plus plans" : undefined} />
          </div>
          <Card className="min-w-0">
            <CardHeader>
              <CardTitle>Entries</CardTitle>
              <CardDescription>{dayEntries.length ? `${dayEntries.length} on this day` : "Nothing here yet"}</CardDescription>
            </CardHeader>
            <CardContent>
              {dayEntries.length ? (
                <ItemGroup className="gap-1">
                  {dayEntries.map((entry) => (
                    <EntryRow key={entry.id} entry={entry} state={state} onOpen={openEntry} />
                  ))}
                </ItemGroup>
              ) : (
                <Empty className="border py-8">
                  <EmptyHeader>
                    <EmptyTitle>No entries for this day</EmptyTitle>
                    <EmptyDescription>Tell Daybook in chat, or add one here.</EmptyDescription>
                  </EmptyHeader>
                  <EmptyContent>
                    <div className="flex flex-wrap justify-center gap-2">
                      {QUICK.map((type) => (
                        <Button key={type} variant="outline" size="sm" disabled={selected > today && type !== "workout"} onClick={() => logEntry(type, { date: selected })}>
                          <TypeIcon type={type} data-icon="inline-start" />
                          {LABELS[type]}
                        </Button>
                      ))}
                    </div>
                  </EmptyContent>
                </Empty>
              )}
            </CardContent>
          </Card>
          {state.habits.length > 0 && (
            <Card className="min-w-0">
              <CardHeader>
                <CardTitle>Habits</CardTitle>
                <CardDescription>Progress on this day</CardDescription>
              </CardHeader>
              <CardContent className="grid gap-2 sm:grid-cols-2">
                {state.habits.map((habit) => {
                  const logs = completed(byDate.get(selected) || []).filter((e) => e.habitId === habit.id)
                  const value = sum(logs, (e) => e.value)
                  if (habit.goal === 1 && habit.unit === "times") {
                    const done = value >= 1
                    return (
                      <Button
                        key={habit.id}
                        variant={done ? "secondary" : "outline"}
                        className="h-auto justify-between gap-3 py-2"
                        disabled={!done && selected > today}
                        aria-pressed={done}
                        onClick={() => (done ? openEntry(logs[0]) : checkOff(habit))}
                      >
                        <span className="truncate">{habit.name}</span>
                        <span className="flex items-center gap-1 text-xs text-muted-foreground">
                          {done ? <CheckIcon className="size-4 text-foreground" /> : null}
                          {done ? "Done" : "Tap when done"}
                        </span>
                      </Button>
                    )
                  }
                  return (
                    <Button key={habit.id} variant="outline" className="h-auto justify-between gap-3 py-2" onClick={() => logEntry("habit", { date: selected, habitId: habit.id, unit: habit.unit })}>
                      <span className="truncate">{habit.name}</span>
                      <span className="text-xs text-muted-foreground tabular-nums">
                        {value}
                        {habit.goal ? ` / ${habit.goal}` : ""} {habit.unit}
                      </span>
                    </Button>
                  )
                })}
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </Page>
  )
}
