import { useMemo } from "react"
import { InfoIcon, PlusIcon } from "lucide-react"
import { caloriesByMeal, estimatedItems } from "@/insights"
import { useApp } from "@/components/app/app-context"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { ChartCard, KpiRow, MainChartCard, RecentEntriesCard, useSeries } from "./insight-cards"

const FOOD_TYPES = ["food"]

export function NutritionTab({ opts, period }) {
  const { state } = useApp()
  const meals = useMemo(() => caloriesByMeal(state, period), [state, period])
  const byMeal = meals.series.length > 0
  // Meal points are daily, so keep calories daily too when stacking by meal.
  const calories = useSeries("calories", opts, byMeal ? { groupBy: "day" } : {})
  const macros = useSeries("macros", opts)
  const protein = useSeries("protein", opts)
  const estimates = useMemo(() => estimatedItems(state, period), [state, period])
  const main = byMeal ? { ...calories, points: meals.points, series: meals.series } : calories

  return (
    <>
      <KpiRow series={calories} />
      <MainChartCard
        series={main}
        title={byMeal ? "Calories by meal" : "Calories"}
        height={byMeal ? 260 : 240}
        logType="food"
        logLabel="Log food"
        footer={
          estimates.total > 0 && (
            <span className="flex min-w-0 items-center gap-2 tabular-nums">
              <InfoIcon className="size-3.5 shrink-0" aria-hidden="true" />
              {estimates.estimated} of {estimates.total} food {estimates.total === 1 ? "item" : "items"}{" "}
              {estimates.estimated === 1 ? "is an estimate" : "are estimates"}
            </span>
          )
        }
      />
      <div className="grid items-start gap-4 lg:grid-cols-2">
        <ChartCard series={macros} height={240} description={`Protein, carbs, and fat per ${macros.bucket}`} />
        <ChartCard series={protein} />
        {state.favorites?.length > 0 && <UsualsCard />}
        <RecentEntriesCard types={FOOD_TYPES} period={period} logType="food" logLabel="Log food" />
      </div>
    </>
  )
}

function UsualsCard() {
  const { state, logEntry } = useApp()
  return (
    <Card className="min-w-0">
      <CardHeader>
        <CardTitle>Your usuals</CardTitle>
        <CardDescription>Log a saved meal in one tap</CardDescription>
      </CardHeader>
      <CardContent className="flex min-w-0 flex-wrap gap-2">
        {state.favorites.map((favorite) => (
          <Button
            key={favorite.id}
            variant="outline"
            size="sm"
            className="max-w-full"
            onClick={() => logEntry("food", { title: favorite.title, items: structuredClone(favorite.items) })}
          >
            <PlusIcon data-icon="inline-start" />
            <span className="truncate">{favorite.title}</span>
          </Button>
        ))}
      </CardContent>
    </Card>
  )
}
