import { useState } from "react"
import { CheckIcon, CircleAlertIcon, PencilIcon, PlusIcon, TimerIcon, Trash2Icon } from "lucide-react"

import { LABELS, entryDetail, entryTitle, fmtDate, pretty } from "@/domain"
import { TypeIcon } from "@/lib/entry-meta"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"

function safeDetail(entry) {
  try {
    return entryDetail(entry)
  } catch {
    return ""
  }
}

function focusDialog(event) {
  event.preventDefault()
  event.currentTarget?.focus?.()
}

export function EntryDetailDialog({ entry, state, open, onOpenChange, onEdit, onLogAgain, onDelete }) {
  if (!entry) return null
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        aria-describedby={undefined}
        onOpenAutoFocus={focusDialog}
        className="flex max-h-[calc(100svh-2rem)] flex-col sm:max-w-lg"
      >
        <EntryDetailBody key={entry.id} entry={entry} state={state} onEdit={onEdit} onLogAgain={onLogAgain} onDelete={onDelete} />
      </DialogContent>
    </Dialog>
  )
}

function EntryDetailBody({ entry, state, onEdit, onLogAgain, onDelete }) {
  const [confirming, setConfirming] = useState(false)
  const [error, setError] = useState("")
  const summary = safeDetail(entry)
  const exercises = entry.type === "workout" ? entry.exercises || [] : []
  const items = entry.type === "food" ? entry.items || [] : []

  function remove() {
    setError("")
    try {
      onDelete?.(entry)
    } catch (err) {
      setError(err.message)
    }
  }

  return (
    <>
      <DialogHeader className="gap-2 pr-8">
        <DialogTitle className="leading-snug">{entryTitle(entry, state)}</DialogTitle>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <TypeIcon type={entry.type} className="size-4" />
            {LABELS[entry.type]}
          </span>
          <span aria-hidden="true">·</span>
          <span className="tabular-nums">
            {fmtDate(entry.date, { day: "numeric", month: "long", year: "numeric" })} · {entry.time}
          </span>
          <Badge variant={entry.status === "planned" ? "outline" : "secondary"}>
            {entry.status === "planned" ? "Planned" : "Completed"}
          </Badge>
        </div>
      </DialogHeader>

      <div className="-mx-4 flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4">
        {summary && <p className="text-base font-medium tabular-nums">{summary}</p>}

        {exercises.length > 0 && (
          <ul className="flex flex-col gap-2">
            {exercises.map((ex, i) => (
              <li key={i} className="flex flex-col gap-2 rounded-lg border p-3">
                <div className="flex min-w-0 items-baseline justify-between gap-2">
                  <span className="truncate font-medium">{ex.name}</span>
                  <span className="shrink-0 text-xs text-muted-foreground capitalize">{ex.muscle?.replaceAll("-", " ")}</span>
                </div>
                <ul className="flex flex-wrap gap-1.5" aria-label={`${ex.name} sets`}>
                  {(ex.sets || []).map((s, j) => (
                    <li key={j}>
                      <Badge variant={s.done ? "secondary" : "outline"} className="tabular-nums">
                        {s.done ? <CheckIcon aria-label="Done" /> : <TimerIcon aria-label="Not done" />}
                        {s.weight} kg × {s.reps}
                      </Badge>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        )}

        {items.length > 0 && (
          <ul className="flex flex-col divide-y rounded-lg border">
            {items.map((item, j) => (
              <li key={j} className="flex items-center justify-between gap-3 p-3">
                <div className="flex min-w-0 flex-col gap-0.5">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="truncate font-medium">{item.name}</span>
                    {item.estimated && <Badge variant="secondary">Estimated</Badge>}
                  </div>
                  <span className="text-xs text-muted-foreground tabular-nums">
                    {pretty(item.servings)} {item.servings === 1 ? "serving" : "servings"} · {pretty(item.protein * item.servings)} g protein
                  </span>
                </div>
                <span className="shrink-0 text-sm font-medium tabular-nums">{pretty(item.calories * item.servings)} kcal</span>
              </li>
            ))}
          </ul>
        )}

        {entry.notes && (
          <div className="flex flex-col gap-1 rounded-lg bg-muted p-3">
            <span className="text-xs font-medium text-muted-foreground">Notes</span>
            <p className="text-sm whitespace-pre-wrap">{entry.notes}</p>
          </div>
        )}
      </div>

      {error && (
        <Alert variant="destructive">
          <CircleAlertIcon />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {confirming ? (
        <DialogFooter className="flex-col items-stretch gap-3 sm:flex-col sm:justify-start">
          <p className="text-sm">Delete this entry? Its contribution to your progress will also be removed.</p>
          <div className="flex flex-wrap justify-end gap-2">
            <Button type="button" variant="outline" autoFocus onClick={() => setConfirming(false)}>
              Keep entry
            </Button>
            <Button type="button" variant="destructive" onClick={remove}>
              <Trash2Icon data-icon="inline-start" />
              Delete entry
            </Button>
          </div>
        </DialogFooter>
      ) : (
        <DialogFooter className="flex-row flex-wrap items-center justify-end">
          <Button
            type="button"
            variant="ghost"
            className="mr-auto text-destructive hover:bg-destructive/10 hover:text-destructive"
            onClick={() => setConfirming(true)}
          >
            <Trash2Icon data-icon="inline-start" />
            <span className="max-sm:sr-only">Delete entry</span>
          </Button>
          <Button type="button" variant="outline" onClick={() => onLogAgain?.(entry)}>
            <PlusIcon data-icon="inline-start" />
            Log again
          </Button>
          <Button type="button" onClick={() => onEdit?.(entry)}>
            <PencilIcon data-icon="inline-start" />
            Edit entry
          </Button>
        </DialogFooter>
      )}
    </>
  )
}
