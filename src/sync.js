// Turning an in-memory change into a database save: which records were added, changed or removed.
export const COLLECTIONS = ["entries", "books", "songs", "habits", "templates", "favorites"];

/** diffState(prev, next) → { upsert: { entries: [...] }, remove: { entries: [ids] }, profile? } */
export function diffState(prev, next) {
  const changes = { upsert: {}, remove: {} };
  for (const c of COLLECTIONS) {
    const before = new Map((prev[c] || []).map((r) => [r.id, JSON.stringify(r)]));
    const after = new Set((next[c] || []).map((r) => r.id));
    const upserts = (next[c] || []).filter((r) => before.get(r.id) !== JSON.stringify(r));
    const removed = (prev[c] || []).filter((r) => !after.has(r.id)).map((r) => r.id);
    if (upserts.length) changes.upsert[c] = upserts;
    if (removed.length) changes.remove[c] = removed;
  }
  if (JSON.stringify(prev.profile) !== JSON.stringify(next.profile)) changes.profile = next.profile;
  return changes;
}

export const hasChanges = (changes) =>
  Boolean(changes.profile) || COLLECTIONS.some((c) => changes.upsert?.[c]?.length || changes.remove?.[c]?.length);

/** applyChanges(state, changes) → the state with a save applied (the same rule the database uses). */
export function applyChanges(state, changes) {
  const next = { ...state };
  for (const c of COLLECTIONS) {
    const removed = new Set(changes.remove?.[c] || []);
    const upserts = changes.upsert?.[c] || [];
    const byId = new Map(upserts.map((r) => [r.id, r]));
    next[c] = [...(state[c] || []).filter((r) => !removed.has(r.id)).map((r) => byId.get(r.id) || r), ...upserts.filter((r) => !(state[c] || []).some((x) => x.id === r.id))];
  }
  if (changes.profile) next.profile = changes.profile;
  return next;
}

export const recordCount = (state) => COLLECTIONS.reduce((n, c) => n + (state?.[c]?.length || 0), 0);
