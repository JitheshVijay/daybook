# Daybook design and interaction QA

final result: passed (automated suites green; live model checks below)

## Current design: chat-first, shadcn/ui (September 13, 2026)

The user asked for one ChatGPT/Claude-style conversation instead of the two-mode assistant, with per-feature charts "like Mixpanel", calorie estimates from described food, and follow-up questions for missing details. They then chose "make it like shadcn" over three custom visual directions. The earlier charcoal/lime mock and its QA history no longer describe the app; they are summarised at the end.

### Visual system

- shadcn/ui radix-nova style, neutral theme, Tailwind v4, lucide icons, Geist and Geist Mono bundled locally.
- Light and dark follow the system; Settings and the account menu override it.
- Charts use shadcn `chart` on Recharts. The categorical series colours in `src/index.css` (`--chart-1…5`) were checked with the dataviz palette validator. Light mode on #ffffff passes every gate: worst adjacent CVD ΔE 9.1 and normal-vision ΔE 19.6. It warns that three slots sit below 3:1 contrast, so charts carry legends, tooltips, and a screen-reader table. Dark mode on #171717 and #0a0a0a passes every check.
- Legends follow stack order. Days without entries render as gaps with "No entries" in tooltips, never as zero bars.

### Layout

- Shell: shadcn `sidebar`, expanded at 1024px and up, icon rail from 768 to 1023px, off-canvas sheet below 768px.
- The previous overflow between 680 and 1000px is gone. The automated sweep checks `scrollWidth <= innerWidth` on Chat, Insights, Journal, and Settings at 360, 390, 700, 900, 1200, 1440, and 1728px.
- Screenshots in `qa/`:
  - `chat-{390,900,1440}.png`
  - `insights-{390,900,1440}.png`
  - `journal-{390,900,1440}.png`
  - `settings-{390,900,1440}.png`
  - `dark-chat-390.png` and `dark-insights-nutrition-390.png`
- Inspected by eye at those widths.
- Fixes made during inspection:
  - Entry rows showed raw ISO dates.
  - Summaries said "1 exercises" and "1 foods".
  - The calendar grew too tall on tablets.
  - Breakdown cards stretched to match the tall muscle map.
  - Legends were ordered alphabetically instead of by stack.
  - The pending question appeared twice when answer chips were shown.
  - Update cards showed an unchanged "Was" line; they now list the real change, e.g. "3×10 @ 40 kg → 3×10 @ 50 kg".
- Bundle: Insights, Journal, and Settings load on first visit, and chart code loads when the first chart appears. Initial JavaScript is 580 kB (180 kB gzip), down from 1.04 MB.

### Automated verification

| Suite | Result |
|---|---|
| Unit and API (`npm test`) | 58 passed |
| Browser (`npm run test:browser`) | 14 passed |
| Sites packaging (`npm run test:sites`) | 4 passed |
| Production build | passed |

Browser tests mock `/api/chat` with scripted tool calls and cover:

- A logged batch with a pending item and undo.
- Tappable answers resolving a pending item.
- Completing a pending item in the manual form.
- Chart cards computed from saved records that open the matching Insights tab.
- A provider failure that saves nothing, then retry and reload persistence.
- The not-connected state.
- Manual logging, editing and deleting in Journal, and backup restore.
- Inline book and habit creation.
- Unreadable storage preserved untouched.
- Insights tabs, ranges, heatmap, and book progress.
- Honest empty states.
- The width sweep and dark mode.

### Live model checks (OpenRouter)

Run in isolated browser profiles against the real endpoint; no user storage was touched.

- `openai/gpt-4o-mini`, four-message conversation through the UI:
  - Logged a workout and marked the reading as pending, with chips "5 / 10 / 15 / 20 pages".
  - The answer "20 pages" saved one reading entry.
  - "Actually the bench was 50kg" updated the workout in place.
  - "30 minute run and a chicken burrito for lunch" logged the run plus an estimated 500 kcal lunch.
  - No duplicates, no page errors, about 4–6 seconds per message.
- Found and fixed in the live runs:
  - The model sometimes split one message across repeated log calls, which created duplicate pending items and entries. The app now saves each activity once per turn and merges matching pending items.
  - It sometimes skipped estimating a named dish. The tool result now tells it to retry with an estimate unless the amount is vague.
  - OpenRouter rejected `parallel_tool_calls` for this model, so the flag is only sent to OpenAI directly.
- Remaining model-quality notes:
  - gpt-4o-mini occasionally adds an inaccurate aside, such as calling reading details "estimates".
  - `openai/gpt-4.1-mini` handled the same script more cleanly in a side-by-side smoke run.
  - The app never saves anything the model invents: amounts are validated locally and numbers in charts come from saved records.

### Fix: gym sessions shown as many "Fill in" rows (September 13, 2026)

The user logged a detailed gym session and meal. The card said "Logged 1 activity · 7 need details" with a "Fill in" button per exercise. Replaying the exact message against the live model found these causes:

- **Duration rule.** The app required a workout duration. It no longer does.
- **One workout per exercise.** The model split the session this way. The app now merges them into one workout, and pulls exercises out of a cardio entry when the model puts them there.
- **All-or-nothing saving.** A workout or meal was held back when any exercise or food lacked details. Complete parts now save immediately, and only the gaps wait, grouped into one item with specific questions. The follow-up answer is added to the same entry.
- **Tool-call limit.** Replies with more than four tool calls were rejected, and a reply with one call per exercise could fail outright. The limit is now 24 calls per reply, and several log calls in one reply run as one.
- **Unestimated food.** When foods have no calories, the model is sent back once to estimate them. That retry accepts only food, so it can't re-log the workout with invented reps.
- **Duplicates across messages.** A workout or meal logged again joins the existing entry and never overwrites saved values. Past-tense entries the model marks "planned" become done. Updates merge exercises and foods by name instead of replacing the list.
- **Skipped answers.** Details the user gave but the model left out get sent back once.
- **Card and reply.** Manual fill-in is now a small icon, the grammar is fixed, and bold markers are removed from replies.

Verification:

- 58 unit tests, including a replay of the reported message's shape.
- 14 browser tests, including the gym-session flow.
- The production build and the Sites packaging tests.
- Four live runs of the exact two-message conversation through the UI with `openai/gpt-4o-mini`. All ended with one cardio entry, one meal with four estimated foods, and one workout with all seven exercises, with nothing left waiting.

Remaining model limits:

- gpt-4o-mini sometimes adds up plate increments wrongly (e.g. 40/70/80/90 instead of 40/70/90/100). The saved values can be corrected in chat.
- Its reply text sometimes overstates what was saved. The card is always accurate.

### Fix: calories fetched automatically, and made-up reps refused (September 13, 2026)

The user asked for calories to be fetched because they don't count them. They then reported that an answer missing one number ("Hip Adduction: how many reps in each set? - reps") was saved without a follow-up question, and that the reply claimed nutrition was saved when it wasn't.

Replaying the conversation live found:

- **Made-up reps.** The model filled in 12 reps for hip adduction, copied from the other answers, and the app accepted it. Numbers for a waiting exercise now have to appear in the part of the message about that exercise. Otherwise the exercise keeps waiting and the model is told to ask again.
- **Food waiting on the user.** Foods without calories were questions for the user, and the model's reply could claim they were saved. The app now estimates them itself through a dedicated nutrition call, before the model replies.
- **Per-serving mix-up.** Fried fish was stored as 3 servings at 600 kcal each, because a total for the whole portion was treated as one serving. The nutrition call now returns totals, and the app divides by servings.

Verification:

- 65 unit tests, including the user's exact answer, the clause matching, nutrition merging, and a failed nutrition call.
- 16 browser tests, including automatic estimates in chat, the Estimate calories button, and a saved conversation whose waiting food is estimated on the next visit.
- The production build and the Sites packaging tests.
- Two live runs of the gym-and-food message followed by the answer with the missing number. Both times the model again tried 12 reps, the app refused it, and the reply asked for hip adduction reps. Answering "12 reps" completed the workout. Fried fish came to 430–610 kcal in total instead of 1,800.

### Fix: adductors missing from the muscle map, and food still not saved (September 13, 2026)

The user's Nutrition tab was still empty and the front muscle map showed no adductor sets.

- **Muscle picked by the model.** Hip adduction and abduction were saved with the model's muscle choice. The app's own mapping now wins for exercises it recognises, using whole-word rules so names like "Cable woodpecker" aren't mistaken for chest. Workouts the assistant already saved are repaired once when the app loads.
- **Body chart labels.** react-body-highlighter only draws "adductor" on the back view, and its front inner-thigh area is named "abductors". Adductor sets now light the inner thigh on both views. Hip abductor sets count toward the glutes, since the chart has no outer-hip area. Screenshots of each muscle alone confirmed the placement.
- **Re-checked gaps became separate entries.** Waiting items re-checked a second time lost their link to the saved workout or meal, which would have created a second meal. They now re-join the saved entry, and waiting foods are estimated into it.

Verification: 67 unit tests, 17 browser tests (including the muscle map on both views), the build, and the Sites tests.

### Fix: calorie estimates too low (September 13, 2026)

The user's lunch was saved at 995 kcal. What they actually ate was a big plate of red rice, two whole fried Pink Perch, two fried eggs, a big piece of fish in curry, and a spoon of potato curry.

- **Vague first description.** The first message said only "potato and rice", so the estimator assumed a cup of rice and one potato.
- **Low estimates even with detail.** Given the full description, the old estimator still returned 1,350 kcal, treating a big plate of rice as 1.5 cups. It now returns grams eaten plus standard per-100 g values, and the server does the multiplication, with guidance for generous home portions. The same meal now comes to 1,830–1,950 kcal across two runs, against a reasoned 1,700–2,100.
- **Corrections added to the old foods.** A correction merged foods by name, so the old rice and potato would have stayed alongside the new foods. A restated meal now replaces the list and is re-estimated before saving.

Verification: 68 unit tests (including the user's correction), 17 browser tests, the build, the Sites tests, and two live correction runs from a 995 kcal lunch that ended at 2,002 and 1,995 kcal.

### Fix: old estimate still shown after refresh (September 13, 2026)

The user refreshed and still saw 995 kcal. That meal was saved at 16:13, before the new estimator went live at 16:17, and a refresh doesn't change saved entries. Meals estimated earlier are now estimated again once when the app loads, from the message that logged them, and shown as an update card with Undo. The model's own food guesses in a log also go through the app's estimator now. A live preview for the user's logged message gave 1,885 and 1,935 kcal.

Verification: 69 unit tests, 18 browser tests (including the one-time re-estimate with Undo), the build, and the Sites tests.

### Feature: guitar practice list, album art, and retention-based recommendations (September 13, 2026)

The user asked for songs they practice or want to practice to be saved with fetched covers, a list of what to practice, and recommendations from a retention algorithm.

- **Songs and covers.** "I wanna practice John Mayer's Neon" calls `add_songs`, which adds the song as "Want to learn" without logging time. Album art comes from the iTunes Search API, which allows browser requests. A cover is saved only when the title matches, and the artist matches too when the song has one. Songs without covers are looked up once per visit.
- **Ratings.** A session is rated Couldn't play it, Rough, Solid, or Clean. The assistant maps "it was rough" to a rating, or asks with tappable answers. The manual form has "How did it go?".
- **Model.** FSRS-5 with its published default parameters. Retention is (1 + 19/81 · t/S)^-0.5, stability grows after spaced successful reviews, and difficulty moves with ratings. The defaults come from flashcard data, and the UI says so.
- **Plan.** Songs past their review date come first, lowest estimated retention first. Then one new song, or two when nothing is due. The plan allows one song per 5 minutes of the daily goal, with minutes split by difficulty.
- **UI.** The Guitar tab has Practice today, a Retention forecast chart for the song with the lowest retention (with a song picker and a 90% review line), and a Practice list. Chat shows an added-songs card with album art and Undo, plus a practice plan card.

Verification: 74 unit tests (the FSRS updates, plan order, song tools, rating guidance, and cover matching), 19 browser tests (including the full chat-to-Guitar-tab flow), the build, the Sites tests, screenshots at 1440 px light and 390 px dark with no horizontal overflow, and a live run with `openai/gpt-4o-mini`. In that run, add_songs was called for Neon, "it was rough" was saved as Rough, and practice_plan put overdue Gravity (73%) before new Neon.

### Fix: song covers not found (September 13, 2026)

Four wishlist songs came back with only one cover. "Just the Two of Us" and "Aruvian Dance" had no artist, and the lookup skipped titles recorded by several artists. "Aruvian Dance" is really "Aruarian Dance" by Nujabes, so an exact title match failed. "Billie Jean" had the artist MAIKA, which iTunes doesn't have. Taking iTunes' top result wasn't safe: a search for "Neon" ranks an artist called Shadow first, and exercise names like "Pentatonic riff" match random tracks.

Covers now need an artist. The assistant fills in well-known artists when songs are added. Other songs without an artist are identified by the model from the recordings iTunes returned, with typos corrected, and exercises are left without a cover. An artist the user gave is kept, and the song's best-known art is shown if iTunes lacks that artist. A live run of all eight titles gave the right song or no cover every time. Verification: 75 unit tests, 19 browser tests, the build, and the Sites tests.

### Feature: reading wishlist in chat (September 13, 2026)

Before this change, "add to my reading list: atomic habits, deep work, psychology of money" put the books into the guitar song list, and the reply said they were on the reading list. The new `add_books` tool adds books as "Want to read", with authors filled in for well-known books and covers from Open Library. Titles now match whatever the punctuation, a leading "The", or a subtitle. A live run filled every author, split a mixed "practice Neon and read Sapiens" message across both tools, and linked "20 pages of the psychology of money" to the saved book. Starting a book or song moves it off the wishlist. Verification: 76 unit tests, 20 browser tests, the build, and the Sites tests.

### Fix: leg press heaviest set 70 kg instead of 100 kg (September 13, 2026)

The message said "1st set of 40 kg, 2nd i added 2 plates 15kg, 3rd set i added 2 plates 10kg, then 4th set i added 2 plates of 5 kg", which is 40, 70, 90 and 100 kg. The saved session, logged before the number checks existed, had the model's arithmetic of 40, 70, 20 and 10 kg. With the checks, the model left those weights empty and asked for them again. It also sometimes left out the hip abduction and adduction weights of 60 kg.

The app now works out build-up weights itself from each exercise's clauses, and fills a single stated weight into empty sets. Exercise names in the message tolerate typos, and corrections keep saved reps. Live, the exact message twice gave leg press 40, 70, 90 and 100 kg, with only the reps asked for. "The sets were 40, 70, 90 and 100 kg" corrected a saved 40/70/20/10 session and kept its reps. Verification: 80 unit tests, 20 browser tests, the build, and the Sites tests.

### Fix: leg press counted as 6 sets (September 13, 2026)

After the plate-maths fix, the user saw their leg press counted as six sets. Their browser data can't be read from here, and live corrections replayed against their likely saved workout always kept four sets. The replays did find two other bugs. The model sometimes marked a one-exercise correction as the whole workout, which removed every other exercise, and it sometimes changed reps the user hadn't mentioned. The six sets most likely came from the model repeating sets, which the merge keeps whenever the numbers differ.

Guards added:
- A stated set count drops repeated sets.
- A correction can't add repeated sets unless the user reports more.
- A partial "replace" keeps the other exercises.
- Reps and weights the user didn't correct keep their saved values.
- Exercise history shows the number of sets per session.

Live, a saved six-set leg press (40, 70, 20, 10, 90, 100) went back to four sets (40, 70, 90, 100) in all four runs of two phrasings, with every other exercise kept. Verification: 82 unit tests, 20 browser tests, the build, and the Sites tests.

### Fix: sleep durations not calculated from times (September 13, 2026)

"I slept at 3 am … woke up at 8:40 am. then i took a nap at 3:30 pm then woke up at 6:40" came back as two items waiting for "How long did it last, in minutes?". The tool only had a start time, the model is told not to invent durations, and sleep needs minutes, so nothing did the arithmetic. Entries now have an end time. The model fills in both times, and the app computes the minutes, wrapping past midnight. Three live runs saved Sleep at 340 minutes and Nap at 190 minutes with nothing asked. Verification: 83 unit tests, 20 browser tests, the build, and the Sites tests.

### Feature: Journal logging heatmap (September 13, 2026)

The user asked for an activity heatmap based on whether every entry was logged. The Journal now opens with a year-style grid: up to 53 weeks, as many as fit, with cells at least 12 px that grow to fill the card. Each day is shaded by the share of daily trackers logged, and hovering or tapping a day lists what was logged and what's missing. Arrow keys move between days, and "Full day" sets which trackers count. Screenshots at 1440 px light and 390 px dark (19 weeks) had no horizontal overflow. Verification: 84 unit tests, 21 browser tests (including tapping a day, arrow keys, and changing the trackers), the build, and the Sites tests.

### Removed: work tracker (September 14, 2026)

The user asked to remove Work because they can't really measure or log it. It's gone from the chat, the logging form, Insights and the assistant's context. Old work entries still load and can be deleted from the Journal. The night teeth-brushing habit below stays.

### Feature: work tracker (since removed) and a night teeth-brushing habit (September 13, 2026)

Work is a new activity with three kinds: office, outside office, and personal project. Each entry has a project and minutes. The Insights tab has a stacked daily chart, time by project, and where you worked, and chat charts support it. The teeth-brushing tracker is a yes-or-no habit set up in chat with `add_habits`, logged from phrases like "brushed my teeth before bed", and checked off in the Journal with one tap.

A live run with `openai/gpt-4o-mini` covered five messages:
- "office from 10 am to 6:30 pm on the payments dashboard … my daybook app from 9 to 11 pm" gave Payments dashboard, office, 510 minutes, and Daybook app, personal, 120 minutes.
- "track if i brush my teeth at night" created the "Brush teeth at night" habit, once a day.
- "brushed my teeth before bed" logged it.
- "client emails from home for 40 minutes" was logged as outside office.
- "how much did i work today? show a chart" charted 670 minutes.

Verification: 86 unit tests, 22 browser tests, the build, and the Sites tests.

### Fix: book progress from stated positions (September 13, 2026)

The book started at 28 pages and 6 chapters read before Daybook, with one 11-page session. "I read how to talk to anyone till 51 pages and finished 11 chapters" was turned by the model into amounts (22 pages, 11 chapters) and added to that start, so the book showed 50/321 pages and 17/92 chapters. "I read 11/92 chapters not 17/92" then sent the same values, changed nothing, and still showed "Updated entry" with a reply claiming a fix.

The fix has four parts:
- The model now records stated positions in `toPage`, `fromPage` and `chaptersFinished`.
- The app converts them into session amounts using the book's progress.
- `update_book` corrects the book directly.
- A correction that changes nothing says so, without a card.

Live results:
- The correction went from 17 to 11 of 92 chapters, twice.
- "till 51 pages and finished 11 chapters" gave 51/321 pages and 11/92 chapters, twice.
- A later "now i'm on page 60" gave 60 pages.

Verification: 89 unit tests, 23 browser tests, the build, and the Sites tests.

### Fix: waiting meditation not saved after the rating was given (September 14, 2026)

At 00:0x, "i meditated for 5 minutes today" was logged as 14 September and waited for a rating. The follow-up "5 minutes of september 13th not september 14th. it was 1 out of 5" saved nothing, and the reply asked for the rating again.

Live replays showed four problems:
- The model aimed update_entry at the waiting item's id, which failed.
- A separate log with the new date didn't clear the waiting item.
- In one reply the model sometimes did both, then re-logged, saving the meditation twice.
- Just after midnight, "today" meant the day that had just ended.

Fixes:
- update_entry on a waiting item completes it.
- A log of the same activity on another date clears the waiting item.
- An item completed earlier in the reply isn't saved again.
- The logging day now runs until 4 am.

Four live runs each saved one meditation on 13 September, rated 1/5, with nothing waiting. Verification: 91 unit tests, 24 browser tests (including a fixed clock at 00:30), the build, and the Sites tests.

### Fix: "yesterday" logged two days back (September 14, 2026)

With the date chip on Yesterday (13 September), "i had one more friend egg yesterday" was saved on 12 September. The prompt told the model to count relative days from the picked date, so it went back one day from that date. The card still said "Sun 13 Sept", because it showed the picked date instead of the saved one. Relative days now count from the real date, and the app corrects the model from each entry's own words. Cards show the saved dates. Three live runs saved the egg on 13 September; in one the model sent the 12th and was corrected. Verification: 92 unit tests, 24 browser tests, the build, and the Sites tests.

### Fix: a "move" request deleted an unrelated entry (September 14, 2026)

"move the fried egg from September 12th to September 13th" made the model delete an entry and log the egg again. It deleted the user's Sleep entry. In live replays it deleted the whole 13 September lunch twice and never moved the egg. The model couldn't see the 12 September egg, which was outside the chosen day, and nothing checked what it deleted. The earlier "one more fried egg … meaning 13th not 12th" was also dropped as a duplicate, because the lunch already had "eggs, fried".

Fixes:
- Deletes need delete wording and an entry matching the user's words.
- Moves are date changes on the existing entry.
- The model sees entries from the last 3 days with ids.
- Correction wording moves the recently logged entry.
- "One more" isn't merged away.

Live results:
- Three runs with a copy of the user's entries deleted nothing and moved the one egg to 13 September, still 1 serving at 98 kcal.
- A genuine "delete the fried egg from september 12th, i logged it by mistake" deleted only that egg.

Verification: 94 unit tests, 24 browser tests, the build, and the Sites tests.

### Fix: "move the fried egg" edited the wrong meal (September 14, 2026)

After the delete guard, the same move request made the model update the 13 September dinner: it added a fried egg and renamed the dinner "Food". The egg on 12 September stayed where it was, so the chart still showed it. The app now reads "from <day> to <day>" itself. It refuses edits to an entry on another day, pointing to the right entry, changes only the date on a move, and never swaps a name for a generic one. Four live runs with a dinner like the user's moved only the 12 September egg to the 13th, and dinner was untouched. Verification: 95 unit tests, 24 browser tests, the build, and the Sites tests.

### Fix: move requests handled by the app (September 14, 2026)

After Undo on the wrong dinner edit, "move the fried egg from September 12th to September 13th" made gpt-4o-mini try undo_batch, which was refused, and claim the egg was already on the 13th. It was misled by its own earlier replies in the history. A request that names both days and matches exactly one entry on the first day is now done by the app without the model: a date-only update with a card, Undo, and an exact reply. A browser test with no model replies available moved the egg and undid it. A live run replied "Moved Food (98 kcal · 1 food) from Sat 12 Sept to Sun 13 Sept." with dinner untouched. Verification: 96 unit tests, 25 browser tests, the build, and the Sites tests.

### Feature: local SQLite database instead of browser storage (September 14, 2026)

Records and the conversation moved from localStorage to `data/daybook.db`, served only to the computer running Daybook. End-to-end check on an isolated server (port 5199, throwaway database):
- 110 fixture entries, a book and a chat moved in from a browser's storage.
- A second empty browser saw them.
- A save from the second browser reached the database and showed in the first within a second, without reloading.
- With saves blocked, the notice appeared and the change was kept, then saved once unblocked.
- An unsaved change survived a reload.
- No page errors.

The regular browser suite blocks the database API through a shared fixture and adds a database-mode test against a stand-in server. When the plugin went live, the user's open tab moved their data in: 19 entries, 3 books, 8 songs, 2 habits, goals, and an 86 KB conversation. A request from the computer's network address was refused. Verification: 98 unit tests (including a temporary-file database and API test), 26 browser tests, the build, and the Sites tests.

### Fix: gram amounts in food messages (September 15, 2026)

"today i ate 250 gm broasted chicken, 1 kuboos, 1 porotta and 50 gm hummus." saved nothing and asked for calories for all four foods. The model had logged 250 and 50 servings, and the nutrition endpoint refused the whole request because of them. Gram and millilitre amounts now become one serving of that amount, both before the estimate and when logging, and the endpoint ignores an amount it can't use instead of failing. Foods already stuck this way are estimated on reload from the message that logged them. Two live gpt-4o-mini replays of the exact message saved all four foods with no questions (1,226 and 1,425 kcal; chicken 550–625, hummus 80–100). Verification: 101 unit tests (including the real message, a lookup outage, counts that stay counts, and the reload fill), 26 browser tests, the build, and the Sites tests.

### Fix: chat logs lost on the way to the database (September 15, 2026)

The user's back workout from September 14 (5 exercises, 15 sets), its 5-minute cardio, and a 37 kcal kombucha from September 15 showed as saved in the chat, but they were missing from the database and disappeared after a reload. Cause: a race in the save queue. A conversation save that was still on its way was replaced by a newer one, which moved the entry change to the front of the queue, and the finished request then removed that change instead of itself. Each request now removes only what it sent. The three entries were rebuilt from the recorded tool calls with the app's own logging code: same ids, "15 sets · 5 exercises", "5 min", "37 kcal". Afterwards, every entry shown on a chat card is in the database. A new browser test (slow conversation save while a workout, cardio and food are logged) fails with the old queue and passes with the fix. Verification: 101 unit tests, 27 browser tests, the build, and the Sites tests.

## Earlier history (superseded UI)

September 12–13, before the redesign:

- A charcoal/lime dashboard built from `~/Downloads/daybook-option-2.png` passed its own mock comparison and browser suites.
- A UX pass added inline book, song, and habit creation, sticky modal footers, a first-run card, and journal pagination.
- A paragraph-to-trackers "Log my day" flow was verified with a simulated provider.

Those pages were removed in the chat-first rebuild. Their behaviours live on in the chat, Journal, and manual forms.
