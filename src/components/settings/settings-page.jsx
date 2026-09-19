import * as React from "react"
import { toast } from "sonner"
import { useTheme } from "next-themes"
import { DatabaseIcon, DownloadIcon, MonitorIcon, MoonIcon, SunIcon, Trash2Icon, UploadIcon } from "lucide-react"
import { dateKey, id, num, validateState } from "@/domain"
import { downloadFile, STORAGE_KEY } from "@/store"
import { useApp } from "@/components/app/app-context"
import { Page, PageHeader } from "@/components/app/page"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemTitle } from "@/components/ui/item"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"

const GOALS = [
  ["workoutGoal", "Workouts per week"],
  ["readingGoal", "Pages per day"],
  ["guitarGoal", "Guitar minutes per day"],
  ["meditationGoal", "Meditation minutes per day"],
  ["stepsGoal", "Steps per day"],
  ["screenGoal", "Screen-time limit (minutes per day)"],
  ["calorieGoal", "Calorie target (kcal per day)"],
  ["proteinGoal", "Protein target (g per day)"],
]

export function SettingsPage({ onClearChat }) {
  const { state, commit, aiStatus, storage } = useApp()
  const database = storage?.mode === "database"
  const browserCopy = database ? storage.browserCopy?.() : null
  const browserRecords = browserCopy ? browserCopy.entries.length + browserCopy.books.length + browserCopy.songs.length + browserCopy.habits.length : 0
  const { theme, setTheme } = useTheme()
  const [profile, setProfile] = React.useState({ ...state.profile })
  const [habit, setHabit] = React.useState({ name: "", unit: "times", goal: 1 })
  const [pending, setPending] = React.useState(null)
  const [error, setError] = React.useState("")
  const [confirmClear, setConfirmClear] = React.useState(false)

  const attempt = (fn, message) => {
    try {
      fn()
      setError("")
      if (message) toast.success(message)
      return true
    } catch (err) {
      setError(err.message)
      return false
    }
  }

  async function importFile(file) {
    if (!file) return
    try {
      if (file.size > 20 * 1024 * 1024) throw Error("Backup must be smaller than 20 MB.")
      setPending(validateState(JSON.parse(await file.text())))
      setError("")
    } catch (err) {
      setError(err.message || "That backup could not be read.")
    }
  }

  return (
    <Page className="max-w-3xl">
      <PageHeader title="Settings" description="Goals, habits, appearance, the AI connection, and your backups." />
      {error && (
        <Alert variant="destructive" role="alert">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Profile and goals</CardTitle>
          <CardDescription>Goals draw target lines on your charts. Set one to 0 to leave it unset.</CardDescription>
        </CardHeader>
        <CardContent>
          <form
            id="goals-form"
            onSubmit={(event) => {
              event.preventDefault()
              attempt(() => {
                const next = { ...profile, name: profile.name.trim() }
                for (const [key] of GOALS) next[key] = num(next[key])
                commit((s) => ({ ...s, profile: next }))
              }, "Goals saved")
            }}
          >
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="profile-name">Your name</FieldLabel>
                <Input id="profile-name" maxLength={100} placeholder="What should Daybook call you?" value={profile.name} onChange={(e) => setProfile((p) => ({ ...p, name: e.target.value }))} />
              </Field>
              <div className="grid gap-4 sm:grid-cols-2">
                {GOALS.map(([key, label]) => (
                  <Field key={key}>
                    <FieldLabel htmlFor={`goal-${key}`}>{label}</FieldLabel>
                    <Input
                      id={`goal-${key}`}
                      type="number"
                      inputMode="numeric"
                      min={0}
                      value={profile[key] ?? ""}
                      onChange={(e) => setProfile((p) => ({ ...p, [key]: e.target.value === "" ? "" : Number(e.target.value) }))}
                    />
                  </Field>
                ))}
              </div>
            </FieldGroup>
          </form>
        </CardContent>
        <CardFooter className="justify-end">
          <Button type="submit" form="goals-form">Save goals</Button>
        </CardFooter>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Appearance</CardTitle>
          <CardDescription>Follows your system unless you choose.</CardDescription>
        </CardHeader>
        <CardContent>
          <ToggleGroup type="single" variant="outline" value={theme} onValueChange={(value) => value && setTheme(value)} aria-label="Theme">
            <ToggleGroupItem value="light" aria-label="Light">
              <SunIcon /> Light
            </ToggleGroupItem>
            <ToggleGroupItem value="dark" aria-label="Dark">
              <MoonIcon /> Dark
            </ToggleGroupItem>
            <ToggleGroupItem value="system" aria-label="System">
              <MonitorIcon /> System
            </ToggleGroupItem>
          </ToggleGroup>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Custom habits</CardTitle>
          <CardDescription>Track anything with a unit, like water or writing. The assistant can create these too.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {state.habits.length > 0 && (
            <ItemGroup className="gap-1">
              {state.habits.map((h) => {
                const used = state.entries.some((e) => e.habitId === h.id)
                return (
                  <Item key={h.id} variant="outline" size="sm">
                    <ItemContent>
                      <ItemTitle>{h.name}</ItemTitle>
                      <ItemDescription>{h.goal ? `${h.goal} ${h.unit} per day` : `Tracked in ${h.unit}`}</ItemDescription>
                    </ItemContent>
                    <ItemActions>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`Delete ${h.name}`}
                        disabled={used}
                        title={used ? "Habits with entries are kept to preserve your history" : undefined}
                        onClick={() => attempt(() => commit((s) => ({ ...s, habits: s.habits.filter((x) => x.id !== h.id) })), "Habit removed")}
                      >
                        <Trash2Icon />
                      </Button>
                    </ItemActions>
                  </Item>
                )
              })}
            </ItemGroup>
          )}
          <form
            className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_8rem_7rem_auto] sm:items-end"
            onSubmit={(event) => {
              event.preventDefault()
              attempt(() => {
                if (!habit.name.trim()) throw Error("Name your habit.")
                commit((s) => ({ ...s, habits: [...s.habits, { id: id(), name: habit.name.trim(), unit: habit.unit.trim() || "times", goal: num(habit.goal) }] }))
                setHabit({ name: "", unit: "times", goal: 1 })
              }, "Habit added")
            }}
          >
            <Field>
              <FieldLabel htmlFor="habit-name">Habit name</FieldLabel>
              <Input id="habit-name" maxLength={200} placeholder="e.g. Drink water" value={habit.name} onChange={(e) => setHabit((h) => ({ ...h, name: e.target.value }))} />
            </Field>
            <Field>
              <FieldLabel htmlFor="habit-unit">Unit</FieldLabel>
              <Input id="habit-unit" maxLength={50} value={habit.unit} onChange={(e) => setHabit((h) => ({ ...h, unit: e.target.value }))} />
            </Field>
            <Field>
              <FieldLabel htmlFor="habit-goal">Daily goal</FieldLabel>
              <Input id="habit-goal" type="number" inputMode="decimal" min={0} step={0.1} value={habit.goal} onChange={(e) => setHabit((h) => ({ ...h, goal: e.target.value === "" ? "" : Number(e.target.value) }))} />
            </Field>
            <Button type="submit" variant="secondary">Add habit</Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            AI assistant
            {aiStatus && (
              <Badge variant={aiStatus.configured ? "secondary" : "outline"}>{aiStatus.configured ? "Connected" : "Not connected"}</Badge>
            )}
          </CardTitle>
          <CardDescription>
            {aiStatus?.configured
              ? `Using ${aiStatus.model} through ${aiStatus.provider}. The key stays on the computer running Daybook.`
              : "Chat needs an API key on the computer running Daybook."}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 text-sm">
          {!aiStatus?.configured && (
            <ol className="list-decimal space-y-1 pl-5 text-muted-foreground">
              <li>In the project folder, copy <code className="rounded bg-muted px-1 py-0.5 text-foreground">.env.example</code> to <code className="rounded bg-muted px-1 py-0.5 text-foreground">.env.local</code>.</li>
              <li>Set <code className="rounded bg-muted px-1 py-0.5 text-foreground">OPENROUTER_API_KEY</code> and <code className="rounded bg-muted px-1 py-0.5 text-foreground">OPENROUTER_MODEL</code> (or the OpenAI equivalents).</li>
              <li>Restart the dev server.</li>
            </ol>
          )}
          <p className="text-muted-foreground">
            Each message sends your words, today’s entries, goals, library names, and a 7-day summary to the provider. Journal notes and dream text are not sent. Replies never change your data except through the logged cards you can undo.
          </p>
          <div>
            <Button variant="outline" size="sm" onClick={() => setConfirmClear(true)}>Clear conversation</Button>
          </div>
        </CardContent>
      </Card>

      <Card data-testid="storage-card">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <DatabaseIcon className="size-4" aria-hidden="true" />
            Where your data lives
          </CardTitle>
          <CardDescription>
            {database
              ? `In the Daybook database on this computer (${storage.databaseFile || "data/daybook.db"}). Every browser and tab on this computer sees the same data, and clearing browser data doesn't delete it.`
              : storage?.reason === "other-device"
                ? "In this browser only. The database is only available on the computer running Daybook, so this device keeps its own copy."
                : "In this browser only, because the Daybook database couldn't be reached."}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 text-sm">
          {database && (
            <p className="text-muted-foreground tabular-nums">
              {storage.sync?.unsaved ? `${storage.sync.unsaved} ${storage.sync.unsaved === 1 ? "change" : "changes"} waiting to be saved.` : "All changes are saved."}
            </p>
          )}
          {database && browserRecords > 0 && state.entries.length === 0 && (
            <Alert>
              <AlertDescription className="flex flex-col gap-2">
                <span>This browser still has an older copy with {browserCopy.entries.length} entries. The database is empty.</span>
                <Button size="sm" variant="outline" className="self-start" onClick={() => setPending(browserCopy)}>
                  Copy it into the database
                </Button>
              </AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Backup and restore</CardTitle>
          <CardDescription>
            {database
              ? "A backup file is a copy you can keep anywhere or restore on another computer."
              : "Everything is saved in this browser only. Export a backup before switching devices or clearing browser data."}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          <Button onClick={() => downloadFile(`daybook-backup-${dateKey()}.json`, JSON.stringify(state, null, 2))}>
            <DownloadIcon data-icon="inline-start" />
            Export backup
          </Button>
          <Button variant="outline" asChild>
            <label className="cursor-pointer">
              <UploadIcon data-icon="inline-start" />
              Restore backup
              <input
                type="file"
                accept="application/json,.json"
                className="sr-only"
                onChange={(e) => {
                  importFile(e.target.files?.[0])
                  e.target.value = ""
                }}
              />
            </label>
          </Button>
          <Button
            variant="ghost"
            onClick={() => {
              try {
                downloadFile(`daybook-recovery-${dateKey()}.txt`, database ? JSON.stringify(state, null, 2) : localStorage.getItem(STORAGE_KEY) || "No saved data", "text/plain")
              } catch {
                setError("Browser storage could not be accessed.")
              }
            }}
          >
            Download raw recovery copy
          </Button>
        </CardContent>
        <CardFooter>
          <FieldDescription>
            Restoring replaces everything currently saved. Imported files are checked before anything changes.
          </FieldDescription>
        </CardFooter>
      </Card>

      <AlertDialog open={Boolean(pending)} onOpenChange={(open) => !open && setPending(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Restore this backup?</AlertDialogTitle>
            <AlertDialogDescription>
              {pending ? `${pending.entries.length} entries, ${pending.books.length} books, and ${pending.songs.length} songs will replace your current data. Export your current backup first if you want to keep it.` : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() =>
                attempt(() => {
                  commit(pending, true)
                  setProfile(pending.profile)
                  setPending(null)
                }, "Backup restored")
              }
            >
              Restore these records
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={confirmClear} onOpenChange={setConfirmClear}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Clear the conversation?</AlertDialogTitle>
            <AlertDialogDescription>This removes the chat history on this device. Logged entries stay in your journal.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => (onClearChat(), toast.success("Conversation cleared"))}>Clear</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Page>
  )
}
