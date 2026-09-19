// Rebuild the user's conversation as the pre-fix app stored it: cardio saved,
// seven one-exercise workouts and a meal waiting, with the old duration questions.
import { dateKey, emptyState } from "../src/domain.js";
export function staleState(today = dateKey()) {

  const batch = "5f0c1a2b3c4d5e6f7a8b9c0d1e2f3a4b";
  const state = emptyState();
  state.entries = [{ id: `ai-${batch}-0`, type: "cardio", date: today, time: "14:55", status: "done", title: "Cardio", notes: "", minutes: 12, pages: 0, chapters: 0, steps: 0, distance: 0, bpm: 0, value: 0, quality: "", mood: "Neutral", lucid: false, section: "", unit: "", bookId: "", songId: "", habitId: "", exercises: [], items: [], sourceBatch: batch, sourceItem: 0 }];
  const set = (reps, weight) => ({ reps, weight, done: true });
  const workouts = [
    ["Leg Press", "Leg press", "quadriceps", [set(12, 40), set(12, 70), set(12, 90), set(12, 100)]],
    ["Deadlifts", "Deadlift", "lower-back", [set(6, 80)]],
    ["Romanian Deadlifts", "Romanian deadlift", "hamstring", [set("", 40)]],
    ["Leg Extension", "Leg extension", "quadriceps", [set(12, 57), set(12, 57)]],
    ["Hamstring Curls", "Hamstring curl", "hamstring", [set(12, 40), set(12, 40)]],
    ["Hip Abduction", "Hip abduction", "", [set("", 60), set("", 60)]],
    ["Hip Adduction", "Hip adduction", "", [set("", 60), set("", 60)]],
  ];
  const blankEntry = (extra) => ({ date: today, time: "14:55", status: "done", notes: "", minutes: 0, pages: 0, chapters: 0, steps: 0, distance: 0, bpm: 0, value: 0, quality: "", mood: "Neutral", lucid: false, section: "", unit: "", bookId: "", songId: "", habitId: "", exercises: [], items: [], sourceBatch: batch, ...extra });
  const pending = workouts.map(([title, name, muscle, sets], i) => ({
    id: `p-5f0c1a-${i + 2}`,
    signature: JSON.stringify(["workout", today, "done", title.toLowerCase()]),
    type: "workout",
    date: today,
    known: { type: "workout", status: "done", title, exercises: [{ name, muscle: muscle || null, sets: sets.map((s) => ({ ...s, reps: s.reps === "" ? null : s.reps })) }] },
    questions: [muscle && sets.every((s) => s.reps !== "") ? "How long did it last, in minutes?" : "How many sets and reps, at what weight, for each exercise?"],
    draft: { entry: blankEntry({ id: `ai-${batch}-${i + 1}`, type: "workout", title, exercises: [{ name, muscle, sets }], sourceItem: i + 1 }), libraries: { books: [], songs: [], habits: [] } },
    turnsOpen: 0,
  }));
  pending.push({
    id: "p-7b1c2d-1",
    signature: JSON.stringify(["food", today, "done", "lunch"]),
    type: "food",
    date: today,
    known: { type: "food", status: "done", title: "Lunch" },
    questions: ["Roughly how much did you eat, so the calories can be estimated?"],
    draft: { entry: blankEntry({ id: "ai-7b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e-0", type: "food", title: "Lunch", items: [
      { name: "Pink Perch fish", servings: 3, calories: "", protein: 0, carbs: 0, fat: 0, estimated: true, estimateNote: "" },
      { name: "Fried eggs", servings: 2, calories: 72, protein: 6, carbs: 0.4, fat: 5, estimated: false, estimateNote: "" },
      { name: "Potato", servings: "", calories: "", protein: 0, carbs: 0, fat: 0, estimated: false, estimateNote: "" },
      { name: "Rice", servings: "", calories: "", protein: 0, carbs: 0, fat: 0, estimated: false, estimateNote: "" },
    ] }), libraries: { books: [], songs: [], habits: [] } },
    turnsOpen: 0,
  });
  const userMessage = "I went to the gym. did 10 minutes of cardio at speed of 6 and inclination of 3 then in that 2 miuntes with inclination of 12. then i did leg press of 4 sets. 1st set of 40 kg, 2nd i added 2 plates 15kg, 3rd set i added 2 plates 10kg, then 4th set i added 2 plates of 5 kg. rep range 8-12. then i did 6 reps of deadlisfts 80kg. then 40kg of Romanian Deadlifts. then 2 sets of 12 reps leg extention with 57kg, then 2 sets of 12 reps of hamstring curls with 40kg. then 2 sets of hip abduction with 60kg the and same 2 sets with 60kg hip adduction.\n\ni ate Pink Perch fish fried. 2 big peices of its torso to tail and 1 small curry piece, i had 2 eggs fried, then i had potato and rice today.";
  const chat = {
    version: 1,
    logDate: today,
    events: [],
    pending,
    messages: [
      { id: "u1", role: "user", content: userMessage, turnId: "turn-old", at: 1 },
      { id: "a1", role: "assistant", content: "", tool_calls: [{ id: "call_old1", type: "function", function: { name: "log_entries", arguments: "{\"entries\":[]}" } }], turnId: "turn-old", at: 2 },
      { id: "t1", role: "tool", tool_call_id: "call_old1", name: "log_entries", content: "{\"logged\":[{\"type\":\"cardio\"}],\"pending\":[]}", card: { kind: "logged", batchId: batch, date: today, entries: [{ id: `ai-${batch}-0`, type: "cardio", date: today, time: "14:55", status: "done", title: "Cardio", detail: "12 min", estimated: false }], pendingIds: pending.slice(0, 7).map((p) => p.id), replaced: [], newLibrary: { books: [], songs: [], habits: [] }, undone: false }, turnId: "turn-old", at: 3 },
      { id: "t2", role: "tool", tool_call_id: "call_old2", name: "log_entries", content: "{}", card: { kind: "logged", batchId: "7b1c2d3e", date: today, entries: [], pendingIds: ["p-7b1c2d-1"], replaced: [], newLibrary: { books: [], songs: [], habits: [] }, undone: false }, turnId: "turn-old", at: 4 },
      { id: "a2", role: "assistant", content: "I've logged your cardio workout and various gym exercises, including leg press, deadlifts, and more. Please confirm portion sizes.", turnId: "turn-old", at: 5 },
    ],
  };
  return { state, chat };
}
