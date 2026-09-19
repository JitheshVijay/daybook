import { useCallback, useMemo } from "react"
import { entriesInRange } from "@/insights"
import { useApp } from "@/components/app/app-context"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select"
import { formatDay } from "@/lib/format"
import { ChartCard, GoalDaysCard, KpiRow, MainChartCard, MutedNote, RecentEntriesCard, useSeries } from "./insight-cards"

const STEPS_TYPES = ["steps"]
const SLEEP_TYPES = ["sleep"]
const SCREEN_TYPES = ["screentime"]
const MEDITATION_TYPES = ["meditation"]
const HABIT_TYPES = ["habit"]
const DAY = { groupBy: "day" }

export function StepsTab({ opts, period }) {
  const steps = useSeries("steps", opts)
  const daily = useSeries("steps", opts, DAY)
  return (
    <>
      <KpiRow series={steps} />
      <MainChartCard series={steps} logType="steps" logLabel="Log steps" />
      <div className="grid items-start gap-4 lg:grid-cols-2">
        <GoalDaysCard series={daily} title="Days at goal" noGoalText="Set a daily steps goal in Settings to track this." />
        <RecentEntriesCard types={STEPS_TYPES} period={period} logType="steps" logLabel="Log steps" />
      </div>
    </>
  )
}

export function SleepTab({ opts, period }) {
  const sleep = useSeries("sleep", opts)
  return (
    <>
      <KpiRow series={sleep} />
      <MainChartCard series={sleep} logType="sleep" logLabel="Log sleep" />
      <RecentEntriesCard types={SLEEP_TYPES} period={period} logType="sleep" logLabel="Log sleep" />
    </>
  )
}

export function ScreenTab({ opts, period }) {
  const screen = useSeries("screentime", opts)
  const daily = useSeries("screentime", opts, DAY)
  return (
    <>
      <KpiRow series={screen} />
      <MainChartCard series={screen} logType="screentime" logLabel="Log screen time" />
      <div className="grid items-start gap-4 lg:grid-cols-2">
        <GoalDaysCard series={daily} title="Days under limit" noGoalText="Set a daily screen time limit in Settings to track this." />
        <RecentEntriesCard types={SCREEN_TYPES} period={period} logType="screentime" logLabel="Log screen time" />
      </div>
    </>
  )
}

export function MindTab({ opts, period }) {
  const meditation = useSeries("meditation", opts)
  const quality = useSeries("meditationQuality", opts)
  const dreams = useSeries("dreams", opts)
  return (
    <>
      <KpiRow series={meditation} />
      <MainChartCard series={meditation} logType="meditation" logLabel="Log meditation" />
      <div className="grid items-start gap-4 lg:grid-cols-2">
        <ChartCard series={quality} type="line" title="Session quality" description={`Average rating out of 5 per ${quality.bucket}`} />
        <ChartCard series={dreams} />
        <RecentDreamsCard period={period} />
        <RecentEntriesCard types={MEDITATION_TYPES} period={period} logType="meditation" logLabel="Log meditation" className="lg:col-span-2" title="Recent sessions" />
      </div>
    </>
  )
}

function RecentDreamsCard({ period }) {
  const { state, openEntry } = useApp()
  const dreams = useMemo(
    () =>
      entriesInRange(state, period.from, period.to, ["dream"])
        .sort((a, b) => `${b.date} ${b.time}`.localeCompare(`${a.date} ${a.time}`))
        .slice(0, 6),
    [state, period],
  )
  return (
    <Card className="min-w-0 lg:col-span-2">
      <CardHeader>
        <CardTitle>Recent dreams</CardTitle>
        <CardDescription>Latest dream journal entries in this range</CardDescription>
      </CardHeader>
      <CardContent className="@container/dreams min-w-0">
        {dreams.length ? (
          <ul className="grid min-w-0 gap-3 @lg/dreams:grid-cols-2 @3xl/dreams:grid-cols-3">
            {dreams.map((dream) => {
              const notes = dream.notes || ""
              return (
                <li key={dream.id} className="min-w-0">
                  <button
                    type="button"
                    onClick={() => openEntry(dream)}
                    className="flex size-full min-w-0 flex-col gap-2 rounded-lg border p-3 text-left outline-none hover:bg-muted/50 focus-visible:ring-[3px] focus-visible:ring-ring/50"
                  >
                    <span className="flex min-w-0 items-baseline justify-between gap-2">
                      <span className="truncate font-medium">{dream.title || "Untitled dream"}</span>
                      <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{formatDay(dream.date)}</span>
                    </span>
                    {notes && (
                      <span className="line-clamp-3 break-words text-muted-foreground">
                        {notes.slice(0, 160)}
                        {notes.length > 160 ? "…" : ""}
                      </span>
                    )}
                    <span className="mt-auto flex flex-wrap gap-1.5">
                      {dream.mood && <Badge variant="secondary">{dream.mood}</Badge>}
                      {dream.quality ? <Badge variant="outline">Vividness {dream.quality}/5</Badge> : null}
                      {dream.lucid && <Badge variant="outline">Lucid</Badge>}
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
        ) : (
          <MutedNote>No dreams recorded in this range.</MutedNote>
        )}
      </CardContent>
    </Card>
  )
}

export function HabitsTab({ opts, period, habitId, onHabitChange }) {
  const { state } = useApp()
  const habit = useSeries("habit", opts, { habitId })
  const filter = useCallback((e) => e.habitId === habitId, [habitId])
  const overrides = useMemo(() => ({ habitId }), [habitId])
  return (
    <>
      <div className="flex min-w-0 items-center gap-2">
        <NativeSelect
          aria-label="Habit"
          className="w-full sm:w-auto sm:min-w-56"
          value={habitId}
          onChange={(e) => onHabitChange(e.target.value)}
        >
          {state.habits.map((h) => (
            <NativeSelectOption key={h.id} value={h.id}>
              {h.name}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      </div>
      <KpiRow series={habit} />
      <MainChartCard series={habit} logType="habit" logLabel="Log habit" logOverrides={overrides} />
      <RecentEntriesCard types={HABIT_TYPES} filter={filter} period={period} logType="habit" logLabel="Log habit" logOverrides={overrides} />
    </>
  )
}
