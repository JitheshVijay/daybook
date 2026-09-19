# Daybook

Log your day by chatting, and track it with charts. Tell Daybook what you did in your own words ("benched 3x10 at 50kg, 2 eggs and toast for dinner, read some Deep Work"). It files each activity, estimates calories for food you describe, asks about anything missing, and answers questions about your progress with charts drawn from your saved records.

Built with React 19, Vite 6, Tailwind v4, shadcn/ui, and a local SQLite database. Records stay on this computer.

## Run locally

```sh
npm install
npm run dev -- --host 0.0.0.0 --port 5173 --strictPort
```

Open http://localhost:5173. A phone on the same Wi-Fi can use the network address Vite prints. Local HTTP is for personal use; there is no authentication.

## The app

- **Chat** (home). One conversation, like ChatGPT or Claude.
  - What you report is saved as entries and shown as a card. Undo reverts the whole batch. Tap an entry to edit it.
  - A gym session becomes one workout and a meal one food entry. Complete exercises and foods save right away, and only the gaps become one grouped question ("Leg press: how many reps in each set?"). Your answer is added to the same workout or meal. Workouts never need a duration. Waiting items can also be filled in with the manual form or skipped.
  - You never count calories. Foods without numbers are looked up automatically from your words ("2 big pieces of fried fish", "rice") and saved labelled Estimated, with the assumed portion. The manual food form has an **Estimate calories** button too. You're only asked about food if the lookup fails, and a meal still waiting is estimated the next time you open the app.
  - Numbers must come from you. If an answer leaves one out ("Hip adduction - reps"), that exercise isn't saved with a guess; Daybook asks again.
  - Guitar: "I wanna practice John Mayer's Neon" adds the song to your practice list with album art from iTunes. "Practiced Blackbird for 20 minutes, it was rough" logs a session with a rating (Couldn't play it, Rough, Solid, Clean). "What should I practice?" returns today's plan.
  - Reading positions: "read till page 51 and finished 11 chapters" or "from page 29 to 40" is converted into that session's pages and chapters, so the book ends up exactly there. "I've read 11 of 92 chapters, not 17" corrects the book itself, with Undo.
  - Reading: "add to my reading list: Atomic Habits, Deep Work" adds books as "Want to read" with covers from Open Library, without logging pages. Logging reading for a book on the list moves it to "Reading".
  - Habits: "track if I brush my teeth at night" sets up a yes-or-no habit, and "brushed my teeth before bed" logs it. In the Journal, yes-or-no habits are checked off with one tap.
  - Corrections ("make that 50kg") update the saved entry and show what changed. Restating a whole meal ("the calories are wrong, I actually had a big plate of red rice, …") replaces its foods and re-estimates them.
  - Questions about your data ("protein this week?") return numbers and charts computed locally from your records.
  - Pick a different day to log with the date chip in the composer.
- **Insights.** Mixpanel-style dashboards for Training, Nutrition, Steps, Sleep, Screen time, Reading, Guitar, Mind, and Habits.
  - The Guitar tab shows **Practice today**, a retention forecast per song, and a practice list sorted by risk. Each rated session updates an FSRS-5 spaced-repetition memory model (published default parameters, fitted to flashcard data rather than instruments). A song comes back when its estimated retention falls to 90%. Unrated sessions count as Solid.
  - Each tab has 7, 30, and 90-day ranges and can step through earlier periods.
  - Tiles show total, average per logged day, best day, and change against the previous period.
  - Goal lines appear where you've set a goal. Breakdowns include calories by meal, macros, sets by muscle with a body heatmap, exercise history, book progress, setlist, meditation quality, and dreams.
  - Days without entries count as missing, not zero.
- **Journal.** Month calendar, day totals, every entry, habits. Edit, delete, log again, or plan ahead.
  - A logging heatmap covers up to the last year. Each day is shaded by how many of your daily trackers you logged, and the darkest shade is a full day. It shows full days, the current streak, and days with entries. "Full day" chooses which trackers count; the default is the daily kinds you log, such as food, sleep, steps, screen time, meditation and habits. Tap a day to open it.
- **Settings.** Profile and goals, theme, custom habits, AI connection status, backup and restore.
- **Manual logging.** Available everywhere through "Log manually". It covers all 11 activity types, including sets, saved routines, favourite meals, and creating books, songs, and habits inline.

## Data storage

Records and the conversation live in a SQLite database on the computer running Daybook: `data/daybook.db` by default, or set `DAYBOOK_DB` to another path. Every browser and tab on that computer shares it, and clearing browser data doesn't touch it.

- **Saving.** Each change is saved right away as the records that changed. The database checks the whole record set with the app's validation before writing, so an invalid change is refused and nothing partial is stored.
- **When the server is unreachable.** Changes are kept in the browser, shown as "Not saved to the database yet", and saved when it's back, even after a reload.
- **Moving in.** The first time a browser with data opens the app, its localStorage data (`daybook.v1`, `daybook.chat.v1`) is copied into an empty database. The browser copy is left in place.
- **Other devices.** The database API only answers requests from the computer itself. There is no login, and the dev server also listens on the network. Phones or other devices opening the network address keep using their own browser storage, as does the static Sites build.
- **Backups.** Settings still exports and restores backup files. To back up the database itself, copy `data/daybook.db` while Daybook is stopped.

## AI connection

Copy `.env.example` to `.env.local`, fill in one option, and restart the dev server.

```sh
OPENROUTER_API_KEY=sk-or-...
OPENROUTER_MODEL=openai/gpt-4o-mini
```

OpenAI directly works too (`OPENAI_API_KEY`, `OPENAI_MODEL`, optional `OPENAI_BASE_URL` for other compatible servers). Use a model that supports tool calling. `openai/gpt-4.1-mini` follows the logging rules more reliably than `openai/gpt-4o-mini` in live tests, at roughly 2.5 times the price. Keys stay on the server; never prefix a secret with `VITE_`.

How it works:

- `POST /api/chat` is stateless. It adds the system prompt and tool definitions, makes one provider call, and returns the model's reply or tool calls.
- The browser runs the tools against local data: log entries, update or delete entries, query numbers or charts, list entries, ask a question, undo. It then sends the results back, up to four calls per message.
- The app decides what counts as complete, so incomplete items are never saved. Repeated activities in one message are saved once. The model's quoted source text is checked against what you wrote.
- Each call sends your messages, today's entries (without notes), goals, book, song, and habit names, a 7-day summary, and pending questions. Journal notes and dream text are not sent. OpenAI direct requests use `store: false`. Provider retention policies still apply.

Without a key, Insights, Journal, and manual logging work normally and the chat explains how to connect.

## Verification

```sh
npm test                 # unit and API tests with a simulated provider
npm run test:browser     # needs the dev server on localhost:5173; mocks /api/chat and never touches the real database
npm run build
npm run test:sites
node scripts/chat-smoke.mjs   # optional live run against your configured model (in-memory data)
```

Screenshots from the browser suite are written to `qa/`. See `design-qa.md` for the latest visual and live-model checks.

## External services and assets

- Book metadata and covers: [Open Library](https://openlibrary.org/developers/api).
- UI: [shadcn/ui](https://ui.shadcn.com), Radix, lucide icons, Geist fonts (bundled locally).
- Charts: Recharts through shadcn `chart`. Body heatmap: `react-body-highlighter`. It counts sets and is not a recovery or medical measure.

## Not included

Cloud sync and accounts, automatic step or screen-time import, barcode or photo food lookup, notifications, offline install, voice input, and token-by-token streaming.
