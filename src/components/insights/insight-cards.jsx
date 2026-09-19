import { useMemo } from "react"
import { MessageCircleIcon, PlusIcon } from "lucide-react"
import { computeSeries, daysAtGoal, entriesInRange } from "@/insights"
import { useApp } from "@/components/app/app-context"
import { EntryRow } from "@/components/app/entry-row"
import { MetricChart } from "@/components/app/metric-chart"
import { Stat } from "@/components/app/stat"
import { Button } from "@/components/ui/button"
import { Card, CardAction, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { Progress } from "@/components/ui/progress"
import { TypeIcon } from "@/lib/entry-meta"
import { formatChange, formatDay, formatNumber, formatRange, formatValue } from "@/lib/format"
import { cn } from "@/lib/utils"

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

// computeSeries for the current state, range, and today. opts: { range, from?, to? }.
export function useSeries(metric, opts, extra = {}) {
  const { state, today } = useApp()
  const { habitId, groupBy } = extra
  return useMemo(
    () => computeSeries(state, metric, { ...opts, habitId, groupBy }, today),
    [state, today, metric, opts, habitId, groupBy],
  )
}

// "Calories per day · goal 2,000 kcal"
export function describeSeries(series, noun = series.label) {
  const parts = [`${noun} per ${series.bucket}`]
  if (series.goal) parts.push(`${series.lowerIsBetter ? "limit" : "goal"} ${formatValue(series.goal, series.unit)}`)
  return parts.join(" · ")
}

export function hasData(series) {
  return series.summary.daysWithData > 0
}

// Tile value with a smaller unit so large totals fit two-up tiles on phones.
export function TileValue({ value, unit }) {
  if (value === null || value === undefined) return "—"
  if (unit === "min") return formatValue(value, unit)
  const number =
    Math.abs(value) >= 1_000_000
      ? new Intl.NumberFormat("en-GB", { notation: "compact", maximumFractionDigits: 2 }).format(value)
      : formatNumber(value, unit === "/ 5" ? 2 : 1)
  if (!unit) return number
  return (
    <>
      {number}
      <span className="ml-1 text-sm font-normal text-muted-foreground">{unit}</span>
    </>
  )
}

export function KpiRow({ series }) {
  const { summary, unit, lowerIsBetter, kind } = series
  const logged = summary.daysWithData
  const { change, total: previousTotal } = summary.previous
  const tone = !change ? "neutral" : change > 0 !== lowerIsBetter ? "good" : "bad"
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <Stat
        label={kind === "mean" ? "Average" : "Total"}
        value={logged ? <TileValue value={summary.total} unit={unit} /> : "—"}
        hint={`across ${plural(summary.days, "day")}`}
      />
      <Stat
        label="Daily average"
        value={logged ? <TileValue value={summary.perLoggedDay} unit={unit} /> : "—"}
        hint={`on ${plural(logged, "logged day")}`}
      />
      <Stat
        label={lowerIsBetter ? "Lowest day" : "Best day"}
        value={summary.best ? <TileValue value={summary.best.value} unit={unit} /> : "—"}
        hint={summary.best ? formatDay(summary.best.date) : "No entries"}
      />
      <Stat
        label="vs previous period"
        value={change === null ? "—" : formatChange(change)}
        hint={change === null ? "No earlier data" : `from ${formatValue(previousTotal, unit)}`}
        trend={change === null ? undefined : { text: change > 0 ? "Up" : change < 0 ? "Down" : "Flat", tone }}
      />
    </div>
  )
}

function EmptyMetric({ series, logType, logLabel, logOverrides }) {
  const { logEntry, navigate } = useApp()
  const noun = series.metric === "habit" ? series.label : series.label.toLowerCase()
  return (
    <Empty className="min-h-56 border">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <TypeIcon type={logType} />
        </EmptyMedia>
        <EmptyTitle>
          No {noun} logged {formatRange(series.from, series.to)}
        </EmptyTitle>
        <EmptyDescription>Tell Daybook in chat, or log it manually.</EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <div className="flex flex-wrap justify-center gap-2">
          {logType && (
            <Button size="sm" onClick={() => logEntry(logType, logOverrides)}>
              <PlusIcon data-icon="inline-start" />
              {logLabel}
            </Button>
          )}
          <Button size="sm" variant="outline" onClick={() => navigate("chat")}>
            <MessageCircleIcon data-icon="inline-start" />
            Open chat
          </Button>
        </div>
      </EmptyContent>
    </Empty>
  )
}

// The tab's headline chart. Shows an Empty state instead of a blank chart.
export function MainChartCard({ series, title, description, type = "bar", height = 240, logType, logLabel, logOverrides, action, footer }) {
  const heading = title ?? series.label
  return (
    <Card className="min-w-0">
      <CardHeader>
        <CardTitle>{heading}</CardTitle>
        <CardDescription>{description ?? describeSeries(series)}</CardDescription>
        {action && <CardAction>{action}</CardAction>}
      </CardHeader>
      <CardContent className="min-w-0">
        {hasData(series) ? (
          <MetricChart series={series} type={type} height={height} title={heading} />
        ) : (
          <EmptyMetric series={series} logType={logType} logLabel={logLabel} logOverrides={logOverrides} />
        )}
      </CardContent>
      {footer && <CardFooter className="text-xs text-muted-foreground">{footer}</CardFooter>}
    </Card>
  )
}

export function MutedNote({ children, className }) {
  return <p className={cn("py-6 text-center text-sm text-muted-foreground", className)}>{children}</p>
}

export function ChartCard({ series, title, description, type = "bar", height = 200, className }) {
  const heading = title ?? series.label
  return (
    <Card className={cn("min-w-0", className)}>
      <CardHeader>
        <CardTitle>{heading}</CardTitle>
        <CardDescription>{description ?? describeSeries(series)}</CardDescription>
      </CardHeader>
      <CardContent className="min-w-0">
        {hasData(series) ? (
          <MetricChart series={series} type={type} height={height} title={heading} />
        ) : (
          <MutedNote>Nothing logged in this range.</MutedNote>
        )}
      </CardContent>
    </Card>
  )
}

// Label + value on one line, a bar sized relative to the largest row underneath.
// rows: [{ key, label, value, display, onSelect? }]
export function BarList({ rows, capitalize = false }) {
  const max = Math.max(0, ...rows.map((r) => r.value))
  return (
    <ul className="flex min-w-0 flex-col gap-1">
      {rows.map((row) => {
        const body = (
          <>
            <span className="flex min-w-0 items-baseline justify-between gap-3">
              <span className={cn("truncate", capitalize && "capitalize")}>{row.label}</span>
              <span className="shrink-0 tabular-nums text-muted-foreground">{row.display}</span>
            </span>
            <Progress
              value={max ? (row.value / max) * 100 : 0}
              aria-label={`${row.label}: ${row.display}`}
              className="h-1.5 [&>[data-slot=progress-indicator]]:bg-chart-1"
            />
          </>
        )
        return (
          <li key={row.key} className="min-w-0">
            {row.onSelect ? (
              <button
                type="button"
                onClick={row.onSelect}
                className="flex w-full min-w-0 flex-col gap-1.5 rounded-md px-2 py-1.5 text-left text-sm outline-none hover:bg-muted/50 focus-visible:ring-[3px] focus-visible:ring-ring/50"
              >
                {body}
              </button>
            ) : (
              <div className="flex min-w-0 flex-col gap-1.5 px-2 py-1.5 text-sm">{body}</div>
            )}
          </li>
        )
      })}
    </ul>
  )
}

const byNewest = (a, b) => `${b.date} ${b.time}`.localeCompare(`${a.date} ${a.time}`)

export function RecentEntriesCard({ types, period, filter, logType, logLabel, logOverrides, className, title = "Recent entries" }) {
  const { state, openEntry, logEntry } = useApp()
  const all = useMemo(() => {
    const list = entriesInRange(state, period.from, period.to, types)
    return (filter ? list.filter(filter) : list).sort(byNewest)
  }, [state, period, types, filter])
  const shown = all.slice(0, 8)
  return (
    <Card className={cn("min-w-0", className)}>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription className="tabular-nums">
          {all.length === 0
            ? "Nothing logged in this range"
            : all.length > shown.length
              ? `Latest ${shown.length} of ${all.length}`
              : `${plural(all.length, "entry", "entries")} in this range`}
        </CardDescription>
        {logType && (
          <CardAction>
            <Button variant="outline" size="sm" onClick={() => logEntry(logType, logOverrides)}>
              <PlusIcon data-icon="inline-start" />
              {logLabel}
            </Button>
          </CardAction>
        )}
      </CardHeader>
      {shown.length > 0 && (
        <CardContent className="flex min-w-0 flex-col px-2">
          {shown.map((entry) => (
            <EntryRow key={entry.id} entry={entry} state={state} onOpen={openEntry} showDate />
          ))}
        </CardContent>
      )}
    </Card>
  )
}

// Days that met a daily goal (or stayed under a limit). Pass a day-bucketed series.
export function GoalDaysCard({ series, title, noGoalText }) {
  const result = daysAtGoal(series)
  const target = series.goal ? formatValue(series.goal, series.unit) : null
  const description = !result
    ? noGoalText
    : series.lowerIsBetter
      ? `Logged days at or under ${target}`
      : `Logged days at or above ${target}`
  return (
    <Card className="min-w-0">
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      {result && (
        <CardContent className="flex flex-col gap-3">
          {result.logged === 0 ? (
            <MutedNote>No days logged in this range.</MutedNote>
          ) : (
            <>
              <p className="flex items-baseline gap-2">
                <span className="font-heading text-3xl font-semibold tabular-nums tracking-tight">{result.hit}</span>
                <span className="text-sm text-muted-foreground tabular-nums">of {plural(result.logged, "logged day")}</span>
              </p>
              <Progress
                value={(result.hit / result.logged) * 100}
                aria-label={`${title}: ${result.hit} of ${result.logged}`}
                className="h-2 [&>[data-slot=progress-indicator]]:bg-chart-1"
              />
            </>
          )}
        </CardContent>
      )}
    </Card>
  )
}
