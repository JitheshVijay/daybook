// Advisory grounding check: does an assistant's quote come from what the user wrote?
// Exact excerpt, or most words present with every number present.
const normalize = (s) => (s || "").trim().replace(/\s+/g, " ").toLowerCase();
const tokens = (s) =>
  normalize(s)
    .replace(/(\d),(\d{3})\b/g, "$1$2")
    .match(/[\p{L}\p{N}]+/gu) || [];

export function traced(text, source) {
  const haystack = normalize(text);
  const quote = normalize(source);
  if (!quote || quote === "original paragraph") return false;
  if (haystack.includes(quote)) return true;
  const have = new Set(tokens(text));
  const want = tokens(source);
  if (want.length < 3) return false;
  const hits = want.filter((w) => have.has(w)).length;
  return (
    want.filter((w) => /\p{N}/u.test(w)).every((w) => have.has(w)) &&
    hits / want.length >= 0.8
  );
}

// Small deterministic hash (FNV-1a, two passes) for idempotent batch ids.
export function stableId(input, length = 32) {
  let out = "";
  let seed = 0x811c9dc5;
  while (out.length < length) {
    let h = seed;
    for (let i = 0; i < input.length; i++) {
      h ^= input.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    out += h.toString(16).padStart(8, "0");
    seed = (h ^ 0x9e3779b9) >>> 0;
  }
  return out.slice(0, length);
}
