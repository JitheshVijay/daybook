import { cn } from "@/lib/utils"

export function Stat({ label, value, hint, trend, className }) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-1 rounded-xl border bg-card p-4", className)}>
      <span className="truncate text-xs text-muted-foreground">{label}</span>
      <span className="truncate font-heading text-xl font-semibold tabular-nums tracking-tight">{value}</span>
      {(hint || trend) && (
        <span className="truncate text-xs text-muted-foreground">
          {trend && <span className={cn("mr-1 font-medium", trend.tone === "good" ? "text-emerald-600 dark:text-emerald-400" : trend.tone === "bad" ? "text-rose-600 dark:text-rose-400" : "text-foreground")}>{trend.text}</span>}
          {hint}
        </span>
      )}
    </div>
  )
}
