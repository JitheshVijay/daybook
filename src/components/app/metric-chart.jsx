import { Bar, BarChart, CartesianGrid, Line, LineChart, ReferenceLine, XAxis, YAxis } from "recharts"
import { ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart"
import { formatDay, formatValue } from "@/lib/format"
import { cn } from "@/lib/utils"

/**
 * Renders a computeSeries() result from src/insights.js.
 * type: "bar" | "line" (stacked automatically when the series has several keys).
 * Days without entries are null: no bar, a gap in the line, and "No entries" in the tooltip.
 */
export function MetricChart({ series, type = "bar", height = 220, compact = false, className, title }) {
  const config = Object.fromEntries(series.series.map((s) => [s.key, { label: s.label, color: s.color }]))
  const multi = series.series.length > 1
  const points = series.points
  const hasData = points.some((p) => series.series.some((s) => p[s.key] !== null && p[s.key] !== undefined))
  const tickInterval = points.length > 14 ? Math.ceil(points.length / 7) - 1 : 0
  const unit = series.unit

  const tooltip = (
    <ChartTooltip
      cursor={type === "bar" ? { fill: "var(--muted)", opacity: 0.6 } : true}
      content={
        <ChartTooltipContent
          labelFormatter={(_, payload) => {
            const date = payload?.[0]?.payload?.date
            if (!date) return ""
            return series.bucket === "week" ? `Week of ${formatDay(date, { day: "numeric", month: "short" })}` : formatDay(date)
          }}
          formatter={(value, name) => (
            <div className="flex w-full items-center justify-between gap-3">
              <span className="text-muted-foreground">{config[name]?.label ?? name}</span>
              <span className="font-mono font-medium tabular-nums text-foreground">
                {value === null || value === undefined ? "No entries" : formatValue(value, unit)}
              </span>
            </div>
          )}
        />
      }
    />
  )

  const axis = (
    <XAxis
      dataKey="label"
      tickLine={false}
      axisLine={false}
      tickMargin={8}
      interval={tickInterval}
      minTickGap={8}
    />
  )
  const yAxis = compact ? null : (
    <YAxis tickLine={false} axisLine={false} width={44} tickMargin={4} allowDecimals={series.kind === "mean"} tickFormatter={(v) => new Intl.NumberFormat("en-GB", { notation: "compact" }).format(v)} />
  )
  const goal = series.goal ? (
    <ReferenceLine
      y={series.goal}
      stroke="var(--muted-foreground)"
      strokeDasharray="4 4"
      strokeWidth={1}
      ifOverflow="extendDomain"
      label={compact ? undefined : { value: `Goal ${formatValue(series.goal, unit)}`, position: "insideTopRight", fontSize: 11, fill: "var(--muted-foreground)" }}
    />
  ) : null

  return (
    <figure className={cn("w-full", className)}>
      {title && <figcaption className="sr-only">{title}</figcaption>}
      <ChartContainer config={config} className="aspect-auto w-full" style={{ height }}>
        {type === "line" && !multi ? (
          <LineChart data={points} margin={{ top: 12, right: 8, left: compact ? 8 : 0, bottom: 0 }} accessibilityLayer>
            <CartesianGrid vertical={false} />
            {axis}
            {yAxis}
            {tooltip}
            {goal}
            <Line dataKey="value" type="monotone" stroke="var(--color-value)" strokeWidth={2} dot={{ r: 3 }} activeDot={{ r: 5 }} connectNulls={false} isAnimationActive={false} />
          </LineChart>
        ) : (
          <BarChart data={points} margin={{ top: 12, right: 8, left: compact ? 8 : 0, bottom: 0 }} accessibilityLayer>
            <CartesianGrid vertical={false} />
            {axis}
            {yAxis}
            {tooltip}
            {goal}
            {multi && <ChartLegend content={<ChartLegendContent />} itemSorter={null} />}
            {series.series.map((s, index) => (
              <Bar
                key={s.key}
                dataKey={s.key}
                stackId={multi ? "stack" : undefined}
                fill={`var(--color-${s.key})`}
                radius={multi ? (index === series.series.length - 1 ? [4, 4, 0, 0] : 0) : [4, 4, 0, 0]}
                maxBarSize={48}
                isAnimationActive={false}
              />
            ))}
          </BarChart>
        )}
      </ChartContainer>
      {!hasData && (
        <p className="-mt-2 text-center text-xs text-muted-foreground">No entries in this range yet.</p>
      )}
      <table className="sr-only">
        <caption>{title || series.label}</caption>
        <thead>
          <tr>
            <th scope="col">Date</th>
            {series.series.map((s) => (
              <th key={s.key} scope="col">{s.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {points.map((p) => (
            <tr key={p.date}>
              <th scope="row">{p.date}</th>
              {series.series.map((s) => (
                <td key={s.key}>{p[s.key] === null ? "No entries" : formatValue(p[s.key], unit)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  )
}
