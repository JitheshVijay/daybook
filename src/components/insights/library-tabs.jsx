import { useMemo } from "react"
import { BookOpenIcon, PencilIcon, PlusIcon } from "lucide-react"
import { bookProgress, duration } from "@/domain"
import { minutesBySong } from "@/insights"
import { useApp } from "@/components/app/app-context"
import { BookCover } from "@/components/entry/library-forms"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { Progress } from "@/components/ui/progress"
import { formatNumber } from "@/lib/format"
import { BarList, ChartCard, KpiRow, MainChartCard, MutedNote, RecentEntriesCard, useSeries } from "./insight-cards"
import { PracticeListCard, PracticeTodayCard, RetentionCard, usePracticePlan } from "./guitar-practice"

const READING_TYPES = ["reading"]
const GUITAR_TYPES = ["guitar"]

// ---------- Reading ----------

export function ReadingTab({ opts, period }) {
  const pages = useSeries("pages", opts)
  const minutes = useSeries("reading", opts)
  return (
    <>
      <KpiRow series={pages} />
      <MainChartCard series={pages} logType="reading" logLabel="Log reading" />
      <div className="grid items-start gap-4 lg:grid-cols-2">
        <ChartCard series={minutes} />
        <RecentEntriesCard types={READING_TYPES} period={period} logType="reading" logLabel="Log reading" />
        <LibraryCard />
      </div>
    </>
  )
}

function LibraryCard() {
  const { state, logEntry, openBook } = useApp()
  const order = { Reading: 0, "Want to read": 1, Paused: 2, Finished: 3 }
  const books = (state.books || []).map((book, index) => ({ book, index })).sort((a, b) => order[a.book.status] - order[b.book.status] || a.index - b.index).map((x) => x.book)
  const counts = ["Reading", "Want to read", "Paused", "Finished"].map((status) => [status, books.filter((b) => b.status === status).length]).filter(([, n]) => n)
  return (
    <Card className="min-w-0 lg:col-span-2">
      <CardHeader>
        <CardTitle>Library</CardTitle>
        <CardDescription className="tabular-nums">
          {books.length ? counts.map(([status, n]) => `${n} ${status.toLowerCase()}`).join(" · ") : "No books yet"}
        </CardDescription>
        <CardAction>
          <Button variant="outline" size="sm" onClick={() => openBook()}>
            <PlusIcon data-icon="inline-start" />
            Add book
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent className="@container/grid min-w-0">
        {books.length ? (
          <ul className="grid min-w-0 gap-3 @lg/grid:grid-cols-2 @3xl/grid:grid-cols-3">
            {books.map((book) => {
              const progress = bookProgress(book, state.entries)
              return (
                <li key={book.id} className="flex min-w-0 gap-3 rounded-lg border p-3">
                  <BookCover book={book} className="h-24 w-16 shrink-0" />
                  <div className="flex min-w-0 flex-1 flex-col gap-2">
                    <div className="flex min-w-0 items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate font-medium">{book.title}</p>
                        <p className="truncate text-muted-foreground">{book.author || "Author not added"}</p>
                      </div>
                      <Button variant="ghost" size="icon-sm" aria-label={`Edit ${book.title}`} onClick={() => openBook(book)}>
                        <PencilIcon />
                      </Button>
                    </div>
                    <Badge variant={progress.finished ? "secondary" : "outline"}>
                      {progress.finished ? "Finished" : book.status}
                    </Badge>
                    <Progress
                      value={progress.percent}
                      aria-label={`${book.title} completion`}
                      className="[&>[data-slot=progress-indicator]]:bg-chart-1"
                    />
                    <p className="truncate text-xs text-muted-foreground tabular-nums">
                      {formatNumber(progress.pages, 0)}
                      {book.totalPages ? ` / ${formatNumber(book.totalPages, 0)}` : ""} pages
                      {book.totalChapters ? ` · ${progress.chapters} / ${book.totalChapters} chapters` : ""}
                      {` · ${Math.round(progress.percent)}%`}
                    </p>
                    <Button variant="outline" size="sm" className="self-start" onClick={() => logEntry("reading", { bookId: book.id })}>
                      <PlusIcon data-icon="inline-start" />
                      Log reading
                    </Button>
                  </div>
                </li>
              )
            })}
          </ul>
        ) : (
          <Empty className="border">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <BookOpenIcon />
              </EmptyMedia>
              <EmptyTitle>Your next chapter starts here</EmptyTitle>
              <EmptyDescription>Add a book to track pages and progress.</EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
              <Button size="sm" onClick={() => openBook()}>
                <PlusIcon data-icon="inline-start" />
                Add book
              </Button>
            </EmptyContent>
          </Empty>
        )}
      </CardContent>
    </Card>
  )
}

// ---------- Guitar ----------

export function GuitarTab({ opts, period }) {
  const { state } = useApp()
  const guitar = useSeries("guitar", opts)
  const plan = usePracticePlan()
  const songs = useMemo(() => minutesBySong(state, period), [state, period])
  return (
    <>
      <PracticeTodayCard plan={plan} />
      <KpiRow series={guitar} />
      <MainChartCard series={guitar} logType="guitar" logLabel="Log practice" />
      <div className="grid items-start gap-4 lg:grid-cols-2">
        <RetentionCard plan={plan} />
        <Card className="min-w-0">
          <CardHeader>
            <CardTitle>Minutes per song</CardTitle>
            <CardDescription>Practice time in this range</CardDescription>
          </CardHeader>
          <CardContent className="px-2">
            {songs.length ? (
              <BarList rows={songs.map((s) => ({ key: s.title, label: s.title, value: s.minutes, display: duration(s.minutes) }))} />
            ) : (
              <MutedNote>No practice logged in this range.</MutedNote>
            )}
          </CardContent>
        </Card>
        <PracticeListCard plan={plan} />
        <RecentEntriesCard types={GUITAR_TYPES} period={period} logType="guitar" logLabel="Log practice" />
      </div>
    </>
  )
}
