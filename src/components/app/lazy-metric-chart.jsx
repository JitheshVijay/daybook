import * as React from "react"
import { Skeleton } from "@/components/ui/skeleton"

const MetricChart = React.lazy(() => import("./metric-chart").then((m) => ({ default: m.MetricChart })))

// Charting code (Recharts) loads the first time a chart is shown.
export function LazyMetricChart({ height = 220, ...props }) {
  return (
    <React.Suspense fallback={<Skeleton className="w-full rounded-lg" style={{ height }} />}>
      <MetricChart height={height} {...props} />
    </React.Suspense>
  )
}
