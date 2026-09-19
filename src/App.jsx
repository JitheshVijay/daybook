import * as React from "react"
import { toast } from "sonner"
import { PlusIcon, CircleAlertIcon } from "lucide-react"
import { dateKey, id } from "@/domain"
import { useDaybook } from "@/store"
import { AppContext } from "@/components/app/app-context"
import { AppSidebar } from "@/components/app/app-sidebar"
import { useChat } from "@/components/chat/use-chat"
import { ChatPage } from "@/components/chat/chat-page"
import { EntryDialog, makeEntry } from "@/components/entry/entry-form"
import { EntryDetailDialog } from "@/components/entry/entry-detail"
import { BookDialog, SongDialog } from "@/components/entry/library-forms"
import { COVER_LOOKUP_VERSION, fillSongCovers } from "@/song-covers"
import { BOOK_COVER_VERSION, fillBookCovers } from "@/book-covers"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import { Skeleton } from "@/components/ui/skeleton"
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"

// Secondary pages load on first visit so the chat home starts fast.
const InsightsPage = React.lazy(() => import("@/components/insights/insights-page").then((m) => ({ default: m.InsightsPage })))
const JournalPage = React.lazy(() => import("@/components/journal/journal-page").then((m) => ({ default: m.JournalPage })))
const SettingsPage = React.lazy(() => import("@/components/settings/settings-page").then((m) => ({ default: m.SettingsPage })))

function PageFallback() {
  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 px-4 py-8 md:px-6" aria-busy="true">
      <Skeleton className="h-8 w-40" />
      <Skeleton className="h-4 w-64" />
      <Skeleton className="h-64 w-full rounded-xl" />
    </div>
  )
}

const TITLES = { chat: "Chat", insights: "Insights", journal: "Journal", settings: "Settings" }

function useMediaQuery(query) {
  const get = () => (typeof window === "undefined" ? true : window.matchMedia(query).matches)
  const [matches, setMatches] = React.useState(get)
  React.useEffect(() => {
    const list = window.matchMedia(query)
    const onChange = () => setMatches(list.matches)
    list.addEventListener("change", onChange)
    onChange()
    return () => list.removeEventListener("change", onChange)
  }, [query])
  return matches
}

// Today's local date, refreshed after midnight.
function useToday() {
  const [today, setToday] = React.useState(dateKey())
  React.useEffect(() => {
    const timer = setInterval(() => setToday((current) => (current === dateKey() ? current : dateKey())), 60_000)
    return () => clearInterval(timer)
  }, [])
  return today
}

export function App() {
  const storage = useDaybook()
  if (!storage.ready)
    return (
      <div className="flex min-h-svh items-center justify-center" aria-busy="true" role="status">
        <span className="sr-only">Loading your Daybook…</span>
        <Skeleton className="h-10 w-48 rounded-lg" />
      </div>
    )
  return <DaybookApp storage={storage} />
}

function DaybookApp({ storage }) {
  const { data: state, commit, error: storageError, get, sync, notice, clearNotice } = storage
  const today = useToday()
  const data = React.useMemo(() => ({ get, commit }), [get, commit])
  const chat = useChat(data, { today, initialChat: storage.initialChat, persistChat: storage.persistChat, remoteChat: storage.remoteChat, mode: storage.mode })
  React.useEffect(() => {
    if (notice?.kind !== "moved") return
    toast.success("Your data is now in the Daybook database", {
      id: "moved-to-database",
      description: `Moved ${notice.entries} entries, ${notice.books} books, ${notice.songs} songs and ${notice.habits} habits from this browser.`,
    })
    clearNotice()
  }, [notice, clearNotice])
  const [page, setPage] = React.useState("chat")
  const [params, setParams] = React.useState({})
  const [dialog, setDialog] = React.useState(null)
  const [aiStatus, setAiStatus] = React.useState(null)
  const wide = useMediaQuery("(min-width: 1024px)")
  const [sidebarOpen, setSidebarOpen] = React.useState(wide)
  React.useEffect(() => setSidebarOpen(wide), [wide])

  React.useEffect(() => {
    try {
      // Once per visit, and again whenever the lookup improves.
      const key = `daybook.covers.v${COVER_LOOKUP_VERSION}.${BOOK_COVER_VERSION}`
      if (sessionStorage.getItem(key)) return
      sessionStorage.setItem(key, "1")
    } catch {
      return
    }
    const missing = get().songs.filter((s) => !s.cover).slice(0, 20)
    if (missing.length) void fillSongCovers(commit, missing)
    const noCover = get().books.filter((b) => !b.cover).slice(0, 10)
    if (noCover.length) void fillBookCovers(commit, noCover)
  }, [get, commit])

  React.useEffect(() => {
    let alive = true
    fetch("/api/assistant/status")
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((status) => alive && setAiStatus(status))
      .catch(() => alive && setAiStatus({ configured: false, provider: null, model: null }))
    return () => {
      alive = false
    }
  }, [])

  const navigate = React.useCallback((next, nextParams = {}) => {
    setPage(next)
    setParams(nextParams)
    window.scrollTo({ top: 0 })
  }, [])
  const close = React.useCallback(() => setDialog(null), [])
  const open = React.useCallback((value) => setDialog({ ...value, key: id() }), [])

  const context = React.useMemo(
    () => ({
      state,
      commit,
      storageError,
      storage: { mode: storage.mode, reason: storage.reason, databaseFile: storage.databaseFile, sync, browserCopy: storage.browserCopy },
      today,
      aiStatus,
      page,
      params,
      navigate,
      openEntry: (entry) => open({ kind: "detail", entryId: entry.id }),
      logEntry: (type, overrides = {}) => {
        const { entry, date = today, ...fields } = overrides
        const initialType = type || "workout"
        open({
          kind: "entry",
          initialType,
          date,
          entry: entry || (type && Object.keys(fields).length ? { ...makeEntry(initialType, date), ...fields } : undefined),
        })
      },
      openBook: (book) => open({ kind: "book", book }),
      openSong: (song) => open({ kind: "song", song }),
    }),
    [state, commit, storageError, storage.mode, storage.reason, storage.databaseFile, storage.browserCopy, sync, today, aiStatus, page, params, navigate, open],
  )

  const detail = dialog?.kind === "detail" ? state.entries.find((e) => e.id === dialog.entryId) : null
  const onOpenChange = (value) => !value && close()

  return (
    <AppContext.Provider value={context}>
      <SidebarProvider open={sidebarOpen} onOpenChange={setSidebarOpen} style={{ "--header-height": "3.5rem" }}>
        <AppSidebar onNewChat={chat.newChat} />
        <SidebarInset className="min-w-0">
          <header className="sticky top-0 z-20 flex h-(--header-height) shrink-0 items-center gap-2 border-b bg-background/90 px-3 backdrop-blur supports-[backdrop-filter]:bg-background/70 md:px-4">
            <SidebarTrigger className="-ml-1" />
            <Separator orientation="vertical" className="mr-1 data-vertical:h-4 data-vertical:self-auto" />
            <h1 className="truncate font-heading text-sm font-medium">{TITLES[page]}</h1>
            <div className="ml-auto flex items-center gap-2">
              {page === "chat" && aiStatus?.configured && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Badge variant="outline" className="hidden gap-1.5 sm:inline-flex">
                      <span className="size-1.5 rounded-full bg-emerald-500" aria-hidden="true" />
                      {aiStatus.provider}
                    </Badge>
                  </TooltipTrigger>
                  <TooltipContent>Model: {aiStatus.model}</TooltipContent>
                </Tooltip>
              )}
              {page !== "settings" && (
                <Button variant="outline" size="sm" onClick={() => context.logEntry()}>
                  <PlusIcon data-icon="inline-start" />
                  <span className="max-sm:sr-only">Log manually</span>
                </Button>
              )}
            </div>
          </header>
          {storageError && (
            <div className="mx-auto w-full max-w-3xl px-4 pt-4">
              <Alert variant="destructive" role="alert">
                <CircleAlertIcon />
                <AlertTitle>Your saved data couldn’t be opened</AlertTitle>
                <AlertDescription>
                  <p>{storageError}</p>
                  <Button size="sm" variant="outline" className="mt-2" onClick={() => navigate("settings")}>
                    Open backup and restore
                  </Button>
                </AlertDescription>
              </Alert>
            </div>
          )}
          {sync.failing && (
            <div className="mx-auto w-full max-w-3xl px-4 pt-4">
              <Alert role="status">
                <CircleAlertIcon />
                <AlertTitle>Not saved to the database yet</AlertTitle>
                <AlertDescription>
                  {sync.unsaved} {sync.unsaved === 1 ? "change is" : "changes are"} kept in this browser and will be saved when the Daybook server is reachable again.
                </AlertDescription>
              </Alert>
            </div>
          )}
          <div id="main" className="flex min-w-0 flex-1 flex-col">
            {page === "chat" && <ChatPage chat={chat} />}
            <React.Suspense fallback={<PageFallback />}>
              {page === "insights" && <InsightsPage key={JSON.stringify(params)} />}
              {page === "journal" && <JournalPage />}
              {page === "settings" && <SettingsPage onClearChat={chat.newChat} />}
            </React.Suspense>
          </div>
        </SidebarInset>
      </SidebarProvider>

      {dialog?.kind === "entry" && (
        <EntryDialog
          key={dialog.key}
          open
          onOpenChange={onOpenChange}
          state={state}
          commit={commit}
          entry={dialog.entry}
          initialType={dialog.initialType}
          date={dialog.date}
          onSaved={(message) => toast.success(message)}
        />
      )}
      {detail && (
        <EntryDetailDialog
          key={dialog.key}
          entry={detail}
          state={state}
          open
          onOpenChange={onOpenChange}
          onEdit={(entry) => open({ kind: "entry", entry })}
          onLogAgain={(entry) =>
            open({ kind: "entry", entry: { ...structuredClone(entry), id: id(), date: today, status: "done", sourceBatch: undefined } })
          }
          onDelete={(entry) => {
            try {
              commit((s) => ({ ...s, entries: s.entries.filter((e) => e.id !== entry.id) }))
              close()
              toast.success("Entry deleted")
            } catch (error) {
              toast.error(error.message)
            }
          }}
        />
      )}
      {dialog?.kind === "book" && (
        <BookDialog key={dialog.key} open onOpenChange={onOpenChange} book={dialog.book} commit={commit} onSaved={(message) => toast.success(message)} />
      )}
      {dialog?.kind === "song" && (
        <SongDialog key={dialog.key} open onOpenChange={onOpenChange} song={dialog.song} commit={commit} onSaved={(message) => toast.success(message)} />
      )}
    </AppContext.Provider>
  )
}

