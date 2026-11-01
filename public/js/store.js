// Local state + merge logic.
//
// state = {
//   periods:  { "YYYY-MM-DD": { u: <updated ms>, d?: true (deleted) } },
//   settings: { mode, fixedLength, avgCount, periodLength, showAhead, u },
// }
// Deletions are kept as tombstones so they survive syncing between devices.

const KEY = "pt.state.v1";

export const DEFAULT_SETTINGS = {
  mode: "average", // "average" | "fixed"
  fixedLength: 28,
  avgCount: 6,
  periodLength: 5,
  showAhead: 3,
  u: 0,
};

export function emptyState() {
  return { periods: {}, settings: { ...DEFAULT_SETTINGS } };
}

export function loadState() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return normalize(JSON.parse(raw));
  } catch {}
  return emptyState();
}

export function saveState(state) {
  localStorage.setItem(KEY, JSON.stringify(state));
}

export function normalize(s) {
  return {
    periods: s && typeof s.periods === "object" && s.periods ? s.periods : {},
    settings: { ...DEFAULT_SETTINGS, ...(s && s.settings) },
  };
}

export function setPeriod(state, iso, present) {
  const entry = { u: Date.now() };
  if (!present) entry.d = true;
  state.periods[iso] = entry;
}

export function updateSettings(state, patch) {
  state.settings = { ...state.settings, ...patch, u: Date.now() };
}

// Last-writer-wins per date and for the settings object. Order-independent,
// so devices converge no matter how syncs interleave.
export function merge(a, b) {
  const out = { periods: { ...a.periods }, settings: a.settings };
  for (const [iso, entry] of Object.entries(b.periods)) {
    const mine = out.periods[iso];
    if (!mine || entry.u > mine.u || (entry.u === mine.u && entry.d && !mine.d)) out.periods[iso] = entry;
  }
  if ((b.settings.u || 0) > (a.settings.u || 0)) out.settings = b.settings;
  return normalize(out);
}

export function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export function sameState(a, b) {
  return stableStringify(a) === stableStringify(b);
}
