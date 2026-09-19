import { useId, useState } from "react"
import { BookOpenIcon, CheckIcon, CircleAlertIcon, Music2Icon, PlusIcon, SearchIcon } from "lucide-react"

import { BOOK_STATUSES, dateKey, id, num, SONG_STATUSES } from "@/domain"
import { fillSongCovers } from "@/song-covers"
import { cn } from "@/lib/utils"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Field, FieldDescription, FieldGroup, FieldLabel, FieldSeparator } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select"
import { Spinner } from "@/components/ui/spinner"


export function BookCover({ book, className }) {
  const [failedSrc, setFailedSrc] = useState(null)
  const src = book?.cover
  if (src && failedSrc !== src)
    return (
      <img
        src={src}
        alt={`${book.title} cover`}
        loading="lazy"
        onError={() => setFailedSrc(src)}
        className={cn("aspect-2/3 w-full rounded-md border bg-muted object-cover", className)}
      />
    )
  return (
    <div
      className={cn(
        "@container flex aspect-2/3 w-full flex-col items-center justify-center gap-1 overflow-hidden rounded-md bg-muted text-muted-foreground",
        className,
      )}
    >
      <BookOpenIcon className="size-5 @max-[4rem]:size-4" aria-hidden="true" />
      <span className="text-xs @max-[4rem]:sr-only">No cover</span>
    </div>
  )
}

export function SongCover({ song, className }) {
  const [failedSrc, setFailedSrc] = useState(null)
  const src = song?.cover
  if (src && failedSrc !== src)
    return (
      <img
        src={src}
        alt={`${song.title} album art`}
        loading="lazy"
        onError={() => setFailedSrc(src)}
        className={cn("aspect-square size-12 shrink-0 rounded-md border bg-muted object-cover", className)}
      />
    )
  return (
    <div className={cn("flex aspect-square size-12 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground", className)} aria-hidden="true">
      <Music2Icon className="size-5" />
    </div>
  )
}

function focusDialog(event) {
  event.preventDefault()
  event.currentTarget?.focus?.()
}

function TextField({ label, ...props }) {
  const fieldId = useId()
  return (
    <Field>
      <FieldLabel htmlFor={fieldId}>{label}</FieldLabel>
      <Input id={fieldId} {...props} />
    </Field>
  )
}

function NumberField({ label, value, onChange, min = 0, max = 1000000, step = 1, ...props }) {
  const fieldId = useId()
  return (
    <Field>
      <FieldLabel htmlFor={fieldId}>{label}</FieldLabel>
      <Input
        id={fieldId}
        type="number"
        inputMode={step === 1 ? "numeric" : "decimal"}
        min={min}
        max={max}
        step={step}
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value === "" ? "" : Number(e.target.value))}
        className="tabular-nums"
        {...props}
      />
    </Field>
  )
}

function SelectField({ label, options, ...props }) {
  const fieldId = useId()
  return (
    <Field>
      <FieldLabel htmlFor={fieldId}>{label}</FieldLabel>
      <NativeSelect id={fieldId} className="w-full" {...props}>
        {options.map((option) => (
          <NativeSelectOption key={option} value={option}>
            {option}
          </NativeSelectOption>
        ))}
      </NativeSelect>
    </Field>
  )
}

function ErrorAlert({ children }) {
  if (!children) return null
  return (
    <Alert variant="destructive">
      <CircleAlertIcon />
      <AlertDescription>{children}</AlertDescription>
    </Alert>
  )
}

const coverUrl = (coverId, size) => (coverId ? `https://covers.openlibrary.org/b/id/${coverId}-${size}.jpg?default=false` : "")

export function BookDialog({ open, onOpenChange, book, commit, onSaved }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent aria-describedby={undefined} onOpenAutoFocus={focusDialog} className="flex max-h-[calc(100svh-2rem)] flex-col sm:max-w-lg">
        <BookFormBody key={book?.id ?? "new"} book={book} commit={commit} onSaved={onSaved} onClose={() => onOpenChange?.(false)} />
      </DialogContent>
    </Dialog>
  )
}

function BookFormBody({ book, commit, onSaved, onClose }) {
  const formId = useId()
  const [draft, setDraft] = useState(
    () =>
      book || {
        id: id(),
        title: "",
        author: "",
        totalPages: 0,
        totalChapters: 0,
        startPages: 0,
        startChapters: 0,
        cover: "",
        status: "Reading",
      },
  )
  const [query, setQuery] = useState("")
  const [results, setResults] = useState([])
  const [searching, setSearching] = useState(false)
  const [searched, setSearched] = useState(false)
  const [searchError, setSearchError] = useState("")
  const [error, setError] = useState("")
  const update = (k, v) => setDraft((d) => ({ ...d, [k]: v }))

  async function search(e) {
    e.preventDefault()
    if (query.trim().length < 2) return
    setSearching(true)
    setSearchError("")
    try {
      const params = new URLSearchParams({
        q: query.trim(),
        limit: "6",
        fields: "key,title,author_name,cover_i,number_of_pages_median",
      })
      const response = await fetch(`https://openlibrary.org/search.json?${params}`, { signal: AbortSignal.timeout(15000) })
      if (!response.ok) throw Error("Book search is unavailable right now. You can still add a book manually.")
      const data = await response.json()
      setResults(data.docs || [])
      setSearched(true)
    } catch {
      setSearchError("Could not reach Open Library. Try again, or enter the book details below.")
    } finally {
      setSearching(false)
    }
  }

  function choose(r) {
    setDraft((d) => ({
      ...d,
      title: r.title,
      author: r.author_name?.join(", ") || "",
      cover: coverUrl(r.cover_i, "M"),
      totalPages: r.number_of_pages_median || 0,
    }))
    setResults([])
    setSearchError("")
    setError("")
  }

  function submit(e) {
    e.preventDefault()
    setError("")
    try {
      const b = {
        ...draft,
        title: String(draft.title ?? "").trim(),
        author: String(draft.author ?? "").trim(),
        cover: String(draft.cover ?? "").trim(),
      }
      for (const key of ["totalPages", "totalChapters", "startPages", "startChapters"]) b[key] = num(b[key])
      if (!b.title) throw Error("Enter a book title.")
      if (b.cover && !/^https:\/\//.test(b.cover)) throw Error("Use an HTTPS cover image URL.")
      if (b.totalPages && b.startPages > b.totalPages) throw Error("Previously read pages cannot exceed the book length.")
      if (b.totalChapters && b.startChapters > b.totalChapters) throw Error("Previously read chapters cannot exceed the book length.")
      commit((s) => ({ ...s, books: [...s.books.filter((x) => x.id !== b.id), b] }))
      onSaved?.(book ? "Book updated" : "Book added to your library")
      onClose()
    } catch (err) {
      setError(err.message)
    }
  }

  return (
    <>
      <DialogHeader className="pr-8">
        <DialogTitle>{book ? "Edit book" : "Add a book"}</DialogTitle>
      </DialogHeader>
      <div className="-mx-4 flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 py-1">
        <form role="search" onSubmit={search} className="flex flex-col gap-2">
          <FieldLabel htmlFor={`${formId}-query`}>Find a book online</FieldLabel>
          <div className="flex gap-2">
            <Input
              id={`${formId}-query`}
              type="search"
              placeholder="Search title, author, or ISBN"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <Button type="submit" variant="secondary" disabled={searching || query.trim().length < 2}>
              {searching ? <Spinner data-icon="inline-start" /> : <SearchIcon data-icon="inline-start" />}
              {searching ? "Searching…" : "Search"}
            </Button>
          </div>
          <FieldDescription className="text-xs">
            Book search by{" "}
            <a href="https://openlibrary.org" target="_blank" rel="noreferrer">
              Open Library
            </a>
          </FieldDescription>
        </form>

        <ErrorAlert>{searchError}</ErrorAlert>
        {searched && !results.length && !searchError && (
          <p className="text-sm text-muted-foreground">No matches. Try another title or add it manually.</p>
        )}
        {results.length > 0 && (
          <ul className="flex flex-col gap-1" aria-label="Search results">
            {results.map((r) => (
              <li key={r.key}>
                <button
                  type="button"
                  onClick={() => choose(r)}
                  className="flex w-full min-w-0 items-center gap-3 rounded-lg border p-2 text-left transition-colors outline-none hover:bg-muted focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                >
                  <BookCover book={{ title: r.title, cover: coverUrl(r.cover_i, "S") }} className="w-10 shrink-0" />
                  <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="line-clamp-2 text-sm font-medium">{r.title}</span>
                    {r.author_name?.length > 0 && <span className="truncate text-xs text-muted-foreground">{r.author_name.join(", ")}</span>}
                  </span>
                  <PlusIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        )}

        <FieldSeparator className="*:data-[slot=field-separator-content]:bg-popover">Book details</FieldSeparator>

        <form id={`${formId}-details`} onSubmit={submit}>
          <FieldGroup className="gap-4">
            <div className="flex gap-3">
              {/^https:\/\/\S+$/.test(draft.cover) && <BookCover book={draft} className="w-16 shrink-0 self-start" />}
              <div className="flex min-w-0 flex-1 flex-col gap-4">
                <TextField label="Title" required maxLength={300} value={draft.title} onChange={(e) => update("title", e.target.value)} />
                <TextField label="Author" maxLength={300} value={draft.author} onChange={(e) => update("author", e.target.value)} />
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <NumberField label="Total pages" value={draft.totalPages} onChange={(v) => update("totalPages", v)} />
              <NumberField label="Total chapters" value={draft.totalChapters} onChange={(v) => update("totalChapters", v)} />
              <NumberField label="Pages read before Daybook" value={draft.startPages} onChange={(v) => update("startPages", v)} />
              <NumberField label="Chapters read before Daybook" value={draft.startChapters} onChange={(v) => update("startChapters", v)} />
            </div>
            <FieldDescription>Check the page count against your edition. Leave unknown totals at 0.</FieldDescription>
            <SelectField label="Status" options={BOOK_STATUSES} value={draft.status} onChange={(e) => update("status", e.target.value)} />
            <TextField
              label="Cover image URL (optional)"
              type="url"
              maxLength={2000}
              placeholder="https://…"
              value={draft.cover}
              onChange={(e) => update("cover", e.target.value)}
            />
          </FieldGroup>
        </form>
      </div>

      <ErrorAlert>{error}</ErrorAlert>

      <DialogFooter className="flex-row justify-end">
        <Button type="button" variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" form={`${formId}-details`}>
          <CheckIcon data-icon="inline-start" />
          Save book
        </Button>
      </DialogFooter>
    </>
  )
}

export function SongDialog({ open, onOpenChange, song, commit, onSaved }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent aria-describedby={undefined} onOpenAutoFocus={focusDialog} className="flex max-h-[calc(100svh-2rem)] flex-col sm:max-w-md">
        <SongFormBody key={song?.id ?? "new"} song={song} commit={commit} onSaved={onSaved} onClose={() => onOpenChange?.(false)} />
      </DialogContent>
    </Dialog>
  )
}

function SongFormBody({ song, commit, onSaved, onClose }) {
  const [draft, setDraft] = useState(() => song || { id: id(), title: "", artist: "", targetBpm: 0, status: "Want to learn", cover: "", added: dateKey() })
  const [error, setError] = useState("")
  const update = (k, v) => setDraft((d) => ({ ...d, [k]: v }))

  function submit(e) {
    e.preventDefault()
    setError("")
    try {
      const s = {
        ...draft,
        title: String(draft.title ?? "").trim(),
        artist: String(draft.artist ?? "").trim(),
        targetBpm: num(draft.targetBpm),
      }
      if (!s.title) throw Error("Enter a song title.")
      // A renamed song looks up its album art again.
      if (song && (song.title !== s.title || song.artist !== s.artist)) s.cover = ""
      commit((d) => ({ ...d, songs: d.songs.some((x) => x.id === s.id) ? d.songs.map((x) => (x.id === s.id ? s : x)) : [...d.songs, s] }))
      if (!s.cover) void fillSongCovers(commit, [s])
      onSaved?.("Song saved")
      onClose()
    } catch (err) {
      setError(err.message)
    }
  }

  return (
    <>
      <DialogHeader className="pr-8">
        <DialogTitle>{song ? "Edit song" : "Add a song"}</DialogTitle>
      </DialogHeader>
      <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col gap-4">
        <div className="-mx-4 min-h-0 flex-1 overflow-y-auto px-4 py-1">
          <FieldGroup className="gap-4">
            <TextField
              label="Song title"
              required
              maxLength={300}
              placeholder="e.g. Blackbird"
              value={draft.title}
              onChange={(e) => update("title", e.target.value)}
            />
            <TextField label="Artist" maxLength={300} value={draft.artist} onChange={(e) => update("artist", e.target.value)} />
            <div className="grid gap-3 sm:grid-cols-2">
              <NumberField label="Target tempo (BPM)" max={400} value={draft.targetBpm} onChange={(v) => update("targetBpm", v)} />
              <SelectField label="Learning status" options={SONG_STATUSES} value={draft.status} onChange={(e) => update("status", e.target.value)} />
            </div>
          </FieldGroup>
        </div>
        <ErrorAlert>{error}</ErrorAlert>
        <DialogFooter className="flex-row justify-end">
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit">
            <CheckIcon data-icon="inline-start" />
            Save song
          </Button>
        </DialogFooter>
      </form>
    </>
  )
}
