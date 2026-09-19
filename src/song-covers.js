// Album art for songs from the iTunes Search API (no key; the browser may call it directly).
// iTunes ranks results by relevance, so the first recording with the song's title is usually the
// well-known original. Matching, in order:
// - the title must match, allowing a small typo ("Aruvian Dance" finds "Aruarian Dance", and the
//   title is corrected);
// - with an artist, that artist's recording is used (a typo in the artist is corrected); if iTunes
//   has no recording by that artist, the best-known recording's art is shown and the artist is kept;
// - without an artist, the app's assistant picks the intended song from the iTunes recordings
//   (fixing a misspelled title) or says it's an exercise; without that answer nothing is guessed.
export const COVER_LOOKUP_VERSION = 3;
const clean = (value) =>
  String(value || "")
    .toLocaleLowerCase()
    .replace(/\s*[([].*?[)\]]\s*/g, " ")
    .replace(/\s+-\s+.*$/, "")
    .replace(/&/g, "and")
    .replace(/[^\p{L}\p{N} ]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
const plainTitle = (trackName) => String(trackName || "").replace(/\s*[([].*?[)\]]\s*/g, " ").replace(/\s+-\s+.*$/, "").replace(/\s+/g, " ").trim();
const VERSION_WORDS = /\b(live|remaster(ed)?|demo|acoustic|karaoke|instrumental|cover|tribute|version|edit|mix|slowed|sped|reverb|interlude)\b/i;

function distance(a, b) {
  if (Math.abs(a.length - b.length) > 2) return 3;
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) row[j] = Math.min(previous[j] + 1, row[j - 1] + 1, previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    previous = row;
  }
  return previous[b.length];
}
// Close enough to be the same name with a typo: one edit for short names, two for long ones.
const nearName = (found, wanted) => found === wanted || (wanted.length >= 5 && distance(found, wanted) <= (wanted.length >= 10 ? 2 : 1));

export function pickSongMatch(song, results) {
  const title = clean(song.title);
  const tracks = (results || []).filter((r) => r && r.kind === "song" && typeof r.artworkUrl100 === "string" && /^https:\/\//.test(r.artworkUrl100));
  const titled = tracks.filter((r) => nearName(clean(r.trackName), title));
  if (!titled.length) return null;
  const exact = titled.filter((r) => clean(r.trackName) === title);
  const pool = exact.length ? exact : titled;
  let candidates;
  let artist = null;
  if (song.artist) {
    const wanted = clean(song.artist);
    const byArtist = pool.filter((r) => {
      const found = clean(r.artistName);
      return found === wanted || found.includes(wanted) || wanted.includes(found) || (wanted.length >= 6 && distance(found, wanted) <= 2);
    });
    if (byArtist.length) {
      candidates = byArtist;
      const found = clean(byArtist[0].artistName);
      if (!(found === wanted || found.includes(wanted) || wanted.includes(found))) artist = byArtist[0].artistName; // fix a typo
    } else candidates = [pool[0]]; // their artist isn't on iTunes: show the song's best-known art
  } else return null; // which recording is meant needs an artist
  const pick = candidates.find((r) => !VERSION_WORDS.test(`${r.trackName} ${r.collectionName || ""}`)) || candidates[0];
  return {
    cover: pick.artworkUrl100.replace(/\/\d+x\d+(bb)?(-\d+)?\.(jpg|png|webp)$/i, "/600x600bb.$3"),
    artist,
    title: exact.length ? null : plainTitle(pick.trackName),
  };
}

async function searchItunes(term, fetchImpl) {
  const params = new URLSearchParams({ term, media: "music", entity: "song", limit: "15" });
  const response = await fetchImpl(`https://itunes.apple.com/search?${params}`, { signal: AbortSignal.timeout(8000) });
  if (!response.ok) return null;
  const data = await response.json();
  return Array.isArray(data.results) ? data.results : null;
}

export async function lookupSongCover(song, fetchImpl = fetch) {
  const results = await searchItunes([song.artist, song.title].filter(Boolean).join(" "), fetchImpl);
  return results ? pickSongMatch(song, results) : null;
}

// Ask the app server which song each title means, given the recordings iTunes found.
export async function identifySongs(entries, fetchImpl = fetch) {
  const response = await fetchImpl("/api/songs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ songs: entries }),
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) return null;
  const data = await response.json();
  return Array.isArray(data.songs) && data.songs.length === entries.length ? data.songs : null;
}

const candidatesFrom = (results) =>
  [...new Map((results || []).filter((r) => r?.kind === "song" && r.trackName && r.artistName).map((r) => [`${clean(r.trackName)}|${clean(r.artistName)}`, { title: String(r.trackName).slice(0, 300), artist: String(r.artistName).slice(0, 300) }])).values()].slice(0, 10);

export async function fillSongCovers(commit, songs, fetchImpl = fetch) {
  const missing = songs.filter((s) => s && !s.cover && s.title);
  const searched = [];
  for (let index = 0; index < missing.length; index++) {
    const song = missing[index];
    try {
      if (index) await new Promise((resolve) => setTimeout(resolve, 400));
      const results = await searchItunes([song.artist, song.title].filter(Boolean).join(" "), fetchImpl);
      if (results?.length) searched.push({ song, results });
    } catch {
      /* Album art is optional; the song and its practice history are unaffected. */
    }
  }
  const unnamed = searched.filter((x) => !x.song.artist);
  let identified = null;
  if (unnamed.length) {
    try {
      identified = await identifySongs(unnamed.map((x) => ({ title: x.song.title, artist: null, candidates: candidatesFrom(x.results) })), fetchImpl);
    } catch {
      identified = null;
    }
  }
  for (const { song, results } of searched) {
    const info = song.artist ? null : identified?.[unnamed.findIndex((x) => x.song === song)];
    if (!song.artist && !info?.known) continue;
    const target = song.artist ? song : { title: info.title, artist: info.artist };
    const match = pickSongMatch(target, results);
    if (!match) continue;
    const title = match.title || (target.title !== song.title ? target.title : null);
    const artist = match.artist || (song.artist ? null : target.artist);
    commit((state) => ({
      ...state,
      songs: state.songs.map((current) =>
        current.id === song.id && !current.cover && current.title === song.title && (current.artist || "") === (song.artist || "")
          ? { ...current, cover: match.cover, artist: artist || current.artist, title: title || current.title }
          : current,
      ),
    }));
  }
}
