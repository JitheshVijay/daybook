import * as React from "react"
import { ArrowUpRightIcon, CircleAlertIcon, PencilIcon, RotateCcwIcon, Undo2Icon, XIcon } from "lucide-react"
import { LABELS } from "@/domain"
import { computeSeries, RANGE_LABELS, tabForMetric } from "@/insights"
import { TypeIcon } from "@/lib/entry-meta"
import { formatRange } from "@/lib/format"
import { useApp } from "@/components/app/app-context"
import { LazyMetricChart as MetricChart } from "@/components/app/lazy-metric-chart"
import { BookCover, SongCover } from "@/components/entry/library-forms"
import { practicePlan } from "@/practice"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemMedia, ItemTitle } from "@/components/ui/item"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"

const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`

function cardTitle(card) {
  if (card.mode === "updated") return "Updated entry"
  if (card.mode === "songs") return `Added ${plural(card.songs?.length || 0, "song")} to your practice list`
  if (card.mode === "books") return `Added ${plural(card.books?.length || 0, "book")} to your reading list`
  if (card.mode === "book") return "Updated book"
  if (card.mode === "habits") return `Now tracking ${plural(card.habits?.length || 0, "habit")}`
  if (card.mode === "deleted") return `Deleted ${plural(card.removed?.length || 0, "entry").replace("entrys", "entries")}`
  const saved = card.entries.length
  const waiting = card.pendingIds?.length || 0
  const activities = (n) => `${n} ${n === 1 ? "activity" : "activities"}`
  if (saved && waiting) return `Logged ${activities(saved)} · ${waiting} ${waiting === 1 ? "needs" : "need"} details`
  if (saved) return `Logged ${activities(saved)}`
  return `${activities(waiting)} ${waiting === 1 ? "needs" : "need"} details`
}

// The days the card's entries were saved on (a chat card can log to another day than its message).
function cardDates(card) {
  const rows = card.mode === "deleted" ? card.removed || [] : card.entries || []
  const dates = [...new Set(rows.map((r) => r.date).filter(Boolean))].sort()
  if (!dates.length) return formatRange(card.date, card.date)
  if (dates.length === 1) return formatRange(dates[0], dates[0])
  return dates.map((d) => formatRange(d, d)).join(" · ")
}

export function LoggedCard({ card, pending, onUndo, onDismiss, onFillIn, questionShown = false }) {
  const { state, openEntry } = useApp()
  const rows = card.mode === "deleted" ? card.removed || [] : card.entries
  const songs = card.mode === "songs" ? card.songs || [] : []
  const books = card.mode === "books" || card.mode === "book" ? card.books || [] : []
  const habits = card.mode === "habits" ? card.habits || [] : []
  const pendingItems = (card.pendingIds || []).map((id) => pending.find((p) => p.id === id)).filter(Boolean)
  return (
    <Card size="sm" className={card.undone ? "opacity-60" : undefined} data-testid="logged-card">
      <CardHeader>
        <CardTitle className="text-sm">{cardTitle(card)}</CardTitle>
        <CardDescription className="tabular-nums">{cardDates(card)}</CardDescription>
        <CardAction>
          {card.undone ? (
            <Badge variant="outline">Undone</Badge>
          ) : (
            (rows.length > 0 || card.mode) && (
              <Button variant="ghost" size="sm" onClick={() => onUndo(card.batchId)}>
                <Undo2Icon data-icon="inline-start" />
                Undo
              </Button>
            )
          )}
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {rows.length > 0 && (
          <ItemGroup className="gap-1">
            {rows.map((row) => {
              const live = state.entries.find((e) => e.id === row.id)
              const clickable = live && !card.undone && card.mode !== "deleted"
              return (
                <Item key={row.id} variant="muted" size="xs" asChild={clickable}>
                  {clickable ? (
                    <button type="button" className="w-full text-left" onClick={() => openEntry(live)}>
                      <RowBody row={row} />
                    </button>
                  ) : (
                    <div className={card.mode === "deleted" ? "line-through decoration-muted-foreground/60" : undefined}>
                      <RowBody row={row} />
                    </div>
                  )}
                </Item>
              )
            })}
          </ItemGroup>
        )}
        {songs.length > 0 && (
          <ItemGroup className="gap-1">
            {songs.map((saved) => {
              const song = state.songs.find((s) => s.id === saved.id) || saved
              return (
                <Item key={saved.id} variant="muted" size="xs">
                  <ItemMedia>
                    <SongCover song={song} className="size-10" />
                  </ItemMedia>
                  <ItemContent className="min-w-0">
                    <ItemTitle className="w-full truncate">{song.title}</ItemTitle>
                    <ItemDescription className="truncate">{song.artist || "Artist not added"}</ItemDescription>
                  </ItemContent>
                  <ItemActions>
                    <Badge variant="outline">{song.status}</Badge>
                  </ItemActions>
                </Item>
              )
            })}
          </ItemGroup>
        )}
        {habits.length > 0 && (
          <ItemGroup className="gap-1">
            {habits.map((habit) => (
              <Item key={habit.id} variant="muted" size="xs">
                <ItemMedia variant="icon">
                  <TypeIcon type="habit" />
                </ItemMedia>
                <ItemContent className="min-w-0">
                  <ItemTitle className="w-full truncate">{habit.name}</ItemTitle>
                  <ItemDescription className="truncate">
                    {habit.unit === "times" && habit.goal === 1 ? "Yes or no, once a day" : `${habit.goal ? `Goal ${habit.goal} ` : ""}${habit.unit}`}
                  </ItemDescription>
                </ItemContent>
              </Item>
            ))}
          </ItemGroup>
        )}
        {books.length > 0 && (
          <ItemGroup className="gap-1">
            {books.map((saved) => {
              const book = state.books.find((b) => b.id === saved.id) || saved
              return (
                <Item key={saved.id} variant="muted" size="xs">
                  <ItemMedia>
                    <BookCover book={book} className="h-12 w-8" />
                  </ItemMedia>
                  <ItemContent className="min-w-0">
                    <ItemTitle className="w-full truncate">{book.title}</ItemTitle>
                    <ItemDescription className="truncate">{book.author || "Author not added"}</ItemDescription>
                  </ItemContent>
                  <ItemActions>
                    <Badge variant="outline">{book.status}</Badge>
                  </ItemActions>
                </Item>
              )
            })}
          </ItemGroup>
        )}
        {(card.mode === "updated" || card.mode === "book") && card.changes?.length > 0 && (
          <ul className="flex flex-col gap-0.5 text-xs text-muted-foreground tabular-nums">
            {card.changes.map((change) => (
              <li key={change}>{change}</li>
            ))}
          </ul>
        )}
        {!card.undone && pendingItems.length > 0 && (
          <div className="flex flex-col gap-1 rounded-lg border border-dashed p-2" data-testid="needs-details">
            <p className="px-1 text-xs font-medium text-muted-foreground">
              {questionShown ? "Waiting on your answer below" : "Reply in the chat with these details"}
            </p>
            {pendingItems.map((item) => {
              const title = pendingItemTitle(item)
              return (
                <Item key={item.id} size="xs" className="items-start">
                  <ItemMedia variant="icon">
                    <TypeIcon type={item.type} />
                  </ItemMedia>
                  <ItemContent className="min-w-0">
                    <ItemTitle className="w-full truncate">{title}</ItemTitle>
                    <ul className="flex flex-col gap-0.5 text-xs text-muted-foreground">
                      {item.questions.map((question) => (
                        <li key={question}>{question}</li>
                      ))}
                    </ul>
                  </ItemContent>
                  <ItemActions className="gap-0.5">
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button variant="ghost" size="icon-xs" aria-label={`Fill in ${title} manually`} onClick={() => onFillIn(item)}>
                          <PencilIcon />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>Fill in manually</TooltipContent>
                    </Tooltip>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button variant="ghost" size="icon-xs" aria-label={`Skip ${title}`} onClick={() => onDismiss(item.id)}>
                          <XIcon />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>Skip it</TooltipContent>
                    </Tooltip>
                  </ItemActions>
                </Item>
              )
            })}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function pendingItemTitle(item) {
  const name = item.known?.bookTitle || item.known?.songTitle || item.known?.habitName || item.known?.title || LABELS[item.type]
  if (!item.attachTo) return name
  const parts = item.known?.exercises || item.known?.items || []
  const noun = item.type === "workout" ? (parts.length === 1 ? "exercise" : "exercises") : parts.length === 1 ? "food" : "foods"
  return `${name} · ${parts.length} more ${noun}`
}

function RowBody({ row }) {
  return (
    <>
      <ItemMedia variant="icon">
        <TypeIcon type={row.type} />
      </ItemMedia>
      <ItemContent className="min-w-0">
        <ItemTitle className="w-full truncate">{row.title}</ItemTitle>
        <ItemDescription className="truncate tabular-nums">{row.detail}</ItemDescription>
      </ItemContent>
      <ItemActions className="text-xs text-muted-foreground tabular-nums">
        {row.estimated && <Badge variant="secondary">Estimated</Badge>}
        {row.status === "planned" ? <Badge variant="outline">Planned</Badge> : row.time}
      </ItemActions>
    </>
  )
}

export function QuestionCard({ card, active, onAnswer }) {
  return (
    <div className="flex flex-col gap-2" data-testid="question-card">
      <p className="text-sm leading-relaxed">{card.question}</p>
      {card.options?.length > 0 && (
        <div className="flex flex-wrap gap-2" role="group" aria-label="Suggested answers">
          {card.options.map((option) => (
            <Button key={option} variant="outline" size="sm" className="rounded-full" disabled={!active} onClick={() => onAnswer(option)}>
              {option}
            </Button>
          ))}
        </div>
      )}
    </div>
  )
}

export function ChartCard({ card }) {
  const { state, today, navigate } = useApp()
  const spec = card.spec
  let series = null
  let problem = ""
  try {
    series = computeSeries(state, spec.metric, { range: spec.range, from: spec.from, to: spec.to, habitId: spec.habitId, groupBy: spec.groupBy }, today)
  } catch (error) {
    problem = error.message
  }
  return (
    <Card size="sm" data-testid="chart-card">
      <CardHeader>
        <CardTitle className="text-sm">{series?.label || card.title}</CardTitle>
        <CardDescription className="tabular-nums">
          {RANGE_LABELS[spec.range]}
          {series ? ` · ${formatRange(series.from, series.to)}` : ""}
        </CardDescription>
        <CardAction>
          <Button variant="ghost" size="sm" onClick={() => navigate("insights", { tab: tabForMetric(spec.metric), range: ["last_7_days", "last_30_days", "last_90_days"].includes(spec.range) ? spec.range : "last_30_days" })}>
            Insights
            <ArrowUpRightIcon data-icon="inline-end" />
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent>
        {series ? (
          <MetricChart series={series} type={spec.chart === "line" ? "line" : "bar"} height={180} compact title={`${series.label}, ${formatRange(series.from, series.to)}`} />
        ) : (
          <p className="text-sm text-muted-foreground">This chart is no longer available: {problem}</p>
        )}
      </CardContent>
    </Card>
  )
}

// Today's practice recommendation as it was given, with live titles and album art.
export function PracticeCard({ card }) {
  const { state, today, navigate, logEntry } = useApp()
  const live = card.date === today ? practicePlan(state, today) : null
  const items = card.items || []
  const planMinutes = items.reduce((t, i) => t + (i.minutes || 0), 0)
  const summary = !items.length
    ? "Nothing due for review"
    : live && live.doneMinutes > 0
      ? live.goalMet
        ? `Goal met: ${live.doneMinutes} of ${live.goalMinutes} min today`
        : `${live.doneMinutes} of ${live.goalMinutes} min done · ${live.remainingMinutes} min left`
      : `${planMinutes} min across ${plural(items.length, "song")}`
  return (
    <Card size="sm" data-testid="practice-card">
      <CardHeader>
        <CardTitle className="text-sm">Practice {card.date === today ? "today" : `plan for ${formatRange(card.date, card.date)}`}</CardTitle>
        <CardDescription className="tabular-nums">{summary}</CardDescription>
        <CardAction>
          <Button variant="ghost" size="sm" onClick={() => navigate("insights", { tab: "guitar" })}>
            Guitar
            <ArrowUpRightIcon data-icon="inline-end" />
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent>
        {items.length ? (
          <ItemGroup className="gap-1">
            {items.map((item) => {
              const song = state.songs.find((s) => s.id === item.songId)
              const done = Boolean(live?.items.some((i) => i.songId === item.songId && i.done))
              return (
                <Item key={item.songId} variant="muted" size="xs" className="items-start">
                  <ItemMedia>
                    <SongCover song={song || item} className="size-10" />
                  </ItemMedia>
                  <ItemContent className="min-w-0">
                    <ItemTitle className="w-full truncate">{song?.title || item.title}</ItemTitle>
                    <ItemDescription className="line-clamp-2">{item.reason}</ItemDescription>
                  </ItemContent>
                  <ItemActions className="flex-col items-end gap-1">
                    {done ? <Badge variant="secondary">Practiced</Badge> : <Badge variant="outline" className="tabular-nums">{item.minutes} min</Badge>}
                    {!done && song && (
                      <Button variant="ghost" size="xs" onClick={() => logEntry("guitar", { songId: song.id, minutes: item.minutes })}>
                        Log
                      </Button>
                    )}
                  </ItemActions>
                </Item>
              )
            })}
          </ItemGroup>
        ) : (
          <p className="text-sm text-muted-foreground">
            {card.upcoming?.[0] ? `Next review: ${card.upcoming[0].title}, ${card.upcoming[0].daysUntilDue === 1 ? "tomorrow" : `in ${card.upcoming[0].daysUntilDue} days`}.` : "Add songs you want to practice to get a plan."}
          </p>
        )}
      </CardContent>
    </Card>
  )
}

export function ErrorCard({ message, stopped, onRetry }) {
  return (
    <Alert variant={stopped ? "default" : "destructive"} className="max-w-md">
      <CircleAlertIcon />
      <AlertTitle>{stopped ? "Stopped" : "That didn’t go through"}</AlertTitle>
      <AlertDescription>
        {!stopped && <p>{message}</p>}
        <Button variant="outline" size="sm" className="mt-2" onClick={onRetry}>
          <RotateCcwIcon data-icon="inline-start" />
          Try again
        </Button>
      </AlertDescription>
    </Alert>
  )
}
