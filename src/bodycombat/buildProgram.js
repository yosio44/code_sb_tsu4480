import { FORMATS, roleLabel } from "./roles.js";

const BEAM_WIDTH = 32;
const CHOICE_LIMIT = 16;

export function formatDuration(sec) {
  const s = Math.max(0, Math.round(Number(sec) || 0));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, "0")}`;
}

export function parseDuration(text) {
  const raw = String(text ?? "").trim();
  const clock = raw.match(/^(\d+):(\d{1,2})$/);
  if (clock) {
    const sec = Number(clock[1]) * 60 + Number(clock[2]);
    return Number.isFinite(sec) ? sec : null;
  }
  if (/^\d+$/.test(raw)) return Number(raw);
  return null;
}

export function listReleases(tracks) {
  const map = new Map();
  for (const track of tracks) {
    if (!map.has(track.release)) {
      map.set(track.release, {
        release: track.release,
        label: track.releaseLabel,
        period: track.period,
        sortOrder: track.sortOrder,
      });
    }
  }
  return [...map.values()].sort((a, b) => a.sortOrder - b.sortOrder);
}

function hashString(value) {
  let h = 2166136261;
  const text = String(value);
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return function rand() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle(list, rng) {
  const arr = list.slice();
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    const swap = arr[i];
    arr[i] = arr[j];
    arr[j] = swap;
  }
  return arr;
}

function durationOf(songs) {
  return songs.reduce((sum, song) => sum + song.durationSec, 0);
}

function ratingOf(songs) {
  return songs.reduce((sum, song) => sum + song.rating, 0);
}

function eligible(track, options) {
  if (!options.includeBonus && track.bonus) return false;
  if ((track.rating ?? 0) < (options.minRating ?? 1)) return false;
  if (options.releaseFrom != null && track.sortOrder < options.releaseFrom) return false;
  if (options.releaseTo != null && track.sortOrder > options.releaseTo) return false;
  if (options.release && track.release !== options.release) return false;
  return true;
}

function ranked(list, rng, limit = CHOICE_LIMIT) {
  const weighted = list.map((track) => ({
    track,
    weight: track.rating * track.rating * (0.35 + rng()),
  }));
  weighted.sort((a, b) => b.weight - a.weight || a.track.id.localeCompare(b.track.id));
  const out = weighted.map((row) => row.track);
  const shorts = [...list].sort(
    (a, b) => a.durationSec - b.durationSec || a.id.localeCompare(b.id)
  );
  for (const song of shorts.slice(0, 4)) {
    if (!out.includes(song)) out.push(song);
  }
  return out.slice(0, limit);
}

function templateFor(minutes) {
  const head = [
    { key: "1A", kind: "warmupA" },
    { key: "1B", kind: "warmupB", optional: minutes === 30 },
  ];
  if (minutes === 30) {
    return [
      ...head,
      { key: "2", kind: "track", track: 2 },
      { key: "3", kind: "track", track: 3 },
      { key: "7", kind: "track", track: 7 },
      { key: "closer", kind: "oneOf", tracks: [9, 10] },
    ];
  }
  const middle = [
    { key: "2", kind: "track", track: 2 },
    { key: "3", kind: "track", track: 3 },
    { key: "4", kind: "track", track: 4 },
    { key: "5", kind: "power2" },
    { key: "6", kind: "track", track: 6 },
    { key: "7", kind: "track", track: 7 },
  ];
  if (minutes === 45) {
    return [...head, ...middle, { key: "closer", kind: "oneOf", tracks: [8, 9, 10] }];
  }
  return [
    ...head,
    ...middle,
    { key: "8", kind: "track", track: 8 },
    { key: "9", kind: "track", track: 9 },
    { key: "10", kind: "track", track: 10 },
  ];
}

function songsForNumber(pool, trackNum) {
  const direct = pool.filter((track) => track.trackNum === trackNum && track.part !== "c");
  if (direct.length) return direct;
  return pool.filter((track) => track.trackNum === trackNum);
}

function shortest(list) {
  if (!list.length) return null;
  return [...list].sort((a, b) => a.durationSec - b.durationSec || a.id.localeCompare(b.id))[0];
}

function choiceList(slot, pool, rng) {
  if (slot.kind === "warmupA") {
    const split = pool.filter((track) => track.role === "1A");
    const whole = pool.filter((track) => track.trackNum === 1 && track.part === "");
    return [
      ...ranked(split, rng).map((track) => [track]),
      ...ranked(whole, rng).map((track) => [track]),
    ];
  }
  if (slot.kind === "warmupB") {
    return ranked(
      pool.filter((track) => track.role === "1B"),
      rng
    ).map((track) => [track]);
  }
  if (slot.kind === "power2") {
    const fullSongs = pool.filter((track) => track.trackNum === 5 && track.part === "");
    const firstSongs = pool.filter((track) => track.role === "5A");
    const secondSongs = pool.filter((track) => track.role === "5B");
    const full = ranked(fullSongs, rng).map((track) => [track]);
    const first = ranked(firstSongs, rng, 6);
    const second = ranked(secondSongs, rng, 6);
    const pairs = [];
    for (const a of first) {
      for (const b of second) pairs.push([a, b]);
    }
    const shortA = shortest(firstSongs);
    const shortB = shortest(secondSongs);
    if (shortA && shortB) pairs.push([shortA, shortB]);
    if (!secondSongs.length) {
      for (const a of first) pairs.push([a]);
      if (shortA) pairs.push([shortA]);
    }
    if (!firstSongs.length && shortB) pairs.push([shortB]);
    return [...full, ...pairs].slice(0, 28);
  }
  if (slot.kind === "oneOf") {
    const all = slot.tracks.flatMap((trackNum) => songsForNumber(pool, trackNum));
    return ranked(all, rng).map((track) => [track]);
  }
  return ranked(songsForNumber(pool, slot.track), rng).map((track) => [track]);
}

function minimumDuration(slot, pool) {
  if (slot.optional) return 0;
  if (slot.kind === "warmupA") {
    const options = pool.filter((track) => track.role === "1A" || (track.trackNum === 1 && track.part === ""));
    return options.length ? Math.min(...options.map((track) => track.durationSec)) : 0;
  }
  if (slot.kind === "warmupB") {
    const options = pool.filter((track) => track.role === "1B");
    return options.length ? Math.min(...options.map((track) => track.durationSec)) : 0;
  }
  if (slot.kind === "power2") {
    const full = pool.filter((track) => track.trackNum === 5 && track.part === "");
    const first = pool.filter((track) => track.role === "5A");
    const second = pool.filter((track) => track.role === "5B");
    const candidates = [];
    if (full.length) candidates.push(Math.min(...full.map((track) => track.durationSec)));
    if (first.length && second.length) {
      candidates.push(
        Math.min(...first.map((track) => track.durationSec)) +
          Math.min(...second.map((track) => track.durationSec))
      );
    } else if (first.length) candidates.push(Math.min(...first.map((track) => track.durationSec)));
    else if (second.length) candidates.push(Math.min(...second.map((track) => track.durationSec)));
    return candidates.length ? Math.min(...candidates) : 0;
  }
  const options =
    slot.kind === "oneOf"
      ? slot.tracks.flatMap((trackNum) => songsForNumber(pool, trackNum))
      : songsForNumber(pool, slot.track);
  return options.length ? Math.min(...options.map((track) => track.durationSec)) : 0;
}

function restMin(slots, index, pool, fullTrack1) {
  let sum = 0;
  for (let i = index + 1; i < slots.length; i += 1) {
    const slot = slots[i];
    if (slot.optional) continue;
    if (slot.kind === "warmupB" && fullTrack1) continue;
    sum += minimumDuration(slot, pool);
  }
  return sum;
}

function findById(tracks, id) {
  if (!id) return null;
  return tracks.find((track) => track.id === id) || null;
}

function lockedChoices(slot, locks, tracks) {
  if (!locks) return null;
  if (slot.kind === "power2") {
    const full = findById(tracks, locks["5"]);
    const a = findById(tracks, locks["5A"]);
    const b = findById(tracks, locks["5B"]);
    if (full) return [[full]];
    if (a && b) return [[a, b]];
    if (a) return [[a]];
    if (b) return [[b]];
    return null;
  }
  if (slot.kind === "oneOf") {
    for (const trackNum of slot.tracks) {
      const song = findById(tracks, locks[String(trackNum)]);
      if (song) return [[song]];
    }
    const closer = findById(tracks, locks[slot.key]);
    return closer ? [[closer]] : null;
  }
  const song = findById(tracks, locks[slot.key]);
  return song ? [[song]] : null;
}

function stamp(songs, slot) {
  return songs.map((song) => {
    let key = slot.key;
    if (slot.kind === "warmupA") key = song.part === "" ? "1" : "1A";
    else if (slot.kind === "warmupB") key = "1B";
    else if (slot.kind === "power2") {
      if (song.part === "a") key = "5A";
      else if (song.part === "b") key = "5B";
      else key = "5";
    } else if (slot.kind === "track" || slot.kind === "oneOf") key = String(song.trackNum);
    return { ...song, slot: key };
  });
}

function unused(state, choice) {
  const ids = new Set(state.songs.map((song) => song.id));
  return !choice.some((song) => ids.has(song.id));
}

function compareKeys(a, b) {
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i += 1) {
    if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) > (b[i] ?? 0) ? 1 : -1;
  }
  return 0;
}

function stateKey(state) {
  return [
    state.missing.length === 0 && state.duration <= state.target ? 1 : 0,
    -state.missing.length,
    state.ratingSum,
    state.songs.length,
    state.has1B ? 1 : 0,
    state.powerPair ? 1 : 0,
    state.tie,
  ];
}

function betterState(a, b) {
  return compareKeys(stateKey(a), stateKey(b)) > 0;
}

function buildOne(tracks, options) {
  const minutes = options.minutes;
  const target = minutes * 60;
  const rng = mulberry32(options.seed >>> 0);
  const pool = tracks.filter((track) => eligible(track, options));
  const slots = templateFor(minutes);

  let beam = [
    {
      songs: [],
      duration: 0,
      ratingSum: 0,
      fullTrack1: false,
      has1B: false,
      powerPair: false,
      missing: [],
      tie: 0,
      target,
    },
  ];

  slots.forEach((slot, index) => {
    const next = [];
    for (const state of beam) {
      if (slot.kind === "warmupB" && state.fullTrack1) {
        next.push(state);
        continue;
      }
      const forced = lockedChoices(slot, options.locks, tracks);
      let choices = (forced || choiceList(slot, pool, rng)).filter(
        (choice) => choice.length && unused(state, choice)
      );
      const strict = choices.filter((choice) => {
        const usesFullWarmup =
          state.fullTrack1 ||
          (slot.kind === "warmupA" && choice.some((song) => song.trackNum === 1 && song.part === ""));
        return state.duration + durationOf(choice) + restMin(slots, index, pool, usesFullWarmup) <= target;
      });
      const usable = forced ? choices : strict;
      if (!usable.length) {
        if (slot.optional) {
          next.push(state);
        } else {
          next.push({ ...state, missing: state.missing.concat(slot.key) });
        }
        continue;
      }
      for (const choice of usable) {
        const stamped = stamp(choice, slot);
        const fullTrack1 = state.fullTrack1 || stamped.some((song) => song.slot === "1");
        next.push({
          songs: state.songs.concat(stamped),
          duration: state.duration + durationOf(stamped),
          ratingSum: state.ratingSum + ratingOf(stamped),
          fullTrack1,
          has1B: state.has1B || stamped.some((song) => song.slot === "1B"),
          powerPair: state.powerPair || stamped.some((song) => song.slot === "5A" || song.slot === "5B"),
          missing: state.missing.slice(),
          tie: state.tie + stamped.reduce((sum, song) => sum + hashString(`${song.id}:${options.seed}`), 0),
          target,
        });
      }
    }
    next.sort((a, b) => compareKeys(stateKey(b), stateKey(a)));
    beam = next.slice(0, BEAM_WIDTH);
  });

  const best = beam.slice().sort((a, b) => compareKeys(stateKey(b), stateKey(a)))[0] || {
    songs: [],
    duration: 0,
    ratingSum: 0,
    missing: slots.map((slot) => slot.key),
  };
  const durationSec = best.duration || 0;
  const missingSlots = best.missing || [];
  return {
    minutes,
    targetSec: target,
    durationSec,
    fits: durationSec <= target && missingSlots.length === 0 && best.songs.length > 0,
    songs: best.songs,
    missingSlots,
    ratingSum: best.ratingSum || 0,
    seed: options.seed >>> 0,
    release: options.release || null,
    format: FORMATS[minutes],
  };
}

export function buildProgram(tracks, options = {}) {
  const minutes = Number(options.minutes);
  if (!FORMATS[minutes]) {
    throw new Error("minutes must be 30, 45, or 60");
  }
  const seed = Number.isFinite(Number(options.seed)) ? Number(options.seed) : 1;
  const normalized = {
    minutes,
    seed,
    minRating: options.minRating ?? 1,
    includeBonus: Boolean(options.includeBonus),
    releaseFrom: options.releaseFrom ?? null,
    releaseTo: options.releaseTo ?? null,
    release: options.release || null,
    locks: options.locks || null,
  };
  if (options.sameRelease === "auto") {
    const releases = listReleases(
      tracks.filter((track) => eligible(track, { ...normalized, release: null }))
    ).filter((release) => releaseCanAttempt(tracks, release.release, minutes, normalized));
    let best = null;
    for (const release of releases) {
      const result = buildOne(tracks, { ...normalized, release: release.release });
      if (!result.fits) continue;
      if (!best || betterState(resultToState(result), resultToState(best))) best = result;
    }
    return (
      best || {
        minutes,
        targetSec: minutes * 60,
        durationSec: 0,
        fits: false,
        songs: [],
        missingSlots: ["1A"],
        ratingSum: 0,
        seed,
        release: null,
        format: FORMATS[minutes],
      }
    );
  }
  if (options.sameRelease && options.sameRelease !== "mix") {
    normalized.release = options.sameRelease;
  }
  return buildOne(tracks, normalized);
}

function releaseCanAttempt(tracks, release, minutes, options) {
  const songs = tracks.filter((track) => track.release === release && eligible(track, { ...options, release }));
  const nums = new Set(songs.map((track) => track.trackNum));
  const required = minutes === 30 ? [1, 2, 3, 7] : [1, 2, 3, 4, 5, 6, 7];
  if (!required.every((num) => nums.has(num))) return false;
  if (minutes === 60) return [8, 9, 10].every((num) => nums.has(num));
  if (minutes === 45) return [8, 9, 10].some((num) => nums.has(num));
  return [9, 10].some((num) => nums.has(num));
}

function resultToState(result) {
  return {
    missing: result.missingSlots,
    duration: result.durationSec,
    target: result.targetSec,
    ratingSum: result.ratingSum,
    songs: result.songs,
    has1B: result.songs.some((song) => song.slot === "1B"),
    powerPair: result.songs.some((song) => song.slot === "5A"),
    tie: 0,
  };
}

export function replaceSong(result, slot, song) {
  const songs = result.songs.map((current) => (current.slot === slot ? { ...song, slot } : current));
  const durationSec = durationOf(songs);
  const ratingSum = ratingOf(songs);
  return {
    ...result,
    songs,
    durationSec,
    ratingSum,
    fits: durationSec <= result.targetSec && result.missingSlots.length === 0 && songs.length > 0,
  };
}

export function candidatesForSlot(tracks, slot, options = {}) {
  const pool = tracks.filter((track) =>
    eligible(track, {
      includeBonus: Boolean(options.includeBonus),
      minRating: 1,
      releaseFrom: options.releaseFrom ?? null,
      releaseTo: options.releaseTo ?? null,
      release: options.release || null,
    })
  );
  if (slot === "1" || slot === "1A") {
    return pool.filter((track) => track.role === "1A" || (track.trackNum === 1 && track.part === ""));
  }
  if (slot === "1B") return pool.filter((track) => track.role === "1B");
  if (slot === "5") return pool.filter((track) => track.trackNum === 5 && track.part === "");
  if (slot === "5A") return pool.filter((track) => track.role === "5A");
  if (slot === "5B") return pool.filter((track) => track.role === "5B");
  const trackNum = Number(slot);
  if (!trackNum) return [];
  return songsForNumber(pool, trackNum);
}

export function programToText(result) {
  const header = `${result.minutes}分プログラム（合計 ${formatDuration(result.durationSec)} / ${result.minutes}:00）`;
  const lines = result.songs.map((song, index) => {
    const artist = song.artist ? ` / ${song.artist}` : "";
    return `${index + 1}. ${song.releaseLabel} ${roleLabel(song.role)} ${song.title}${artist} ${formatDuration(song.durationSec)} ★${song.rating}`;
  });
  if (result.missingSlots.length) {
    lines.push(`時間内に入らなかった枠: ${result.missingSlots.join(", ")}`);
  }
  return [header, ...lines].join("\n");
}

export function slotLabel(song) {
  return roleLabel(song.role);
}
