import { useId, useMemo, useState } from "react"
import { CartesianGrid, Line, LineChart, ReferenceLine, XAxis, YAxis } from "recharts"
import { CheckIcon, GuitarIcon, PencilIcon, PlusIcon } from "lucide-react"
import { duration } from "@/domain"
import { daysAgo, dueLabel, practicePlan, ratingLabel, retentionForecast, TARGET_RETENTION } from "@/practice"
import { useApp } from "@/components/app/app-context"
import { SongCover } from "@/components/entry/library-forms"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardAction, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart"
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select"
import { Progress } from "@/components/ui/progress"
import { formatDay } from "@/lib/format"
import { cn } from "@/lib/utils"
import { MutedNote } from "./insight-cards"

const TARGET = Math.round(TARGET_RETENTION * 100)
const pct = (value) => `${Math.round(value * 100)}%`

export function usePracticePlan() {
  const { state, today } = useApp()
  return useMemo(() => practicePlan(state, today), [state, today])
}

function SongName({ song, title, artist }) {
  return (
    <p className="flex min-w-0 flex-wrap items-baseline gap-x-2">
      <span className="truncate font-medium">{song?.title || title}</span>
      <span className="truncate text-sm text-muted-foreground">{song?.artist || artist || "Your arrangement"}</span>
    </p>
  )
}

export function practiceSummary(plan) {
  const open = plan.items.filter((item) => !item.done && !item.optional)
  const songs = (n) => `${n} ${n === 1 ? "song" : "songs"}`
  if (plan.goalMet) return `Goal met: ${plan.doneMinutes} of ${plan.goalMinutes} min today.${plan.items.some((i) => i.optional) ? " The rest is optional." : ""}`
  if (plan.doneMinutes > 0)
    return open.length
      ? `${plan.doneMinutes} of ${plan.goalMinutes} min done. ${plan.remainingMinutes} min left across ${songs(open.length)}.`
      : `${plan.doneMinutes} of ${plan.goalMinutes} min done. ${plan.remainingMinutes} min left on any song.`
  return `${plan.remainingMinutes} min across ${songs(open.length)}. Rotate between them.`
}

export function practicedLabel(item) {
  const parts = [`Practiced today${item.sections?.length ? `: ${item.sections.join(", ")}` : ""}`]
  if (item.ratingToday) parts.push(ratingLabel(item.ratingToday))
  return parts.join(" · ")
}

export function PracticeTodayCard({ plan }) {
  const { state, logEntry, openSong } = useApp()
  const next = plan.upcoming[0]
  return (
    <Card className="min-w-0 lg:col-span-2" data-testid="practice-today">
      <CardHeader>
        <CardTitle>Practice today</CardTitle>
        <CardDescription className="tabular-nums">
          {plan.items.length ? practiceSummary(plan) : state.songs.length ? "Nothing is due for review" : "No songs yet"}
        </CardDescription>
        <CardAction>
          <Button variant="outline" size="sm" onClick={() => openSong()}>
            <PlusIcon data-icon="inline-start" />
            Add song
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent className="flex min-w-0 flex-col gap-3">
        {plan.items.length > 0 && plan.doneMinutes > 0 && (
          <Progress
            value={Math.min(100, Math.round((plan.doneMinutes / plan.goalMinutes) * 100))}
            aria-label={`${plan.doneMinutes} of ${plan.goalMinutes} minutes practiced today`}
            data-testid="practice-progress"
          />
        )}
        {plan.items.length ? (
          <ol className="flex min-w-0 flex-col gap-2">
            {plan.items.map((item) => {
              const song = state.songs.find((s) => s.id === item.songId)
              return (
                <li
                  key={item.songId}
                  data-state={item.done ? "done" : item.optional ? "optional" : "open"}
                  className={cn("flex min-w-0 flex-wrap items-center gap-3 rounded-lg border p-3", item.done && "bg-muted/40")}
                >
                  <SongCover song={song || item} />
                  <div className="flex min-w-0 flex-1 basis-48 flex-col gap-0.5">
                    <SongName song={song} title={item.title} artist={item.artist} />
                    <p className="text-sm text-muted-foreground">{item.done ? practicedLabel(item) : item.reason}</p>
                  </div>
                  <div className="ml-auto flex shrink-0 items-center gap-2">
                    {item.done ? (
                      <Badge variant="secondary" className="tabular-nums">
                        <CheckIcon data-icon="inline-start" />
                        {item.minutesDone} min done
                      </Badge>
                    ) : (
                      <>
                        <Badge variant={item.optional ? "outline" : "secondary"} className="tabular-nums">
                          {item.optional ? "Optional" : `${item.minutes} min`}
                        </Badge>
                        <Button variant="outline" size="sm" onClick={() => logEntry("guitar", { songId: item.songId, minutes: item.minutes || 10 })}>
                          <PlusIcon data-icon="inline-start" />
                          Log
                        </Button>
                      </>
                    )}
                  </div>
                </li>
              )
            })}
          </ol>
        ) : state.songs.length ? (
          <MutedNote className="py-4">
            {next ? `Next review: ${next.title}, ${next.daysUntilDue === 1 ? "tomorrow" : `in ${next.daysUntilDue} days`}. Extra practice today is fine, but spacing it out builds longer-lasting memory.` : "Every song on your list is ready for performance."}
          </MutedNote>
        ) : (
          <Empty className="border">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <GuitarIcon />
              </EmptyMedia>
              <EmptyTitle>What do you want to play?</EmptyTitle>
              <EmptyDescription>Tell Daybook “I want to practice John Mayer’s Neon”, or add a song here.</EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
              <Button size="sm" onClick={() => openSong()}>
                <PlusIcon data-icon="inline-start" />
                Add song
              </Button>
            </EmptyContent>
          </Empty>
        )}
      </CardContent>
      <CardFooter className="text-xs leading-relaxed text-muted-foreground">
        <p>
          Each rated session updates a memory model (FSRS-5 spaced repetition). A song comes back when its estimated retention falls to {TARGET}%, when a
          review strengthens memory most. The model starts from parameters fitted to flashcard studies, so review dates get sharper as you rate sessions.
        </p>
      </CardFooter>
    </Card>
  )
}

export function RetentionCard({ plan }) {
  const { today } = useApp()
  const selectId = useId()
  const tracked = useMemo(() => plan.stats.filter((r) => r.stability).sort((a, b) => a.retention - b.retention), [plan])
  const [songId, setSongId] = useState("")
  const row = tracked.find((r) => r.song.id === songId) || tracked[0]
  const points = useMemo(() => retentionForecast(row, today, 30).map((p) => ({ ...p, label: formatDay(p.date, { day: "numeric", month: "short" }) })), [row, today])
  return (
    <Card className="min-w-0" data-testid="retention-card">
      <CardHeader>
        <CardTitle>Retention forecast</CardTitle>
        <CardDescription>Estimated chance you can still play it well</CardDescription>
        {tracked.length > 1 && (
          <CardAction>
            <label htmlFor={selectId} className="sr-only">
              Song
            </label>
            <NativeSelect id={selectId} size="sm" value={row.song.id} onChange={(e) => setSongId(e.target.value)} className="max-w-40">
              {tracked.map((r) => (
                <NativeSelectOption key={r.song.id} value={r.song.id}>
                  {r.song.title}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </CardAction>
        )}
      </CardHeader>
      <CardContent className="flex min-w-0 flex-col gap-4">
        {row ? (
          <>
            <dl className="grid grid-cols-2 gap-3 text-sm @container sm:grid-cols-4">
              {[
                ["Retention now", pct(row.retention)],
                ["Memory strength", `${row.stability < 10 ? row.stability.toFixed(1) : Math.round(row.stability)} days`],
                ["Difficulty", `${row.difficulty.toFixed(1)} / 10`],
                ["Next review", dueLabel(row)],
              ].map(([label, value]) => (
                <div key={label} className="flex min-w-0 flex-col gap-0.5">
                  <dt className="truncate text-xs text-muted-foreground">{label}</dt>
                  <dd className="truncate font-medium tabular-nums">{value}</dd>
                </div>
              ))}
            </dl>
            <figure className="min-w-0">
              <figcaption className="sr-only">{`Estimated retention for ${row.song.title} over the next 30 days`}</figcaption>
              <ChartContainer config={{ value: { label: "Retention", color: "var(--chart-1)" } }} className="aspect-auto h-44 w-full">
                <LineChart data={points} margin={{ top: 12, right: 8, left: 0, bottom: 0 }} accessibilityLayer>
                  <CartesianGrid vertical={false} />
                  <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} interval={6} />
                  <YAxis domain={[0, 100]} ticks={[0, 50, TARGET, 100]} tickLine={false} axisLine={false} width={48} tickFormatter={(v) => `${v}%`} />
                  <ReferenceLine y={TARGET} stroke="var(--muted-foreground)" strokeDasharray="4 4" label={{ value: `Review at ${TARGET}%`, position: "insideBottomRight", fontSize: 11, fill: "var(--muted-foreground)" }} />
                  <ChartTooltip
                    content={
                      <ChartTooltipContent
                        labelFormatter={(_, payload) => (payload?.[0]?.payload?.date ? formatDay(payload[0].payload.date) : "")}
                        formatter={(value) => (
                          <div className="flex w-full items-center justify-between gap-3">
                            <span className="text-muted-foreground">Retention</span>
                            <span className="font-mono font-medium tabular-nums text-foreground">{value}%</span>
                          </div>
                        )}
                      />
                    }
                  />
                  <Line dataKey="value" type="monotone" stroke="var(--color-value)" strokeWidth={2} dot={false} isAnimationActive={false} />
                </LineChart>
              </ChartContainer>
            </figure>
            <p className="text-xs text-muted-foreground">
              {row.rated < row.sessions
                ? `${row.sessions - row.rated} of ${row.sessions} sessions weren't rated and count as Solid.`
                : `Based on ${row.sessions} rated ${row.sessions === 1 ? "session" : "sessions"}.`}
            </p>
          </>
        ) : (
          <MutedNote>Log a practice session for a song to see how well it sticks.</MutedNote>
        )}
      </CardContent>
    </Card>
  )
}

const ORDER = { due: 0, new: 1, scheduled: 2 }

export function PracticeListCard({ plan }) {
  const { today, logEntry, openSong } = useApp()
  const rows = useMemo(
    () =>
      plan.stats
        .slice()
        .sort((a, b) => ORDER[a.state] - ORDER[b.state] || (a.retention ?? 1) - (b.retention ?? 1) || (a.daysUntilDue ?? 0) - (b.daysUntilDue ?? 0) || a.index - b.index),
    [plan],
  )
  return (
    <Card className="min-w-0 lg:col-span-2" data-testid="practice-list">
      <CardHeader>
        <CardTitle>Practice list</CardTitle>
        <CardDescription className="tabular-nums">{rows.length ? `${rows.length} ${rows.length === 1 ? "song" : "songs"}, most at risk first` : "No songs yet"}</CardDescription>
        <CardAction>
          <Button variant="outline" size="sm" onClick={() => openSong()}>
            <PlusIcon data-icon="inline-start" />
            Add song
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent className="@container/grid min-w-0">
        {rows.length ? (
          <ul className="grid min-w-0 items-start gap-3 @2xl/grid:grid-cols-2">
            {rows.map((row) => (
              <li key={row.song.id} className="flex min-w-0 flex-col gap-3 rounded-lg border p-3">
                <div className="flex min-w-0 items-start gap-3">
                  <SongCover song={row.song} className="size-14" />
                  <div className="flex min-w-0 flex-1 flex-col gap-1">
                    <SongName song={row.song} />
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Badge variant={row.song.status === "Performance ready" ? "secondary" : "outline"}>{row.song.status}</Badge>
                      <Badge variant={row.state === "due" ? "default" : "outline"} className="tabular-nums">
                        {dueLabel(row)}
                      </Badge>
                    </div>
                  </div>
                  <Button variant="ghost" size="icon-sm" aria-label={`Edit ${row.song.title}`} onClick={() => openSong(row.song)}>
                    <PencilIcon />
                  </Button>
                </div>
                {row.retention !== null ? (
                  <div className="flex min-w-0 flex-col gap-1.5">
                    <div className="flex items-baseline justify-between gap-2 text-xs text-muted-foreground tabular-nums">
                      <span>Estimated retention</span>
                      <span className={cn("font-medium", row.retention < TARGET_RETENTION ? "text-foreground" : "text-muted-foreground")}>{pct(row.retention)}</span>
                    </div>
                    <Progress value={row.retention * 100} aria-label={`${row.song.title} estimated retention`} className="h-1.5 [&>[data-slot=progress-indicator]]:bg-chart-1" />
                  </div>
                ) : null}
                <p className="flex min-w-0 flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground tabular-nums">
                  <span>{row.sessions ? `${row.sessions} ${row.sessions === 1 ? "session" : "sessions"} · ${duration(row.minutes)}` : "Not practiced yet"}</span>
                  {row.lastDate && <span>Last played {daysAgo(row.lastDate, today)}</span>}
                  {row.lastRating && <span>Last: {ratingLabel(row.lastRating)}</span>}
                </p>
                <Button variant="outline" size="sm" className="self-start" onClick={() => logEntry("guitar", { songId: row.song.id })}>
                  <PlusIcon data-icon="inline-start" />
                  Log practice
                </Button>
              </li>
            ))}
          </ul>
        ) : (
          <MutedNote>Songs you add or practice show up here with their review schedule.</MutedNote>
        )}
      </CardContent>
    </Card>
  )
}
