/** Persisted rating and duration edits. The catalog itself keeps placeholders. */

export const META_STORAGE_KEY = "bodycombat:meta:v1";

function storageOf(storage) {
  return storage || globalThis.localStorage;
}

export function loadMeta(storage) {
  const store = storageOf(storage);
  if (!store) return {};
  try {
    const raw = store.getItem(META_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return parsed;
  } catch {
    return {};
  }
}

export function saveMeta(meta, storage) {
  storageOf(storage).setItem(META_STORAGE_KEY, JSON.stringify(meta));
}

function clampInt(value, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.min(max, Math.max(min, Math.round(n)));
}

export function applyMeta(tracks, meta) {
  const saved = meta || {};
  return tracks.map((track) => {
    const row = saved[track.id];
    if (!row || typeof row !== "object") {
      return { ...track, ratingCustom: false, durationCustom: false };
    }
    const rating = clampInt(row.rating, 1, 5);
    const durationSec = clampInt(row.durationSec, 30, 15 * 60);
    return {
      ...track,
      rating: rating == null ? track.rating : rating,
      durationSec: durationSec == null ? track.durationSec : durationSec,
      ratingCustom: rating != null,
      durationCustom: durationSec != null,
    };
  });
}
