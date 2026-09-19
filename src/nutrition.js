// Ask the server to estimate calories and macros for foods (see server/nutrition.mjs).
export async function estimateNutrition({ foods, meal = "", description = "", fetchImpl = fetch, signal } = {}) {
  const response = await fetchImpl("/api/nutrition", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ meal, description, foods }),
    signal,
  });
  let payload = {};
  try {
    payload = await response.json();
  } catch {
    payload = {};
  }
  if (!response.ok || !Array.isArray(payload.foods)) throw Error(payload.error || "Nutrition could not be estimated.");
  return payload.foods;
}

// An item with the app's estimate applied (values per serving, portion as the note).
export const applyEstimate = (item, e) => ({
  ...item,
  servings: e.servings,
  calories: e.calories,
  protein: e.protein,
  carbs: e.carbs,
  fat: e.fat,
  estimated: true,
  estimateNote: e.portion,
});

export const needsNutrition = (item) =>
  item.calories === "" || item.calories === null || item.calories === undefined || !(Number(item.servings) > 0);
