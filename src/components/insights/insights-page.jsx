import { useMemo, useState } from "react"
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react"
import { shiftDate } from "@/domain"
import { previousRange, rangeDates, RANGE_LABELS, RANGES, tabForMetric } from "@/insights"
import { useApp } from "@/components/app/app-context"
import { Page, PageHeader } from "@/components/app/page"
import { Button } from "@/components/ui/button"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { formatRange } from "@/lib/format"
import { GuitarTab, ReadingTab } from "./library-tabs"
import { HabitsTab, MindTab, ScreenTab, SleepTab, StepsTab } from "./daily-tabs"
import { NutritionTab } from "./nutrition-tab"
import { TrainingTab } from "./training-tab"

export const INSIGHT_TABS = [
  { id: "training", label: "Training", Component: TrainingTab },
  { id: "nutrition", label: "Nutrition", Component: NutritionTab },
  { id: "steps", label: "Steps", Component: StepsTab },
  { id: "sleep", label: "Sleep", Component: SleepTab },
  { id: "screen", label: "Screen time", Component: ScreenTab },
  { id: "reading", label: "Reading", Component: ReadingTab },
  { id: "guitar", label: "Guitar", Component: GuitarTab },
  { id: "mind", label: "Mind", Component: MindTab },
  { id: "habits", label: "Habits", Component: HabitsTab },
]
const TAB_IDS = INSIGHT_TABS.map((t) => t.id)

const PRESETS = [
  { value: "last_7_days", short: "7D", days: 7 },
  { value: "last_30_days", short: "30D", days: 30 },
  { value: "last_90_days", short: "90D", days: 90 },
]
const DEFAULT_RANGE = "last_30_days"

// A window ending today with a preset length is stored as the preset; anything else is custom.
function toRangeState(from, to, today) {
  let start = from
  let end = to
  const length = rangeDates("custom", today, from, to).dates.length
  if (end >= today) {
    end = today
    start = shiftDate(today, -(length - 1))
  }
  const preset = end === today && PRESETS.find((p) => p.days === length)
  return preset ? { range: preset.value } : { range: "custom", from: start, to: end }
}

function rangeFromParams(params, today) {
  const range = params?.range
  if (PRESETS.some((p) => p.value === range)) return { range }
  if (range && RANGES.includes(range)) {
    try {
      const window = rangeDates(range, today, params.from, params.to)
      return toRangeState(window.from, window.to, today)
    } catch {
      // Fall through to the default range.
    }
  }
  return { range: DEFAULT_RANGE }
}

function resolvePeriod(rangeState, today) {
  try {
    return rangeDates(rangeState.range, today, rangeState.from, rangeState.to)
  } catch {
    return rangeDates(DEFAULT_RANGE, today)
  }
}

const tabFromParams = (params) => (TAB_IDS.includes(params?.tab) ? params.tab : "training")

export function InsightsPage() {
  const { state, today, params } = useApp()
  const [tab, setTab] = useState(() => tabFromParams(params))
  const [rangeState, setRangeState] = useState(() => rangeFromParams(params, today))
  const [habitChoice, setHabitChoice] = useState(() => params?.habitId || null)

  // Re-apply params when the app navigates here again with different ones.
  const paramKey = JSON.stringify([params?.tab, params?.range, params?.from, params?.to, params?.habitId])
  const [appliedKey, setAppliedKey] = useState(paramKey)
  if (paramKey !== appliedKey) {
    setAppliedKey(paramKey)
    if (params?.tab) setTab(tabFromParams(params))
    if (params?.range) setRangeState(rangeFromParams(params, today))
    if (params?.habitId) setHabitChoice(params.habitId)
  }

  const period = useMemo(() => resolvePeriod(rangeState, today), [rangeState, today])
  // The resolved window as explicit dates, so every series matches `period` exactly.
  const opts = useMemo(() => ({ range: "custom", from: period.from, to: period.to }), [period])
  const previous = useMemo(() => previousRange(period), [period])

  const habits = state.habits || []
  const habitId = habits.some((h) => h.id === habitChoice) ? habitChoice : habits[0]?.id
  const tabs = habits.length ? INSIGHT_TABS : INSIGHT_TABS.filter((t) => t.id !== "habits")
  const activeTab = tabs.some((t) => t.id === tab) ? tab : "training"

  const length = period.dates.length
  const activePreset = PRESETS.find((p) => p.days === length)?.value ?? ""
  const atToday = period.to >= today

  const choosePreset = (value) => {
    // Clicking the highlighted preset (value "") jumps back to the window ending today.
    const next = value || activePreset
    if (next) setRangeState({ range: next })
  }
  const shift = (direction) => {
    const from = shiftDate(period.from, direction * length)
    const to = shiftDate(period.to, direction * length)
    setRangeState(toRangeState(from, to, today))
  }

  const rangeControl = (
    <div className="flex items-center gap-2">
      <ToggleGroup
        type="single"
        variant="outline"
        size="sm"
        spacing={0}
        value={activePreset}
        onValueChange={choosePreset}
        aria-label="Date range"
      >
        {PRESETS.map((preset) => (
          <ToggleGroupItem key={preset.value} value={preset.value} aria-label={RANGE_LABELS[preset.value]} className="px-3 tabular-nums">
            {preset.short}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
      <Button variant="outline" size="icon-sm" aria-label="Previous period" onClick={() => shift(-1)}>
        <ChevronLeftIcon />
      </Button>
      <Button variant="outline" size="icon-sm" aria-label="Next period" disabled={atToday} onClick={() => shift(1)}>
        <ChevronRightIcon />
      </Button>
    </div>
  )

  return (
    <Page>
      <PageHeader
        title="Insights"
        description={
          <>
            <span className="tabular-nums">{formatRange(period.from, period.to)}</span>
            <span className="hidden text-xs tabular-nums md:block">vs {formatRange(previous.from, previous.to)}</span>
          </>
        }
        actions={rangeControl}
      />
      <Tabs value={activeTab} onValueChange={setTab} className="min-w-0 gap-4">
        <div className="-mx-4 overflow-x-auto px-4 pb-1 md:mx-0 md:px-0">
          <TabsList variant="line" className="justify-start">
            {tabs.map((t) => (
              <TabsTrigger key={t.id} value={t.id} className="flex-none px-2.5">
                {t.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>
        {tabs.map(({ id, Component }) => (
          <TabsContent key={id} value={id} className="flex min-w-0 flex-col gap-4">
            <Component opts={opts} period={period} habitId={habitId} onHabitChange={setHabitChoice} />
          </TabsContent>
        ))}
      </Tabs>
    </Page>
  )
}

export default InsightsPage

export { tabForMetric }
