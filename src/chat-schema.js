// Tool definitions for the chat assistant. Imported by the server (sent to the model)
// and by the browser (argument validation before anything touches local data).
import { BOOK_STATUSES, SONG_STATUSES, TYPES } from "./domain.js";
import { extractionSchema } from "./day-import.js";
import { METRIC_KEYS, RANGES } from "./insights.js";

const nullable = (schema) => ({
  ...schema,
  type: [schema.type, "null"],
});
const object = (properties) => ({
  type: "object",
  properties,
  required: Object.keys(properties),
  additionalProperties: false,
});

const baseEntry = extractionSchema.properties.entries.items;
export const chatEntrySchema = object({
  ...baseEntry.properties,
  resolves: nullable({ type: "string", maxLength: 40 }),
});

export const logEntriesSchema = object({
  entries: { type: "array", items: chatEntrySchema, maxItems: 50 },
});
export const queryDataSchema = object({
  metric: { type: "string", enum: METRIC_KEYS },
  habit: nullable({ type: "string", maxLength: 200 }),
  range: { type: "string", enum: RANGES },
  from: nullable({ type: "string", maxLength: 10 }),
  to: nullable({ type: "string", maxLength: 10 }),
  groupBy: { type: "string", enum: ["day", "week", "total"] },
  chart: { type: "string", enum: ["none", "bar", "line"] },
});
export const listEntriesSchema = object({
  type: { type: "string", enum: ["all", ...TYPES] },
  range: { type: "string", enum: RANGES },
  from: nullable({ type: "string", maxLength: 10 }),
  to: nullable({ type: "string", maxLength: 10 }),
  limit: { type: "number", minimum: 1, maximum: 30 },
});
export const askUserSchema = object({
  question: { type: "string", maxLength: 300 },
  options: {
    type: "array",
    items: { type: "string", maxLength: 60 },
    maxItems: 4,
  },
});
export const undoBatchSchema = object({
  batchId: { type: "string", maxLength: 64 },
});
export const updateEntrySchema = object({
  id: { type: "string", maxLength: 100 },
  changes: chatEntrySchema,
  replaceList: { type: "boolean" },
});
export const addSongsSchema = object({
  songs: {
    type: "array",
    maxItems: 20,
    items: object({
      title: { type: "string", maxLength: 300 },
      artist: nullable({ type: "string", maxLength: 300 }),
      status: { type: ["string", "null"], enum: [...SONG_STATUSES, null] },
    }),
  },
});
export const addBooksSchema = object({
  books: {
    type: "array",
    maxItems: 20,
    items: object({
      title: { type: "string", maxLength: 300 },
      author: nullable({ type: "string", maxLength: 300 }),
      status: { type: ["string", "null"], enum: [...BOOK_STATUSES, null] },
    }),
  },
});
export const addHabitsSchema = object({
  habits: {
    type: "array",
    maxItems: 10,
    items: object({
      name: { type: "string", maxLength: 200 },
      unit: nullable({ type: "string", maxLength: 50 }),
      goal: nullable({ type: "number", minimum: 0, maximum: 100000 }),
    }),
  },
});
export const updateBookSchema = object({
  title: { type: "string", maxLength: 300 },
  author: nullable({ type: "string", maxLength: 300 }),
  pagesRead: nullable({ type: "number", minimum: 0, maximum: 100000 }),
  chaptersRead: nullable({ type: "number", minimum: 0, maximum: 10000 }),
  totalPages: nullable({ type: "number", minimum: 0, maximum: 100000 }),
  totalChapters: nullable({ type: "number", minimum: 0, maximum: 10000 }),
  status: { type: ["string", "null"], enum: [...BOOK_STATUSES, null] },
});
export const practicePlanSchema = object({
  limit: { type: "number", minimum: 1, maximum: 10 },
});
export const deleteEntriesSchema = object({
  ids: { type: "array", items: { type: "string", maxLength: 100 }, maxItems: 20 },
});

export const CHAT_TOOLS = [
  {
    name: "log_entries",
    description:
      "Save activities the user reports into their Daybook, all in one call. One gym session is one workout entry with all its exercises; one meal is one food entry with all its foods. Include partially specified activities with null for unknown values: the app saves what is complete (including the complete exercises or foods of a workout or meal) and returns the rest in needsDetails with the exact questions to ask. To complete a needsDetails item, send just its missing parts with resolves set to its id. Never claim anything was saved except what this tool returns in `logged`.",
    parameters: logEntriesSchema,
  },
  {
    name: "query_data",
    description:
      "Compute numbers from the user's saved records: totals, per-day values, best day, and the previous period for comparison. Set chart to 'bar' or 'line' to show the same numbers as a chart in the conversation. Use this for any question about their data or progress; never estimate their numbers yourself.",
    parameters: queryDataSchema,
  },
  {
    name: "list_entries",
    description:
      "List saved entries (newest first) with a short summary each, for questions like 'what did I do yesterday' or 'which books did I read this week'.",
    parameters: listEntriesSchema,
  },
  {
    name: "ask_user",
    description:
      "Ask one short clarifying question with 2–4 tappable answer options when the missing detail has a few likely answers (e.g. reading amount, meal portion). The conversation pauses until the user replies. For open-ended details, just ask in your reply instead.",
    parameters: askUserSchema,
  },
  {
    name: "update_entry",
    description:
      "Correct an entry that is already saved (e.g. 'make that 30 minutes', 'it was 50kg', 'that was lunch, not dinner'). Use the entry id from entriesOnLogDate or list_entries. In changes, set only the fields that change and leave every other field null or empty. With replaceList false, exercises or foods listed in changes replace the ones with the same name or are added, and the others stay. Set replaceList true when the user restates the whole workout or meal ('what I actually ate was…'): the listed exercises or foods become the complete list. Leave food nutrition null unless the user states it; the app estimates it. The type cannot change. Use this instead of log_entries whenever the user is adding detail to or fixing something already logged.",
    parameters: updateEntrySchema,
  },
  {
    name: "add_songs",
    description:
      "Music only, never books. Add songs to the user's guitar practice list when they want to practice or learn them later ('I wanna practice John Mayer\u2019s Neon', 'add Blackbird to my songs'). This is not a practice session: it logs no time. Give the artist the user names; for a well-known song they name without one, give the original or best-known artist and fix obvious title misspellings. Leave artist null for exercises, riffs, or songs you don't recognize. Also use it to add an artist to a song already on the list. status defaults to 'Want to learn'. The app looks up album art.",
    parameters: addSongsSchema,
  },
  {
    name: "add_books",
    description:
      "Add books to the user's reading list when they want to read them later ('add Atomic Habits to my reading list', 'books I want to read: …'). This is not a reading session: it logs no pages. Give the author the user names; for a well-known book named without one, give its author and the book's usual title (fix obvious misspellings). Leave author null when you don't recognize the book. Also use it to add an author to a book already in the library. status defaults to 'Want to read'. The app looks up covers.",
    parameters: addBooksSchema,
  },
  {
    name: "add_habits",
    description:
      "Start tracking habits without logging anything yet ('track if I brush my teeth at night', 'I want to track water'). A yes-or-no habit uses unit 'times' and goal 1 (done once a day); an amount habit gives its unit and optional daily goal. Name it the way the user describes it, including a time of day when they give one ('Brush teeth at night'). Use log_entries when they report actually doing it.",
    parameters: addHabitsSchema,
  },
  {
    name: "update_book",
    description:
      "Correct a book in the library, not a reading session: where the user is in it ('I've read 11 of 92 chapters, not 17' → chaptersRead 11; 'I'm on page 51' → pagesRead 51), its length (totalPages, totalChapters), its status ('I finished it' → Finished), or a missing author. pagesRead and chaptersRead are totals so far, not amounts from one sitting. Leave everything else null. The app keeps logged sessions and moves the book's starting point so its progress matches.",
    parameters: updateBookSchema,
  },
  {
    name: "practice_plan",
    description:
      "Today's guitar practice recommendation from the app's spaced-repetition model: which songs to practice now (most at risk of being forgotten first, then a new song), suggested minutes, and each song's estimated retention and next review date. Use it whenever the user asks what to practice, which songs need work, or how well they retain their songs. Never make up retention numbers or dates.",
    parameters: practicePlanSchema,
  },
  {
    name: "delete_entries",
    description:
      "Delete saved entries by id, only when the user clearly asks to remove them. The app shows an Undo button.",
    parameters: deleteEntriesSchema,
  },
  {
    name: "undo_batch",
    description:
      "Remove every entry saved by one earlier log_entries call, when the user asks to undo it. Use the batchId from that call's result.",
    parameters: undoBatchSchema,
  },
];
export const TOOL_NAMES = CHAT_TOOLS.map((t) => t.name);
export const TOOL_SCHEMAS = Object.fromEntries(
  CHAT_TOOLS.map((t) => [t.name, t.parameters]),
);
