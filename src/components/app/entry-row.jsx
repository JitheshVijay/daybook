import { ChevronRightIcon } from "lucide-react"
import { entryDetail, entryTitle, fmtDate } from "@/domain"
import { TypeIcon } from "@/lib/entry-meta"
import { Badge } from "@/components/ui/badge"
import { Item, ItemActions, ItemContent, ItemDescription, ItemMedia, ItemTitle } from "@/components/ui/item"

function safeDetail(entry) {
  try {
    return entryDetail(entry)
  } catch {
    return ""
  }
}

export function EntryRow({ entry, state, onOpen, showDate = false }) {
  return (
    <Item asChild size="sm" className="cursor-pointer hover:bg-muted/50">
      <button type="button" onClick={() => onOpen?.(entry)} className="w-full text-left">
        <ItemMedia variant="icon">
          <TypeIcon type={entry.type} />
        </ItemMedia>
        <ItemContent className="min-w-0">
          <ItemTitle className="truncate">{entryTitle(entry, state)}</ItemTitle>
          <ItemDescription className="truncate">
            {showDate ? `${fmtDate(entry.date, { weekday: "short", day: "numeric", month: "short" })} · ` : ""}
            {safeDetail(entry)}
          </ItemDescription>
        </ItemContent>
        <ItemActions className="text-xs text-muted-foreground tabular-nums">
          {entry.status === "planned" ? <Badge variant="outline">Planned</Badge> : entry.time}
          {entry.items?.some((i) => i.estimated) && <Badge variant="secondary">Est.</Badge>}
          <ChevronRightIcon className="size-4" />
        </ItemActions>
      </button>
    </Item>
  )
}
