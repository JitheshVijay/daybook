import * as React from "react"
import { ChartColumnIcon, NotebookPenIcon, SparklesIcon, UtensilsIcon } from "lucide-react"
import { groupTurns } from "@/chat-history"
import { useApp } from "@/components/app/app-context"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Bubble, BubbleContent } from "@/components/ui/bubble"
import { Message, MessageContent, MessageHeader } from "@/components/ui/message"
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from "@/components/ui/message-scroller"
import { Spinner } from "@/components/ui/spinner"
import { Composer } from "./composer"
import { ChartCard, PracticeCard, ErrorCard, LoggedCard, QuestionCard } from "./chat-cards"
import { EntryDialog } from "@/components/entry/entry-form"

// Replies are shown as plain text; strip markdown emphasis the model sometimes adds.
const plainText = (text) => text.replace(/\*\*(.+?)\*\*/g, "$1").replace(/__(.+?)__/g, "$1").replace(/^#{1,6}\s+/gm, "")

const SUGGESTIONS = [
  { icon: NotebookPenIcon, text: "Log my day", prompt: "Here's my day: " , fill: true },
  { icon: UtensilsIcon, text: "Log a meal", prompt: "For lunch I had ", fill: true },
  { icon: ChartColumnIcon, text: "How was my week?", prompt: "How was my week?" },
  { icon: SparklesIcon, text: "Protein this week", prompt: "Show my protein this week." },
]

function EmptyChat({ disabled, onPick }) {
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col items-center justify-center gap-6 px-4 py-10 text-center">
      <div className="space-y-2">
        <h2 className="font-heading text-2xl font-semibold tracking-tight">What did you get up to today?</h2>
        <p className="text-balance text-sm text-muted-foreground">
          Describe your day in your own words. Daybook logs workouts, meals, reading, practice, sleep and more, asks about anything missing, and answers questions with charts.
        </p>
      </div>
      <div className="grid w-full gap-2 sm:grid-cols-2">
        {SUGGESTIONS.map(({ icon: Icon, text, prompt, fill }) => (
          <Button key={text} variant="outline" className="h-auto justify-start gap-2 py-3 text-left" disabled={disabled} onClick={() => onPick(prompt, fill)}>
            <Icon data-icon="inline-start" className="text-muted-foreground" />
            {text}
          </Button>
        ))}
      </div>
    </div>
  )
}

export function ChatPage({ chat }) {
  const { aiStatus, today, logEntry, navigate, openEntry, state } = useApp()
  const inputRef = React.useRef(null)
  const [draftPending, setDraftPending] = React.useState(null)
  const disabled = aiStatus !== null && !aiStatus.configured
  const turns = groupTurns(chat.chat.messages).filter((t) => t.user)
  const lastUser = turns.at(-1)?.user

  const [draft, setDraft] = React.useState("")
  const pick = (prompt, fill) => {
    if (!fill) return chat.send(prompt)
    setDraft(prompt)
    requestAnimationFrame(() => {
      const field = inputRef.current
      field?.focus()
      field?.setSelectionRange(prompt.length, prompt.length)
    })
  }

  return (
    <div className="flex h-[calc(100svh-var(--header-height))] min-h-0 flex-col">
      {disabled && (
        <div className="mx-auto w-full max-w-3xl px-4 pt-4">
          <Alert>
            <SparklesIcon />
            <AlertTitle>AI isn’t connected yet</AlertTitle>
            <AlertDescription>
              <p>Add an OpenRouter or OpenAI key to the server’s .env.local and restart Daybook. Insights, Journal and manual logging work without it.</p>
              <div className="mt-2 flex flex-wrap gap-2">
                <Button size="sm" variant="outline" onClick={() => navigate("settings")}>How to connect</Button>
                <Button size="sm" variant="outline" onClick={() => logEntry()}>Log manually</Button>
              </div>
            </AlertDescription>
          </Alert>
        </div>
      )}
      <MessageScrollerProvider autoScroll defaultScrollPosition="end">
        <MessageScroller className="flex-1">
          <MessageScrollerViewport aria-label="Conversation">
            <MessageScrollerContent className="mx-auto w-full max-w-3xl gap-6 px-4 py-6">
              {turns.length === 0 ? (
                <EmptyChat disabled={disabled} onPick={pick} />
              ) : (
                turns.map((turn) => {
                  const replies = turn.replies
                  const texts = replies.filter((m) => m.role === "assistant" && m.content && !(m.synthetic && replies.some((r) => r.card?.kind === "question")) && m.content !== "(finished)")
                  // A card whose waiting items were all re-checked elsewhere has nothing left to show.
                  const cards = replies.filter(
                    (m) => m.card && !(m.card.kind === "logged" && !m.card.mode && !m.card.entries.length && !m.card.pendingIds?.length),
                  )
                  const question = cards.find((m) => m.card.kind === "question")
                  const isLast = turn.user.id === lastUser?.id
                  const status = turn.user.status
                  return (
                    <React.Fragment key={turn.user.id}>
                      <MessageScrollerItem messageId={turn.user.id} scrollAnchor>
                        <Message align="end">
                          <MessageContent>
                            <Bubble variant="secondary" align="end">
                              <BubbleContent className="whitespace-pre-wrap text-sm">{turn.user.content}</BubbleContent>
                            </Bubble>
                          </MessageContent>
                        </Message>
                      </MessageScrollerItem>
                      {(texts.length > 0 || cards.length > 0 || status || (isLast && chat.busy)) && (
                        <MessageScrollerItem messageId={`${turn.user.id}-reply`}>
                          <Message>
                            <MessageContent className="gap-3">
                              <MessageHeader className="px-0">Daybook</MessageHeader>
                              {cards
                                .filter((m) => m.card.kind === "logged")
                                .map((m) => (
                                  <LoggedCard
                                    key={m.id}
                                    card={m.card}
                                    pending={chat.chat.pending}
                                    onUndo={chat.undo}
                                    onDismiss={chat.dismiss}
                                    onFillIn={(item) => setDraftPending(item)}
                                    questionShown={Boolean(question)}
                                  />
                                ))}
                              {texts.map((m) => (
                                <p key={m.id} className="whitespace-pre-wrap text-sm leading-relaxed">
                                  {m.content === "(stopped)" ? <span className="text-muted-foreground">Stopped.</span> : plainText(m.content)}
                                </p>
                              ))}
                              {cards
                                .filter((m) => m.card.kind === "chart")
                                .map((m) => (
                                  <ChartCard key={m.id} card={m.card} />
                                ))}
                              {cards
                                .filter((m) => m.card.kind === "practice")
                                .map((m) => (
                                  <PracticeCard key={m.id} card={m.card} />
                                ))}
                              {question && (
                                <QuestionCard card={question.card} active={isLast && !chat.busy} onAnswer={(answer) => chat.send(answer)} />
                              )}
                              {isLast && chat.busy && (
                                <div className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
                                  <Spinner />
                                  Thinking…
                                </div>
                              )}
                              {status && !chat.busy && (
                                <ErrorCard message={turn.user.error} stopped={status === "stopped"} onRetry={() => chat.retry(turn.user.id)} />
                              )}
                            </MessageContent>
                          </Message>
                        </MessageScrollerItem>
                      )}
                    </React.Fragment>
                  )
                })
              )}
            </MessageScrollerContent>
          </MessageScrollerViewport>
          <MessageScrollerButton />
        </MessageScroller>
      </MessageScrollerProvider>
      <div className="shrink-0 px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-2">
        <Composer
          inputRef={inputRef}
          value={draft}
          onValueChange={setDraft}
          busy={chat.busy}
          disabled={disabled}
          onSend={chat.send}
          onStop={chat.stop}
          logDate={chat.logDate}
          lateNight={chat.lateNight}
          onLogDateChange={chat.setLogDate}
          today={today}
        />
        <p className="mx-auto mt-2 max-w-3xl text-center text-xs text-muted-foreground">
          Food values are estimates unless you give them. Records stay on this device; messages go to your AI provider.
        </p>
      </div>
      {draftPending && (
        <PendingDraftDialog
          item={draftPending}
          state={state}
          onClose={() => setDraftPending(null)}
          onSave={(entry) => {
            chat.completePending(draftPending.id, entry)
            setDraftPending(null)
          }}
        />
      )}
    </div>
  )
}

// Complete a pending item in the manual form (the book/song it names may not be saved yet).
function PendingDraftDialog({ item, state, onClose, onSave }) {
  const merge = (current, extra) => [...current, ...extra.filter((x) => !current.some((c) => c.id === x.id))]
  const reviewState = {
    ...state,
    books: merge(state.books, item.draft.libraries.books),
    songs: merge(state.songs, item.draft.libraries.songs),
    habits: merge(state.habits, item.draft.libraries.habits),
  }
  return (
    <EntryDialog
      open
      onOpenChange={(open) => !open && onClose()}
      state={reviewState}
      entry={item.draft.entry}
      onDraftSave={onSave}
    />
  )
}
