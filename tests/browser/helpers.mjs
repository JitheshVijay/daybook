import { extractionSchema } from "../../src/day-import.js";
import { emptyState, dateKey, weekDates, shiftDate } from "../../src/domain.js";

export const today = () => dateKey();

// An entry in the assistant's tool shape with every field present.
export function raw(type, values = {}) {
  const base = Object.fromEntries(
    Object.entries(extractionSchema.properties.entries.items.properties).map(([key, s]) => [
      key,
      Array.isArray(s.type) && s.type.includes("null") ? null : s.type === "array" ? [] : s.type === "boolean" ? false : "",
    ]),
  );
  return { ...base, type, status: "done", source: "", resolves: null, ...values };
}

export const toolCall = (name, args, id = `call_${Math.random().toString(36).slice(2, 8)}`) => ({
  id,
  type: "function",
  function: { name, arguments: JSON.stringify(args) },
});
export const say = (content) => ({ role: "assistant", content, tool_calls: null });
export const calls = (...list) => ({ role: "assistant", content: null, tool_calls: list });

// Script /api/chat replies in order and record every request body.
export async function mockChat(page, replies, { configured = true } = {}) {
  const requests = [];
  await page.route("**/api/assistant/status", (route) =>
    route.fulfill({ json: configured ? { configured: true, provider: "OpenRouter", model: "test/model" } : { configured: false, provider: null, model: null } }),
  );
  await page.route("**/api/chat", async (route) => {
    requests.push(route.request().postDataJSON());
    const body = route.request().postDataJSON();
    let next = replies.shift();
    if (typeof next === "function") next = next(body);
    if (!next) return route.fulfill({ status: 500, json: { error: "No scripted reply left." } });
    if (next.status) return route.fulfill({ status: next.status, json: next.body });
    return route.fulfill({ json: { message: next } });
  });
  requests.nutrition = [];
  await page.route("**/api/nutrition", async (route) => {
    const body = route.request().postDataJSON();
    requests.nutrition.push(body);
    await route.fulfill({
      json: { foods: body.foods.map((f) => ({ name: f.name, servings: f.servings ?? 1, portion: `1 typical ${f.name}`, calories: 150, protein: 5, carbs: 20, fat: 4 })) },
    });
  });
  // Song identification and album art never reach the network in tests; a test can route its own results after this.
  await page.route("**/api/songs", (route) => {
    const body = route.request().postDataJSON();
    return route.fulfill({ json: { songs: body.songs.map((s) => ({ title: s.title, artist: s.artist ?? null, known: false })) } });
  });
  await page.route("https://itunes.apple.com/**", (route) => route.fulfill({ json: { resultCount: 0, results: [] } }));
  await page.route("https://is1-ssl.mzstatic.com/**", (route) =>
    route.fulfill({ contentType: "image/png", body: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64") }),
  );
  await page.route("https://openlibrary.org/**", (route) => route.fulfill({ json: { docs: [] } }));
  await page.route("https://covers.openlibrary.org/**", (route) => route.fulfill({ status: 404, body: "" }));
  return requests;
}

export const stored = (page) => page.evaluate(() => JSON.parse(localStorage.getItem("daybook.v1") || "null"));
export const storedChat = (page) => page.evaluate(() => JSON.parse(localStorage.getItem("daybook.chat.v1") || "null"));

export async function seed(page, state) {
  await page.addInitScript((s) => {
    if (!sessionStorage.getItem("seeded")) {
      localStorage.setItem("daybook.v1", JSON.stringify(s));
      sessionStorage.setItem("seeded", "1");
    }
  }, state);
}

export async function send(page, text) {
  const box = page.getByRole("textbox", { name: "Message Daybook" });
  await box.fill(text);
  await box.press("Enter");
}

export const sidebarNav = (page, name) => page.getByRole("list", { name: "Main navigation" }).getByRole("button", { name, exact: true });

export async function go(page, name) {
  const width = page.viewportSize().width;
  if (width < 768) await page.getByRole("button", { name: "Toggle Sidebar" }).first().click();
  if (name === "Settings") await page.getByRole("button", { name: "Settings", exact: true }).first().click();
  else await sidebarNav(page, name).click();
}

// A realistic populated state for screenshots and Insights checks (test-only data).
export function fixture() {
  const s = emptyState();
  const t = dateKey();
  const week = weekDates(t);
  s.profile.name = "Jithe";
  s.profile.calorieGoal = 2200;
  s.profile.proteinGoal = 120;
  s.books = [{ id: "book", title: "Deep Work", author: "Cal Newport", totalPages: 304, totalChapters: 0, startPages: 80, startChapters: 0, status: "Reading", cover: "" }];
  s.songs = [{ id: "song", title: "Blackbird", artist: "The Beatles", targetBpm: 100, status: "Learning" }];
  s.habits = [{ id: "water", name: "Water", unit: "glasses", goal: 8 }];
  const base = { time: "08:00", status: "done", notes: "" };
  const days = Array.from({ length: 14 }, (_, i) => shiftDate(t, -i));
  s.entries = [];
  days.forEach((d, i) => {
    if (i % 2 === 0)
      s.entries.push({ ...base, id: `w${i}`, type: "workout", date: d, time: "18:00", title: i % 4 ? "Pull day" : "Push day", minutes: 45 + i, exercises: [{ name: i % 4 ? "Barbell row" : "Bench press", muscle: i % 4 ? "upper-back" : "chest", sets: [1, 2, 3].map(() => ({ reps: 10, weight: 40 + i, done: true })) }] });
    s.entries.push({ ...base, id: `s${i}`, type: "steps", date: d, steps: 5200 + ((i * 911) % 5200) });
    s.entries.push({ ...base, id: `sl${i}`, type: "sleep", date: d, time: "07:00", minutes: 380 + ((i * 37) % 120) });
    s.entries.push({ ...base, id: `b${i}`, type: "food", date: d, time: "08:00", title: "Breakfast", items: [{ name: "Oats", servings: 1, calories: 350 + i * 5, protein: 14, carbs: 60, fat: 7 }] });
    s.entries.push({ ...base, id: `d${i}`, type: "food", date: d, time: "19:30", title: "Dinner", items: [{ name: "Chicken rice bowl", servings: 1, calories: 700 + ((i * 53) % 300), protein: 45 + (i % 5) * 4, carbs: 80, fat: 20, estimated: i % 3 === 0, estimateNote: i % 3 === 0 ? "typical bowl" : "" }] });
    if (i % 3 !== 1) s.entries.push({ ...base, id: `r${i}`, type: "reading", date: d, time: "21:30", bookId: "book", pages: 12 + (i % 4) * 6, chapters: 0, minutes: 25 });
    if (i % 3 === 0) s.entries.push({ ...base, id: `m${i}`, type: "meditation", date: d, time: "07:15", minutes: 10 + (i % 3) * 5, quality: 3 + (i % 2), mood: "Calm", title: "" });
    if (i % 4 === 1) s.entries.push({ ...base, id: `g${i}`, type: "guitar", date: d, time: "20:00", songId: "song", minutes: 20, bpm: 60 + i, section: "Verse" });
    s.entries.push({ ...base, id: `h${i}`, type: "habit", date: d, time: "12:00", habitId: "water", value: 5 + (i % 4), unit: "glasses" });
    s.entries.push({ ...base, id: `st${i}`, type: "screentime", date: d, time: "22:00", minutes: 150 - (i % 5) * 12 });
  });
  s.entries.push({ ...base, id: "dream", type: "dream", date: week[0] <= t ? t : t, time: "06:30", title: "The quiet coastline", quality: 4, mood: "Curious", lucid: true, notes: "I walked along a quiet coastline where every doorway opened onto the same beach." });
  return s;
}
