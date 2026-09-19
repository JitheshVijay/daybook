import * as React from "react"
import { SlidersHorizontalIcon } from "lucide-react"
import { fmtDate, LABELS, shiftDate, TYPES, weekDates } from "@/domain"
import { dailyTrackers, describeDay, loggingDays, loggingSummary } from "@/logging"
import { TypeIcon } from "@/lib/entry-meta"
import { cn } from "@/lib/utils"
import { useApp } from "@/components/app/app-context"
import { Button } from "@/components/ui/button"
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { Popover, PopoverContent, PopoverDescription, PopoverHeader, PopoverTitle, PopoverTrigger } from "@/components/ui/popover"

const MIN_CELL = 12
const MAX_CELL = 18
const GAP = 3
const LABEL = 30
const ROW_LABELS = ["Mon", "", "Wed", "", "Fri", "", ""]
const LEVEL_NAMES = ["Nothing logged", "A little logged", "Some logged", "Most logged", "Full day"]

function useWidth() {
  const ref = React.useRef(null)
  const [width, setWidth] = React.useState(0)
  React.useLayoutEffect(() => {
    const node = ref.current
    if (!node) return
    setWidth(node.clientWidth)
    if (typeof ResizeObserver === "undefined") return
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width))
    observer.observe(node)
    return () => observer.disconnect()
  }, [])
  return [ref, width]
}

export function LoggingHeatmap({ selected, onSelect }) {
  const { state, today, commit } = useApp()
  const [wrapRef, width] = useWidth()
  const gridRef = React.useRef(null)
  // As many weeks as fit (up to a year), then cells grow to fill the card.
  const available = width - LABEL - GAP
  const weeks = width ? Math.max(8, Math.min(53, Math.floor((available + GAP) / (MIN_CELL + GAP)))) : 26
  const CELL = width ? Math.max(MIN_CELL, Math.min(MAX_CELL, Math.floor((available - (weeks - 1) * GAP) / weeks))) : MIN_CELL
  const lastMonday = weekDates(today)[0]
  const firstMonday = shiftDate(lastMonday, -(weeks - 1) * 7)
  const trackers = React.useMemo(() => dailyTrackers(state, today), [state, today])
  const days = React.useMemo(() => loggingDays(state, firstMonday, today, trackers), [state, firstMonday, today, trackers])
  const byDate = React.useMemo(() => new Map(days.map((d) => [d.date, d])), [days])
  const summary = loggingSummary(days, today)
  const focusDate = byDate.has(selected) ? selected : today
  const chosenDay = byDate.get(focusDate)

  const columns = Array.from({ length: weeks }, (_, w) => {
    const monday = shiftDate(firstMonday, w * 7)
    return Array.from({ length: 7 }, (_, d) => shiftDate(monday, d))
  })
  const monthLabels = columns.map((dates, i) => {
    const first = dates.find((date) => date.endsWith("-01") || (i === 0 && date === dates[0]))
    return first && (i === 0 || !columns[i - 1].some((d) => d.slice(0, 7) === first.slice(0, 7))) ? fmtDate(first, { month: "short" }) : ""
  })

  const move = (event) => {
    const step = { ArrowLeft: -7, ArrowRight: 7, ArrowUp: -1, ArrowDown: 1 }[event.key]
    if (!step) return
    event.preventDefault()
    const next = shiftDate(focusDate, step)
    if (!byDate.has(next)) return
    onSelect(next)
    requestAnimationFrame(() => gridRef.current?.querySelector(`[data-date="${next}"]`)?.focus())
  }

  const setTrackers = (next) =>
    commit((s) => {
      const profile = { ...s.profile }
      if (next === null) delete profile.dailyTrackers
      else profile.dailyTrackers = TYPES.filter((t) => next.includes(t))
      return { ...s, profile }
    })

  return (
    <Card className="min-w-0" data-testid="logging-heatmap">
      <CardHeader>
        <CardTitle>Logging heatmap</CardTitle>
        <CardDescription>How much of each day you logged, last {weeks} weeks</CardDescription>
        <CardAction>
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm">
                <SlidersHorizontalIcon data-icon="inline-start" />
                Full day
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-64">
              <PopoverHeader>
                <PopoverTitle>A full day includes</PopoverTitle>
                <PopoverDescription>Days with all of these logged get the darkest color.</PopoverDescription>
              </PopoverHeader>
              <div className="flex flex-col gap-2" role="group" aria-label="Daily trackers">
                {TYPES.map((type) => {
                  const id = `daily-${type}`
                  const checked = trackers.includes(type)
                  return (
                    <label key={type} htmlFor={id} className="flex items-center gap-2 text-sm">
                      <Checkbox
                        id={id}
                        checked={checked}
                        disabled={checked && trackers.length === 1}
                        onCheckedChange={(value) => setTrackers(value ? [...trackers, type] : trackers.filter((t) => t !== type))}
                      />
                      <TypeIcon type={type} className="size-4 text-muted-foreground" />
                      {LABELS[type]}
                    </label>
                  )
                })}
              </div>
              {Array.isArray(state.profile.dailyTrackers) && (
                <Button variant="ghost" size="sm" className="self-start" onClick={() => setTrackers(null)}>
                  Use the trackers I log regularly
                </Button>
              )}
            </PopoverContent>
          </Popover>
        </CardAction>
      </CardHeader>
      <CardContent className="flex min-w-0 flex-col gap-4">
        <dl className="grid grid-cols-3 gap-3 text-sm">
          {[
            ["Full days", summary.fullDays],
            ["Current streak", `${summary.streak} ${summary.streak === 1 ? "day" : "days"}`],
            ["Days with entries", summary.daysWithEntries],
          ].map(([label, value]) => (
            <div key={label} className="flex min-w-0 flex-col gap-0.5">
              <dt className="truncate text-xs text-muted-foreground">{label}</dt>
              <dd className="font-heading text-lg font-semibold tabular-nums">{value}</dd>
            </div>
          ))}
        </dl>
        <div ref={wrapRef} className="min-w-0">
          <div
            ref={gridRef}
            role="grid"
            aria-label={`Logging heatmap, last ${weeks} weeks. Use arrow keys to move between days.`}
            onKeyDown={move}
            className="grid w-fit"
            style={{ gridTemplateColumns: `${LABEL}px repeat(${weeks}, ${CELL}px)`, gridTemplateRows: `14px repeat(7, ${CELL}px)`, columnGap: GAP, rowGap: GAP }}
          >
            <span aria-hidden="true" />
            {monthLabels.map((label, i) => (
              <span key={`m${i}`} aria-hidden="true" className="overflow-visible whitespace-nowrap text-[10px] leading-none text-muted-foreground">
                {label}
              </span>
            ))}
            {ROW_LABELS.map((label, row) => (
              <React.Fragment key={`r${row}`}>
                <span aria-hidden="true" className="text-[10px] leading-3 text-muted-foreground" style={{ gridColumn: 1, gridRow: row + 2 }}>
                  {label}
                </span>
                {columns.map((dates, col) => {
                  const date = dates[row]
                  const day = byDate.get(date)
                  const style = { gridColumn: col + 2, gridRow: row + 2 }
                  if (!day) return <span key={date} aria-hidden="true" style={style} />
                  const label = `${fmtDate(date, { weekday: "short", day: "numeric", month: "short" })}: ${describeDay(day)}`
                  return (
                    <button
                      key={date}
                      type="button"
                      data-date={date}
                      data-level={day.level}
                      role="gridcell"
                      aria-label={label}
                      aria-selected={date === selected}
                      title={label}
                      tabIndex={date === focusDate ? 0 : -1}
                      onClick={() => onSelect(date)}
                      className={cn(
                        "rounded-[3px] outline-none focus-visible:ring-2 focus-visible:ring-ring",
                        date === selected && "ring-2 ring-foreground ring-offset-1 ring-offset-card",
                      )}
                      style={{ ...style, width: CELL, height: CELL, backgroundColor: `var(--heat-${day.level})` }}
                    />
                  )
                })}
              </React.Fragment>
            ))}
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 text-xs text-muted-foreground">
          <p aria-live="polite" className="min-w-0">
            {chosenDay && (
              <>
                <span className="font-medium text-foreground">{fmtDate(focusDate, { weekday: "short", day: "numeric", month: "short" })}</span> · {describeDay(chosenDay)}
              </>
            )}
          </p>
          <div className="flex items-center gap-1" aria-label="Color scale: less to more logged">
            <span>Less</span>
            {LEVEL_NAMES.map((name, level) => (
              <span key={name} title={name} className="size-3 rounded-[3px]" style={{ backgroundColor: `var(--heat-${level})` }} />
            ))}
            <span>Full day</span>
          </div>
        </div>
        <p className="text-xs text-muted-foreground">A full day includes {trackers.map((t) => LABELS[t].toLowerCase()).join(", ")}.</p>
      </CardContent>
    </Card>
  )
}
