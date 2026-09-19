import { duration, fmtDate, parseDate, pretty } from "@/domain"

export const formatNumber = (value, digits = 1) =>
  value === null || value === undefined
    ? "—"
    : new Intl.NumberFormat("en-GB", { maximumFractionDigits: digits }).format(value)

// Format a metric value with its unit for tiles and tooltips.
export function formatValue(value, unit) {
  if (value === null || value === undefined) return "—"
  if (unit === "min") return duration(Math.round(value))
  if (unit === "/ 5") return `${formatNumber(value, 1)} / 5`
  if (!unit) return formatNumber(value)
  return `${formatNumber(value)} ${unit}`
}

export const formatDay = (key, opts = { weekday: "short", day: "numeric", month: "short" }) =>
  fmtDate(key, opts)

export const formatRange = (from, to) => {
  if (from === to) return fmtDate(from, { weekday: "short", day: "numeric", month: "short" })
  const sameYear = from.slice(0, 4) === to.slice(0, 4)
  return `${fmtDate(from, { day: "numeric", month: "short", ...(sameYear ? {} : { year: "numeric" }) })} – ${fmtDate(to, { day: "numeric", month: "short", year: "numeric" })}`
}

export const formatChange = (change) =>
  change === null || change === undefined
    ? null
    : `${change > 0 ? "+" : ""}${formatNumber(change * 100, 0)}%`

export const isToday = (key, today) => key === today

export { duration, pretty, parseDate }
