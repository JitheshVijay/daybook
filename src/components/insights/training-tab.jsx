import { useMemo, useState } from "react"
import Model from "react-body-highlighter"
import { doneSets, fmtDate, MUSCLES, sum } from "@/domain"
import { entriesInRange, setsByMuscle } from "@/insights"
import { useApp } from "@/components/app/app-context"
import { Stat } from "@/components/app/stat"
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { formatNumber } from "@/lib/format"
import { BarList, ChartCard, KpiRow, MainChartCard, MutedNote, RecentEntriesCard, useSeries } from "./insight-cards"

// Chart palette ramp for set counts 1…5+, on a neutral body.
const HEAT_COLORS = ["#9ec5f4", "#6da7ec", "#3987e5", "#256abf", "#184f95"]
const BODY_COLOR = "#a3a3a3"
const TRAINING_TYPES = ["workout", "cardio"]
const muscleName = (m) => m.replaceAll("-", " ")
// react-body-highlighter's thigh areas don't follow anatomy: its front inner-thigh area is
// named "abductors", its back inner-thigh area "adductor", and it has no outer-hip area.
// Adductors light both inner-thigh areas; hip abductors count toward the glutes.
const BODY_AREAS = { adductor: ["abductors", "adductor"], abductors: ["gluteal"] }
const AREA_MUSCLES = { abductors: ["adductor"], adductor: ["adductor"], gluteal: ["gluteal", "abductors"] }
const AREA_LABELS = { abductors: "Adductors (inner thigh)", adductor: "Adductors (inner thigh)", gluteal: "Glutes and hip abductors" }

export function TrainingTab({ opts, period }) {
  const { state } = useApp()
  const workouts = useSeries("workouts", opts)
  const volume = useSeries("volume", opts)
  const cardio = useSeries("cardio", opts)
  const muscles = useMemo(() => setsByMuscle(state, period), [state, period])

  return (
    <>
      <KpiRow series={workouts} />
      <MainChartCard series={workouts} logType="workout" logLabel="Log workout" />
      <div className="grid items-start gap-4 lg:grid-cols-2">
        <ChartCard series={volume} />
        <ChartCard series={cardio} title="Cardio" description={`Cardio minutes per ${cardio.bucket}`} />
        <SetsByMuscleCard muscles={muscles} />
        <BodyHeatmapCard muscles={muscles} />
        <ExerciseHistoryCard period={period} />
        <RecentEntriesCard types={TRAINING_TYPES} period={period} logType="workout" logLabel="Log workout" />
      </div>
    </>
  )
}

function SetsByMuscleCard({ muscles }) {
  return (
    <Card className="min-w-0">
      <CardHeader>
        <CardTitle>Sets by muscle</CardTitle>
        <CardDescription>Completed sets per primary muscle</CardDescription>
      </CardHeader>
      <CardContent className="px-2">
        {muscles.length ? (
          <BarList
            capitalize
            rows={muscles.map((m) => ({ key: m.muscle, label: m.label, value: m.sets, display: `${m.sets} ${m.sets === 1 ? "set" : "sets"}` }))}
          />
        ) : (
          <MutedNote>No completed sets in this range.</MutedNote>
        )}
      </CardContent>
    </Card>
  )
}

function BodyHeatmapCard({ muscles }) {
  const [view, setView] = useState("anterior")
  const [selected, setSelected] = useState(null)
  const data = muscles.map((m) => ({ name: m.label, muscles: BODY_AREAS[m.muscle] || [m.muscle], frequency: m.sets }))
  const selectedMuscles = selected ? AREA_MUSCLES[selected] || [selected] : []
  const selectedSets = sum(muscles.filter((m) => selectedMuscles.includes(m.muscle)), (m) => m.sets)

  return (
    <Card className="min-w-0">
      <CardHeader>
        <CardTitle>Muscle map</CardTitle>
        <CardDescription>Tap a muscle for its sets</CardDescription>
        <CardAction>
          <ToggleGroup
            type="single"
            variant="outline"
            size="sm"
            spacing={0}
            value={view}
            onValueChange={(value) => value && setView(value)}
            aria-label="Body view"
          >
            <ToggleGroupItem value="anterior">Front</ToggleGroupItem>
            <ToggleGroupItem value="posterior">Back</ToggleGroupItem>
          </ToggleGroup>
        </CardAction>
      </CardHeader>
      <CardContent className="flex min-w-0 flex-col gap-3">
        <div className="rounded-lg bg-muted/40 p-4">
          <div role="img" aria-label={`${view === "anterior" ? "Front" : "Back"} body map of completed sets per muscle`}>
            <Model
              type={view}
              data={data}
              bodyColor={BODY_COLOR}
              highlightedColors={HEAT_COLORS}
              style={{ width: "100%", maxWidth: 220, margin: "0 auto" }}
              onClick={({ muscle }) => (MUSCLES.includes(muscle) || AREA_MUSCLES[muscle]) && setSelected(muscle)}
            />
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-center gap-1.5 text-xs text-muted-foreground" aria-hidden="true">
          <span>0</span>
          <span className="size-3 rounded-sm" style={{ backgroundColor: BODY_COLOR }} />
          {HEAT_COLORS.map((color) => (
            <span key={color} className="size-3 rounded-sm" style={{ backgroundColor: color }} />
          ))}
          <span>5+ sets</span>
        </div>
        <p className="min-h-5 text-center text-sm tabular-nums" aria-live="polite">
          {selected && (
            <>
              <span className={AREA_LABELS[selected] ? "font-medium" : "font-medium capitalize"}>{AREA_LABELS[selected] || muscleName(selected)}</span>
              <span className="text-muted-foreground"> · {selectedSets} {selectedSets === 1 ? "set" : "sets"}</span>
            </>
          )}
        </p>
        <p className="text-center text-xs text-muted-foreground">
          Primary-muscle sets in this range. Not a recovery or soreness measure.
        </p>
      </CardContent>
    </Card>
  )
}

function ExerciseHistoryCard({ period }) {
  const { state, openEntry } = useApp()
  const [exercise, setExercise] = useState("")
  const workouts = useMemo(
    () => entriesInRange(state, period.from, period.to, ["workout"]).sort((a, b) => `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`)),
    [state, period],
  )
  const names = useMemo(() => [...new Set(workouts.flatMap((e) => (e.exercises || []).map((x) => x.name)))], [workouts])
  const chosen = names.includes(exercise) ? exercise : names[0]
  const history = workouts.filter((e) => e.exercises?.some((x) => x.name === chosen))
  const historySets = history.flatMap(doneSets).filter((s) => s.exercise === chosen)
  const heaviest = Math.max(0, ...historySets.map((s) => s.weight))
  const sessions = history
    .slice(-8)
    .reverse()
    .map((entry) => {
      const sets = doneSets(entry).filter((s) => s.exercise === chosen)
      return { entry, max: Math.max(0, ...sets.map((s) => s.weight)), count: sets.length }
    })

  return (
    <Card className="min-w-0">
      <CardHeader>
        <CardTitle>Exercise history</CardTitle>
        <CardDescription>Heaviest completed set per session</CardDescription>
      </CardHeader>
      <CardContent className="@container/history flex min-w-0 flex-col gap-3">
        {names.length ? (
          <>
            <NativeSelect aria-label="Exercise" className="w-full" value={chosen} onChange={(e) => setExercise(e.target.value)}>
              {names.map((name) => (
                <NativeSelectOption key={name} value={name}>
                  {name}
                </NativeSelectOption>
              ))}
            </NativeSelect>
            <div className="grid gap-3 @sm/history:grid-cols-2">
              <Stat label="Heaviest completed set" value={`${formatNumber(heaviest)} kg`} />
              <Stat label="Completed reps" value={formatNumber(sum(historySets, (s) => s.reps), 0)} />
            </div>
            <div className="-mx-2">
              <BarList
                rows={sessions.map(({ entry, max, count }) => ({
                  key: entry.id,
                  label: fmtDate(entry.date, { weekday: "short", day: "numeric", month: "short" }),
                  value: max,
                  display: `${count} ${count === 1 ? "set" : "sets"} · ${formatNumber(max)} kg`,
                  onSelect: () => openEntry(entry),
                }))}
              />
            </div>
          </>
        ) : (
          <MutedNote>Log a workout to see exercise history.</MutedNote>
        )}
      </CardContent>
    </Card>
  )
}
