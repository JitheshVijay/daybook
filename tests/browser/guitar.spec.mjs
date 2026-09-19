import { test, expect } from "./fixtures.mjs";
import { calls, go, mockChat, say, seed, send, stored, toolCall } from "./helpers.mjs";
import { dateKey, emptyState, shiftDate } from "../../src/domain.js";

const itunes = (trackName, artistName, collectionName) => ({
  kind: "song",
  trackName,
  artistName,
  collectionName,
  artworkUrl100: `https://is1-ssl.mzstatic.com/image/thumb/${encodeURIComponent(trackName)}/100x100bb.jpg`,
});

test("wanting to practice a song adds it with album art, and the retention plan recommends what to practice", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const today = dateKey();
  const state = emptyState();
  state.songs = [{ id: "blackbird", title: "Blackbird", artist: "The Beatles", targetBpm: 0, status: "Learning", cover: "", added: shiftDate(today, -10) }];
  state.entries = [
    { id: "b1", type: "guitar", date: shiftDate(today, -5), time: "18:00", status: "done", title: "", notes: "", minutes: 20, pages: 0, chapters: 0, steps: 0, distance: 0, bpm: 0, value: 0, quality: 2, mood: "Neutral", lucid: false, section: "", unit: "", bookId: "", songId: "blackbird", habitId: "", exercises: [], items: [] },
  ];
  await seed(page, state);
  const requests = await mockChat(page, [
    calls(toolCall("add_songs", { songs: [{ title: "Neon", artist: "John Mayer", status: null }] }, "add")),
    say("Added Neon to your practice list."),
    calls(toolCall("practice_plan", { limit: 5 }, "plan")),
    (body) => {
      const plan = JSON.parse(body.messages.at(-1).content);
      expect(plan.practiceToday.map((i) => i.title)).toEqual(["Blackbird", "Neon"]);
      return say("Start with Blackbird, then learn the intro of Neon.");
    },
  ]);
  const searches = [];
  await page.route("https://itunes.apple.com/**", (route) => {
    const term = new URL(route.request().url()).searchParams.get("term");
    searches.push(term);
    const results = /neon/i.test(term) ? [itunes("Neon", "John Mayer", "Room for Squares")] : /blackbird/i.test(term) ? [itunes("Blackbird", "The Beatles", "The Beatles")] : [];
    return route.fulfill({ json: { resultCount: results.length, results } });
  });

  await page.goto("/");
  await send(page, "i wanna practice john mayer's neon");
  const card = page.getByTestId("logged-card");
  await expect(card).toContainText("Added 1 song to your practice list");
  await expect(card.getByRole("img", { name: "Neon album art" })).toHaveAttribute("src", /600x600bb\.jpg$/);
  const neon = (await stored(page)).songs.find((s) => s.title === "Neon");
  expect(neon).toMatchObject({ artist: "John Mayer", status: "Want to learn" });
  expect((await stored(page)).entries).toHaveLength(1);

  await send(page, "what should i practice today?");
  const plan = page.getByTestId("practice-card");
  await expect(plan).toContainText("Blackbird");
  await expect(plan.locator("[data-slot=item]").first()).toContainText("Rough last time");
  await expect(plan.locator("[data-slot=item]").nth(1)).toContainText("Neon");
  await expect(page.getByText("Start with Blackbird, then learn the intro of Neon.")).toBeVisible();
  expect(requests).toHaveLength(4);
  expect(searches.some((t) => /Blackbird/.test(t))).toBe(true);

  await go(page, "Insights");
  await page.getByRole("tab", { name: "Guitar" }).click();
  const today_ = page.getByTestId("practice-today");
  await expect(today_.getByRole("listitem")).toHaveCount(2);
  await expect(today_.getByRole("listitem").first()).toContainText("Blackbird");
  await expect(page.getByTestId("retention-card")).toContainText("Retention now");
  await expect(page.getByTestId("practice-list").getByRole("listitem")).toHaveCount(2);
  await expect(page.getByTestId("practice-list").getByRole("listitem").first()).toContainText(/Overdue|Due today/);

  await today_.getByRole("listitem").first().getByRole("button", { name: "Log" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("How did it go?").selectOption({ label: "Solid" });
  await dialog.getByRole("button", { name: /^Save/ }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const saved = (await stored(page)).entries.filter((e) => e.songId === "blackbird");
  expect(saved.map((e) => e.quality)).toEqual([2, 3]);
  // Logging keeps today's plan: Blackbird stays, marked done, and its minutes count toward the goal.
  await expect(today_.getByRole("listitem")).toHaveCount(2);
  await expect(today_.getByRole("listitem").first()).toContainText("Neon");
  await expect(today_.getByRole("listitem").nth(1)).toHaveAttribute("data-state", "done");
  await expect(today_.getByRole("listitem").nth(1)).toContainText("Practiced today · Solid");
  await expect(today_).toContainText(/\d+ of 20 min done\. \d+ min left across 1 song\./);
  await expect(today_.getByTestId("practice-progress")).toBeVisible();
  expect(errors).toEqual([]);
});

test("a reading wishlist in chat adds books with covers to the Reading tab, not the song list", async ({ page }) => {
  await mockChat(page, [
    calls(toolCall("add_books", { books: [{ title: "Atomic Habits", author: "James Clear", status: null }, { title: "Deep Work", author: "Cal Newport", status: null }] }, "books")),
    say("Added both to your reading list."),
  ]);
  await page.route("https://openlibrary.org/**", (route) => {
    const title = new URL(route.request().url()).searchParams.get("title");
    const docs = { "Atomic Habits": [{ title: "Atomic Habits", author_name: ["James Clear"], cover_i: 12539702 }], "Deep Work": [{ title: "Deep Work", author_name: ["Cal Newport"], cover_i: 7988607 }] }[title] || [];
    return route.fulfill({ json: { docs } });
  });
  await page.route("https://covers.openlibrary.org/**", (route) =>
    route.fulfill({ contentType: "image/png", body: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64") }),
  );
  await page.goto("/");
  await send(page, "add to my reading list: atomic habits and deep work");
  const card = page.getByTestId("logged-card");
  await expect(card).toContainText("Added 2 books to your reading list");
  await expect(card.getByRole("img", { name: "Atomic Habits cover" })).toBeVisible({ timeout: 10000 });
  const saved = await stored(page);
  expect(saved.books.map((b) => [b.title, b.status])).toEqual([["Atomic Habits", "Want to read"], ["Deep Work", "Want to read"]]);
  expect(saved.songs).toEqual([]);
  await go(page, "Insights");
  await page.getByRole("tab", { name: "Reading" }).click();
  await expect(page.getByText("2 want to read")).toBeVisible();
});

test("correcting where you are in a book shows the change and can be undone", async ({ page }) => {
  const state = emptyState();
  state.books = [{ id: "talk", title: "How to Talk to Anyone", author: "Leil Lowndes", totalPages: 321, totalChapters: 92, startPages: 28, startChapters: 6, status: "Reading", cover: "" }];
  state.entries = [{ id: "s1", type: "reading", date: dateKey(), time: "23:12", status: "done", title: "", notes: "", minutes: 0, pages: 22, chapters: 11, steps: 0, distance: 0, bpm: 0, value: 0, quality: "", mood: "Neutral", lucid: false, section: "", unit: "", bookId: "talk", songId: "", habitId: "", exercises: [], items: [] }];
  await seed(page, state);
  await mockChat(page, [
    calls(toolCall("update_book", { title: "How to Talk to Anyone", author: null, pagesRead: null, chaptersRead: 11, totalPages: null, totalChapters: null, status: null }, "book")),
    say("Corrected to 11 of 92 chapters."),
  ]);
  await page.goto("/");
  await send(page, "i read 11/92 chapters not 17 / 92 chapter");
  const card = page.getByTestId("logged-card");
  await expect(card).toContainText("Updated book");
  await expect(card).toContainText("book progress 17 → 11 / 92 chapters");
  const book = () => stored(page).then((s) => ({ ...s.books[0], sessions: s.entries.reduce((a, e) => a + e.chapters, 0) }));
  expect(await book()).toMatchObject({ startChapters: 0, sessions: 11 });
  await card.getByRole("button", { name: "Undo" }).click();
  await expect(card.getByText("Undone")).toBeVisible();
  expect(await book()).toMatchObject({ startChapters: 6, sessions: 11 });
});
