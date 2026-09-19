import { test } from "node:test";
import assert from "node:assert/strict";
import { emptyState, validateState, entryDetail } from "../src/domain.js";
import { extractionSchema } from "../src/day-import.js";
import { executeToolCall, undoBatch } from "../src/chat-tools.js";
import { practicePlan, retentionForecast, retrievability, songMemory, songStats, splitMinutes } from "../src/practice.js";
import { fillSongCovers, pickSongMatch } from "../src/song-covers.js";

const TODAY = "2026-09-13";
const raw = (type, values = {}) => ({
  ...Object.fromEntries(
    Object.entries(extractionSchema.properties.entries.items.properties).map(([key, s]) => [
      key,
      Array.isArray(s.type) && s.type.includes("null") ? null : s.type === "array" ? [] : s.type === "boolean" ? false : "",
    ]),
  ),
  type,
  status: "done",
  source: "",
  resolves: null,
  ...values,
});
const call = (name, args, id = "call_1") => ({ id, type: "function", function: { name, arguments: JSON.stringify(args) } });
function makeStore(initial = emptyState()) {
  let state = initial;
  return { get: () => state, commit: (update) => (state = validateState(typeof update === "function" ? update(state) : update)) };
}
const ctx = (store, extra = {}) => ({ state: store.get(), commit: store.commit, today: TODAY, now: "19:00", logDate: TODAY, turnId: "turn-1", pending: [], ...extra });
const song = (id, title, artist, status = "Learning", extra = {}) => ({ id, title, artist, targetBpm: 0, status, cover: "", added: "2026-09-01", ...extra });
const session = (id, songId, date, quality, minutes = 20) => ({
  id, type: "guitar", date, time: "18:00", status: "done", title: "", notes: "", minutes, pages: 0, chapters: 0, steps: 0, distance: 0, bpm: 0, value: 0,
  quality, mood: "Neutral", lucid: false, section: "", unit: "", bookId: "", songId, habitId: "", exercises: [], items: [],
});

test("the memory model follows FSRS: 90% retention at one stability, growth after spaced success, a drop after a failure", () => {
  assert.equal(Math.round(retrievability(7, 7) * 1000) / 1000, 0.9);
  const s = (date, quality) => ({ date, time: "18:00", quality });
  const good = songMemory([s("2026-09-01", 3), s("2026-09-04", 3), s("2026-09-13", 3)]);
  assert.deepEqual(good.history.map((h) => Math.round(h.stability * 10) / 10), [3.2, 10.7, 30.6], "each spaced Solid review lasts about three times longer");
  const clean = songMemory([s("2026-09-01", 4)]);
  const rough = songMemory([s("2026-09-01", 2)]);
  assert.ok(clean.stability > good.history[0].stability && good.history[0].stability > rough.stability, "better sessions last longer");
  assert.ok(rough.difficulty > clean.difficulty);
  const failed = songMemory([s("2026-09-01", 3), s("2026-09-21", 1)]);
  assert.ok(failed.stability < failed.history[0].stability, "couldn't play it resets the memory lower");
  const unrated = songMemory([s("2026-09-01", ""), s("2026-09-04", "")]);
  assert.deepEqual(unrated.history.map((h) => h.assumed), [true, true]);
  assert.equal(Math.round(unrated.stability * 10) / 10, 10.7, "an unrated session counts as Solid");
});

test("the plan puts the most-forgotten due songs first, then one new song, split by difficulty", () => {
  const state = emptyState();
  state.profile.guitarGoal = 30;
  state.songs = [
    song("neon", "Neon", "John Mayer", "Want to learn"),
    song("blackbird", "Blackbird", "The Beatles"),
    song("gravity", "Gravity", "John Mayer"),
    song("wonderwall", "Wonderwall", "Oasis", "Performance ready"),
    song("layla", "Layla", "Eric Clapton"),
    song("sweet", "Sweet Child O' Mine", "Guns N' Roses", "Learning"),
  ];
  state.entries = [
    session("b1", "blackbird", "2026-09-08", 2), // rough five days ago: due, struggling
    session("g1", "gravity", "2026-09-01", 3), // solid twelve days ago: due, lower retention
    session("w1", "wonderwall", "2026-09-12", 4), // clean yesterday: scheduled
  ];
  const plan = practicePlan(validateState(state), TODAY);
  // Blackbird (rough, 5 days) has faded more than Gravity (solid, 12 days).
  assert.deepEqual(plan.items.map((i) => [i.title, i.kind]), [["Blackbird", "struggling"], ["Gravity", "due"], ["Layla", "new"]]);
  assert.ok(plan.items[0].retention < plan.items[1].retention);
  assert.match(plan.items[0].reason, /Rough last time/);
  assert.match(plan.items[1].reason, /Estimated retention 73%, below your 90% target\. Last played 12 days ago\./);
  assert.match(plan.items[2].reason, /No practice logged yet/);
  assert.ok(plan.items.every((i) => i.minutes >= 5));
  assert.deepEqual(plan.upcoming.map((u) => u.title), ["Wonderwall"]);
  assert.ok(!plan.items.some((i) => i.title === "Wonderwall"), "a performance-ready song isn't practiced before it's due");

  const quiet = validateState({ ...state, entries: [session("w1", "wonderwall", "2026-09-12", 4)], songs: [state.songs[0], state.songs[3], state.songs[4]] });
  assert.deepEqual(practicePlan(quiet, TODAY).items.map((i) => i.title), ["Layla", "Neon"], "with nothing due, two new songs, songs being learned first");

  const stats = songStats(validateState(state), TODAY);
  const gravity = stats.find((r) => r.song.id === "gravity");
  assert.equal(gravity.state, "due");
  assert.equal(gravity.dueDate, "2026-09-04");
  assert.equal(retentionForecast(gravity, TODAY, 30).length, 31);
});

test("add_songs puts songs on the practice list with album art lookup and Undo; practicing one links to it", () => {
  const store = makeStore();
  const looked = [];
  const added = executeToolCall(
    call("add_songs", { songs: [{ title: "Neon", artist: "John Mayer", status: null }, { title: "Blackbird", artist: null, status: "Learning" }] }, "a"),
    ctx(store, { onNewSongs: (songs) => looked.push(...songs.map((s) => s.title)) }),
  );
  assert.deepEqual(store.get().songs.map((s) => [s.title, s.artist, s.status, s.added]), [["Neon", "John Mayer", "Want to learn", TODAY], ["Blackbird", "", "Learning", TODAY]]);
  assert.deepEqual(looked, ["Neon", "Blackbird"]);
  assert.equal(store.get().entries.length, 0, "no practice time is logged");
  assert.equal(added.effects.card.mode, "songs");
  const again = executeToolCall(call("add_songs", { songs: [{ title: "neon", artist: "john mayer", status: null }] }, "b"), ctx(store, { state: store.get() }));
  assert.equal(store.get().songs.length, 2);
  assert.deepEqual(again.result.alreadyInList.map((s) => s.title), ["Neon"]);

  // "I practiced Neon and Blackbird by the Beatles, Neon was rough"
  const log = executeToolCall(
    call("log_entries", { entries: [
      raw("guitar", { songTitle: "Neon", artist: "John Mayer", minutes: 20, quality: 2, source: "practiced neon for 20 minutes, it was rough" }),
      raw("guitar", { songTitle: "Blackbird", artist: "The Beatles", minutes: 15, quality: null, source: "blackbird for 15" }),
    ] }, "c"),
    ctx(store, { state: store.get(), onNewSongs: () => {} }),
  );
  const state = store.get();
  assert.equal(state.songs.length, 2, "both sessions joined the songs already on the list");
  assert.equal(state.songs.find((s) => s.title === "Blackbird").artist, "The Beatles", "the artist is filled in");
  assert.deepEqual(state.entries.map((e) => [state.songs.find((s) => s.id === e.songId).title, e.quality]), [["Neon", 2], ["Blackbird", ""]]);
  assert.equal(state.songs.find((s) => s.title === "Neon").status, "Learning", "practicing moves a song off the wishlist");
  assert.equal(entryDetail(state.entries[0]), "20 min · Rough");
  assert.deepEqual(log.result.ratingNeeded.map((r) => r.title), ["Blackbird"]);
  assert.match(log.result.replyGuidance, /How did Blackbird go\?/);

  const rated = executeToolCall(call("update_entry", { id: state.entries[1].id, changes: raw("guitar", { quality: 3 }) }, "d"), ctx(store, { state: store.get() }));
  assert.equal(rated.result.error, undefined);
  assert.equal(store.get().entries[1].quality, 3);

  store.commit((s) => undoBatch(s, added.effects.card));
  assert.equal(store.get().songs.length, 2, "songs with practice sessions stay after Undo");
});

test("practicing a planned song keeps today's plan: it's marked done, its minutes count, and new songs aren't pulled in", () => {
  const state = emptyState();
  state.songs = [
    song("chain", "The Chain", "Fleetwood Mac"),
    song("neon", "Neon", "John Mayer", "Want to learn"),
    song("lethergo", "Let Her Go", "Passenger", "Want to learn", { added: "2026-09-02" }),
  ];
  state.entries = [session("c0", "chain", "2026-09-10", 3)]; // solid three days ago: due today
  const before = practicePlan(validateState(state), TODAY);
  assert.deepEqual(before.items.map((i) => [i.title, i.kind, i.done]), [["The Chain", "due", false], ["Neon", "new", false]]);
  assert.equal(before.items.reduce((t, i) => t + i.minutes, 0), 20, "the split adds up to the goal");
  assert.ok(before.items.every((i) => i.minutes >= 5));
  assert.deepEqual([before.doneMinutes, before.remainingMinutes, before.goalMet], [0, 20, false]);

  // "practiced the chain for 11 minutes, only the intro" rated Solid
  const intro = { ...session("c1", "chain", TODAY, 3, 11), section: "Intro" };
  const after = practicePlan(validateState({ ...state, entries: [...state.entries, intro] }), TODAY);
  assert.deepEqual(after.items.map((i) => [i.title, i.done, i.minutes]), [["Neon", false, 9], ["The Chain", true, 11]]);
  assert.ok(!after.items.some((i) => i.title === "Let Her Go"), "a review doesn't pull another new song into today");
  assert.deepEqual([after.doneMinutes, after.remainingMinutes, after.goalMet], [11, 9, false]);
  const chain = after.items.find((i) => i.songId === "chain");
  assert.deepEqual([chain.sections, chain.ratingToday, chain.minutesDone], [["Intro"], 3, 11]);
  assert.ok(after.upcoming.some((u) => u.songId === "chain" && u.daysUntilDue > 0), "the review moved The Chain's next due date out");

  // Goal met on The Chain alone: the rest of the plan is optional.
  const long = { ...session("c1", "chain", TODAY, 3, 25) };
  const met = practicePlan(validateState({ ...state, entries: [...state.entries, long] }), TODAY);
  assert.equal(met.goalMet, true);
  assert.deepEqual(met.items.map((i) => [i.title, i.optional, i.minutes]), [["Neon", true, 0], ["The Chain", false, 25]]);

  // Practice off the plan still counts and shows as an extra.
  const offPlan = session("l1", "lethergo", TODAY, 3, 6);
  const extra = practicePlan(validateState({ ...state, entries: [...state.entries, intro, offPlan] }), TODAY);
  assert.deepEqual(extra.items.map((i) => [i.title, i.kind, i.done, i.minutes]), [["Neon", "new", false, 3], ["The Chain", "due", true, 11], ["Let Her Go", "extra", true, 6]]);
  assert.equal(extra.remainingMinutes, 3, "only the minutes left are asked for");
});

test("splitMinutes adds up exactly, keeps 5 minutes per song when possible, and follows the weights", () => {
  for (const [total, weights] of [[20, [5.2, 6]], [30, [9, 5.5, 6]], [9, [6]], [7, [3, 6]], [3, [1, 1]], [25, [0, 0]]]) {
    const out = splitMinutes(total, weights);
    assert.equal(out.reduce((a, m) => a + m, 0), total, `${total} split over ${weights}`);
    if (total >= 5 * weights.length) assert.ok(out.every((m) => m >= 5));
  }
  const [easy, hard] = splitMinutes(30, [2, 8]);
  assert.ok(hard > easy);
  assert.deepEqual(splitMinutes(0, [1, 2]), [0, 0]);
});

test("practice_plan returns the plan with real numbers and a card", () => {
  const state = emptyState();
  state.songs = [song("neon", "Neon", "John Mayer", "Want to learn"), song("gravity", "Gravity", "John Mayer")];
  state.entries = [session("g1", "gravity", "2026-09-01", 3)];
  const store = makeStore(validateState(state));
  const out = executeToolCall(call("practice_plan", { limit: 5 }), ctx(store));
  assert.deepEqual(out.result.practiceToday.map((i) => i.title), ["Gravity", "Neon"]);
  assert.equal(out.result.practiceToday[0].retentionPercent, 73);
  assert.equal(out.result.songs.find((s) => s.title === "Gravity").next, "Overdue 9 days");
  assert.equal(out.effects.card.kind, "practice");
  const empty = executeToolCall(call("practice_plan", { limit: 5 }), ctx(makeStore()));
  assert.match(empty.result.note, /no songs yet/);
});

test("album art needs a known artist; typos are corrected and the user's artist is kept", async () => {
  const track = (trackName, artistName, collectionName = "Room for Squares") => ({ kind: "song", trackName, artistName, collectionName, artworkUrl100: `https://is1-ssl.mzstatic.com/image/thumb/${encodeURIComponent(trackName + artistName)}/100x100bb.jpg` });
  const neon = [track("Neon", "Shadow", "Neon"), track("Neon (Live at the Nokia Theatre)", "John Mayer", "Where the Light Is"), track("Neon", "John Mayer")];
  assert.deepEqual(pickSongMatch({ title: "Neon", artist: "John Mayer" }, neon), { cover: "https://is1-ssl.mzstatic.com/image/thumb/NeonJohn%20Mayer/600x600bb.jpg", artist: null, title: null }, "the studio recording, not the live one");
  assert.equal(pickSongMatch({ title: "Neon", artist: "" }, neon), null, "iTunes ranks another artist's Neon first, so no artist means no guess");
  assert.equal(pickSongMatch({ title: "Neon", artist: "Jon Mayer" }, neon).artist, "John Mayer", "an artist typo is corrected");
  const fallback = pickSongMatch({ title: "Neon", artist: "MAIKA" }, neon);
  assert.equal(fallback.artist, null, "an artist iTunes doesn't have is kept");
  assert.match(fallback.cover, /NeonShadow/, "and the most relevant recording's art is shown");
  const aruarian = [track("Aruarian Dance", "Nujabes", "Samurai Champloo Music Record Departure"), track("Aruarian Dance (slow and reverb)", "Echoes", "Aruarian Dance - Single")];
  assert.deepEqual(pickSongMatch({ title: "Aruvian Dance", artist: "Nujabes" }, aruarian).title, "Aruarian Dance");

  // Without an artist, the app server picks the song from the recordings iTunes found.
  const store = makeStore({ ...emptyState(), songs: [song("a", "Aruvian Dance", ""), song("b", "Blues shuffle in A", ""), song("n", "Neon", "John Mayer")] });
  const calls = [];
  await fillSongCovers(store.commit, store.get().songs, async (url, opts) => {
    calls.push(url);
    if (url === "/api/songs") {
      const body = JSON.parse(opts.body);
      assert.deepEqual(body.songs.map((x) => x.title), ["Aruvian Dance", "Blues shuffle in A"]);
      assert.deepEqual(body.songs[0].candidates[0], { title: "Aruarian Dance", artist: "Nujabes" });
      return { ok: true, json: async () => ({ songs: [{ title: "Aruarian Dance", artist: "Nujabes", known: true }, { title: "Blues shuffle in A", artist: null, known: false }] }) };
    }
    const term = new URL(url).searchParams.get("term");
    const results = /aruvian/i.test(term) ? aruarian : /blues/i.test(term) ? [track("Blues Shuffle in A", "Ck Blues", "Blues")] : neon;
    return { ok: true, json: async () => ({ results }) };
  });
  assert.match(calls[0], /itunes\.apple\.com\/search\?term=Aruvian\+Dance/);
  assert.match(calls[2], /term=John\+Mayer\+Neon/);
  const songs = store.get().songs;
  assert.deepEqual(songs.map((x) => [x.title, x.artist, Boolean(x.cover)]), [["Aruarian Dance", "Nujabes", true], ["Blues shuffle in A", "", false], ["Neon", "John Mayer", true]]);
  assert.throws(() => validateState({ ...store.get(), songs: [{ ...songs[0], cover: "http://example.com/a.jpg" }] }), /Invalid song/);

  // Without the server (Sites build, AI not connected), songs without an artist get no cover.
  const offline = makeStore({ ...emptyState(), songs: [song("a", "Aruvian Dance", "")] });
  await fillSongCovers(offline.commit, offline.get().songs, async (url) => (url === "/api/songs" ? { ok: false, json: async () => ({}) } : { ok: true, json: async () => ({ results: aruarian }) }));
  assert.equal(offline.get().songs[0].cover, "");

  // Naming the artist later in chat fills it in and looks the art up again.
  const named = makeStore({ ...emptyState(), songs: [song("j", "Just the Two of Us", "")] });
  const looked = [];
  const out = executeToolCall(call("add_songs", { songs: [{ title: "just the two of us", artist: "Bill Withers", status: null }] }, "n"), ctx(named, { onNewSongs: (list) => looked.push(...list) }));
  assert.deepEqual(named.get().songs.map((x) => [x.title, x.artist]), [["Just the Two of Us", "Bill Withers"]]);
  assert.deepEqual(out.result.artistAdded.map((x) => x.artist), ["Bill Withers"]);
  assert.deepEqual(looked.map((x) => x.id), ["j"]);
});

test("add_books builds a reading list that later reading sessions join, and covers match loosely", async () => {
  const { fillBookCovers } = await import("../src/book-covers.js");
  const store = makeStore();
  const covered = [];
  const out = executeToolCall(
    call("add_books", { books: [{ title: "Psychology of Money", author: "Morgan Housel", status: null }, { title: "Thinking Fast and Slow", author: null, status: null }] }, "b"),
    ctx(store, { onNewBooks: (books) => covered.push(...books.map((b) => b.title)) }),
  );
  assert.deepEqual(store.get().books.map((b) => [b.title, b.author, b.status]), [["Psychology of Money", "Morgan Housel", "Want to read"], ["Thinking Fast and Slow", "", "Want to read"]]);
  assert.deepEqual(covered, ["Psychology of Money", "Thinking Fast and Slow"]);
  assert.equal(store.get().songs.length, 0, "books never land in the song list");
  assert.equal(store.get().entries.length, 0, "no reading is logged");
  assert.equal(out.effects.card.mode, "books");

  const again = executeToolCall(call("add_books", { books: [{ title: "The Psychology of Money", author: null, status: null }, { title: "thinking, fast and slow", author: "Daniel Kahneman", status: null }] }, "c"), ctx(store, { state: store.get() }));
  assert.equal(store.get().books.length, 2, "a leading The and punctuation don't make a second copy");
  assert.deepEqual(again.result.authorAdded.map((b) => b.author), ["Daniel Kahneman"]);

  executeToolCall(
    call("log_entries", { entries: [raw("reading", { bookTitle: "The Psychology of Money", author: null, pages: 30, source: "read 30 pages of the psychology of money" })] }, "r"),
    ctx(store, { state: store.get() }),
  );
  const state = store.get();
  assert.equal(state.books.length, 2);
  assert.equal(state.entries[0].bookId, state.books[0].id, "the session joins the book on the list");
  assert.equal(state.books[0].status, "Reading", "reading it moves it off the wishlist");

  store.commit((s) => undoBatch(s, out.effects.card));
  assert.deepEqual(store.get().books.map((b) => b.title), ["Psychology of Money"], "Undo removes the unread book and keeps the one with a session");

  let covers = { books: [{ id: "k", title: "Thinking Fast and Slow", author: "", cover: "" }] };
  await fillBookCovers((fn) => (covers = fn(covers)), covers.books, async () => ({
    ok: true,
    json: async () => ({ docs: [{ title: "Thinking, fast and slow", author_name: ["Daniel Kahneman", "Removed"], cover_i: 13290711 }] }),
  }));
  assert.match(covers.books[0].cover, /13290711/);
  assert.equal(covers.books[0].author, "Daniel Kahneman", "the author is filled in from the match");
});
