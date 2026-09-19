import * as React from "react"
import { ArrowUpIcon, CalendarIcon, SquareIcon } from "lucide-react"
import { fmtDate, shiftDate } from "@/domain"
import { Button } from "@/components/ui/button"
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupTextarea } from "@/components/ui/input-group"
import { Input } from "@/components/ui/input"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Kbd } from "@/components/ui/kbd"

function dateLabel(logDate, today) {
  if (logDate === today) return "Today"
  if (logDate === shiftDate(today, -1)) return "Yesterday"
  return fmtDate(logDate, { weekday: "short", day: "numeric", month: "short" })
}

export function Composer({ value, onValueChange: setValue, busy, disabled, onSend, onStop, logDate, onLogDateChange, today, lateNight = false, inputRef }) {
  const [dateOpen, setDateOpen] = React.useState(false)
  const submit = () => {
    if (!value.trim() || busy || disabled) return
    onSend(value)
    setValue("")
  }
  return (
    <form
      className="mx-auto w-full max-w-3xl"
      onSubmit={(event) => {
        event.preventDefault()
        submit()
      }}
    >
      <InputGroup className="rounded-2xl bg-background shadow-xs dark:bg-input/30">
        <InputGroupTextarea
          ref={inputRef}
          aria-label="Message Daybook"
          placeholder={disabled ? "Connect AI in Settings to start chatting" : "Tell me about your day, or ask about your progress…"}
          value={value}
          maxLength={4000}
          rows={1}
          disabled={disabled}
          className="max-h-48 min-h-12 resize-none py-3 text-base md:text-sm"
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
            const coarse = window.matchMedia?.("(pointer: coarse)").matches
            if (event.key === "Enter" && !event.shiftKey && !coarse && !event.nativeEvent.isComposing) {
              event.preventDefault()
              submit()
            }
          }}
        />
        <InputGroupAddon align="block-end" className="gap-2">
          <Popover open={dateOpen} onOpenChange={setDateOpen}>
            <PopoverTrigger asChild>
              <InputGroupButton
                variant="outline"
                size="xs"
                className="rounded-full"
                title={lateNight ? "Until 4 am, entries count toward the day that just ended" : undefined}
                aria-label={`Logging for ${dateLabel(logDate, today)}${lateNight ? ", the day that just ended" : ""}. Change date`}
              >
                <CalendarIcon data-icon="inline-start" />
                {dateLabel(logDate, today)}
                {lateNight ? " (late night)" : ""}
              </InputGroupButton>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-64">
              <div className="flex flex-col gap-2">
                <label htmlFor="log-date" className="text-sm font-medium">
                  Log activities for
                </label>
                <Input
                  id="log-date"
                  type="date"
                  max={today}
                  value={logDate}
                  onChange={(event) => {
                    if (!event.target.value) return
                    onLogDateChange(event.target.value)
                    setDateOpen(false)
                  }}
                />
                <div className="flex gap-2">
                  <Button type="button" variant="outline" size="sm" onClick={() => (onLogDateChange(today), setDateOpen(false))}>
                    Today
                  </Button>
                  <Button type="button" variant="outline" size="sm" onClick={() => (onLogDateChange(shiftDate(today, -1)), setDateOpen(false))}>
                    Yesterday
                  </Button>
                </div>
              </div>
            </PopoverContent>
          </Popover>
          <span className="ml-auto hidden items-center gap-1 text-xs text-muted-foreground md:flex">
            <Kbd>Enter</Kbd> to send
          </span>
          {busy ? (
            <InputGroupButton type="button" variant="default" size="icon-sm" className="rounded-full" aria-label="Stop" onClick={onStop}>
              <SquareIcon className="fill-current" />
            </InputGroupButton>
          ) : (
            <InputGroupButton type="submit" variant="default" size="icon-sm" className="rounded-full max-md:ml-auto" aria-label="Send message" disabled={!value.trim() || disabled}>
              <ArrowUpIcon />
            </InputGroupButton>
          )}
        </InputGroupAddon>
      </InputGroup>
    </form>
  )
}
