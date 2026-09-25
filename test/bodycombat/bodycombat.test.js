import { test } from "node:test";
import assert from "node:assert/strict";

import { tracks } from "../../src/bodycombat/catalog.js";
import { applyMeta, loadMeta, saveMeta, META_STORAGE_KEY } from "../../src/bodycombat/metaStore.js";
import {
  buildProgram,
  candidatesForSlot,
  clampBufferMin,
  formatDuration,
  parseDuration,
  programToText,
  replaceSong,
} from "../../src/bodycombat/buildProgram.js";
import {
  CUSTOM_STORAGE_KEY,
  loadCustomFormat,
  moveRole,
  resizeRoles,
  saveCustomFormat,
} from "../../src/bodycombat/customFormat.js";

function memoryStorage() {
  const values = new Map();
  return {
    getItem(key) {
      return values.has(key) ? values.get(key) : null;
    },
    setItem(key, value) {
      values.set(key, String(value));
    },
  };
}

function song(partial) {
  return {
    id: partial.id,
    release: partial.release || "1",
    releaseLabel: partial.releaseLabel || `BC${partial.release || "1"}`,
    period: "",
    sortOrder: partial.sortOrder || Number(partial.release || 1),
    trackNum: partial.trackNum,
    part: partial.part || "",
    bonus: Boolean(partial.bonus),
    role: partial.role,
    title: partial.title || partial.id,
    artist: partial.artist || "",
    sourceUrl: "https://example.test",
    durationSec: partial.durationSec,
    rating: partial.rating,
  };
}

test("catalog stores BodyCombat tracks from the release pages", () => {
  assert.ok(tracks.length > 800);
  const heart = tracks.find((track) => track.id === "BC1-1");
  assert.equal(heart.title, "My Heart Will Go On");
  assert.equal(heart.artist, "Celine Dion");
  assert.equal(tracks.some((track) => track.id === "BC100-3"), true);
  assert.equal(tracks.some((track) => track.release === "2"), false);
  for (const track of tracks) {
    assert.ok(track.title.length >= 2);
    assert.ok(track.durationSec >= 30);
    assert.ok(track.rating >= 1 && track.rating <= 5);
    assert.ok(track.sourceUrl.startsWith("https://www.fhstr.net/"));
  }
});

test("30, 45, and 60 minute programs stay inside the selected time", () => {
  for (const minutes of [30, 45, 60]) {
    const program = buildProgram(tracks, { minutes, seed: 3 });
    assert.equal(program.fits, true, `${minutes} missing ${program.missingSlots.join(",")}`);
    assert.ok(program.durationSec <= minutes * 60);
    assert.ok(program.songs.length >= (minutes === 30 ? 5 : 8));
    const order = program.songs.map((song) => song.trackNum);
    const sorted = [...order].sort((a, b) => a - b);
    assert.deepEqual(order, sorted);
  }
});

test("each duration keeps the class structure", () => {
  const short = buildProgram(tracks, { minutes: 30, seed: 1 });
  const nums30 = new Set(short.songs.map((song) => song.trackNum));
  for (const required of [1, 2, 3, 7]) assert.equal(nums30.has(required), true);
  assert.equal([...nums30].some((num) => num === 9 || num === 10), true);
  assert.equal(nums30.has(4), false);
  assert.equal(nums30.has(6), false);
  assert.ok(short.songs.length <= 6);

  const mid = buildProgram(tracks, { minutes: 45, seed: 1 });
  const nums45 = [...mid.songs.map((song) => song.trackNum)];
  for (const required of [1, 2, 3, 4, 5, 6, 7]) assert.equal(nums45.includes(required), true);
  const closers = nums45.filter((num) => num >= 8);
  assert.equal(closers.length, 1);

  const full = buildProgram(tracks, { minutes: 60, seed: 1 });
  const nums60 = new Set(full.songs.map((song) => song.trackNum));
  for (let num = 1; num <= 10; num += 1) assert.equal(nums60.has(num), true);
});

test("a different seed can choose different songs", () => {
  const first = buildProgram(tracks, { minutes: 45, seed: 1 }).songs.map((song) => song.id).join("|");
  const second = buildProgram(tracks, { minutes: 45, seed: 2 }).songs.map((song) => song.id).join("|");
  const third = buildProgram(tracks, { minutes: 45, seed: 8 }).songs.map((song) => song.id).join("|");
  assert.ok(first !== second || second !== third);
});

test("minimum rating, locks, and a single release are respected", () => {
  const rated = buildProgram(tracks, { minutes: 30, seed: 4, minRating: 5 });
  assert.ok(rated.songs.every((song) => song.rating >= 5));

  const sample = buildProgram(tracks, { minutes: 45, seed: 1 });
  const locked = sample.songs.find((song) => song.slot === "2");
  const again = buildProgram(tracks, { minutes: 45, seed: 99, locks: { 2: locked.id } });
  assert.equal(again.songs.find((song) => song.slot === "2").id, locked.id);

  const one = buildProgram(tracks, { minutes: 60, seed: 1, sameRelease: "80" });
  assert.equal(one.fits, true);
  assert.ok(one.songs.every((song) => song.release === "80"));
});

test("songs that cannot fit leave the program inside the time limit", () => {
  const long = [1, 2, 3, 7, 9].map((trackNum) =>
    song({
      id: `long-${trackNum}`,
      trackNum,
      role: String(trackNum),
      durationSec: 1000,
      rating: 5,
    })
  );
  const program = buildProgram(long, { minutes: 30, seed: 1 });
  assert.equal(program.fits, false);
  assert.ok(program.durationSec <= 30 * 60);
});

test("shorter songs are chosen when a higher-rated song does not fit", () => {
  const tracksForSlot = (trackNum, role) => [
    song({ id: `${role}-long`, trackNum, role, durationSec: 1700, rating: 5 }),
    song({ id: `${role}-short`, trackNum, role, durationSec: 200, rating: 2 }),
  ];
  const pool = [
    ...tracksForSlot(1, "1"),
    ...tracksForSlot(2, "2"),
    ...tracksForSlot(3, "3"),
    ...tracksForSlot(7, "7"),
    ...tracksForSlot(10, "10"),
  ];
  const program = buildProgram(pool, { minutes: 30, seed: 1 });
  assert.equal(program.fits, true);
  assert.ok(program.songs.every((song) => song.id.endsWith("-short")));
});

test("replacing a song can push the program over the limit", () => {
  const program = buildProgram(tracks, { minutes: 30, seed: 1 });
  const huge = { ...program.songs[0], durationSec: 50 * 60, title: "very long" };
  const next = replaceSong(program, program.songs[0].slot, huge);
  assert.equal(next.fits, false);
  assert.ok(next.durationSec > next.targetSec);
});

test("rating and duration edits round-trip through local storage", () => {
  const storage = memoryStorage();
  saveMeta({ "BC1-1": { rating: 5, durationSec: 200 } }, storage);
  const meta = loadMeta(storage);
  assert.equal(storage.getItem(META_STORAGE_KEY).includes("BC1-1"), true);
  const [edited] = applyMeta([tracks.find((track) => track.id === "BC1-1")], meta);
  assert.equal(edited.rating, 5);
  assert.equal(edited.durationSec, 200);
  assert.equal(edited.ratingCustom, true);
});

test("duration text and program export", () => {
  assert.equal(parseDuration("4:05"), 245);
  assert.equal(formatDuration(245), "4:05");
  const program = buildProgram(tracks, { minutes: 30, seed: 1 });
  assert.match(programToText(program), /^30分プログラム/);
});

test("invalid class length is rejected", () => {
  assert.throws(() => buildProgram(tracks, { minutes: 20 }), /30, 45, or 60/);
});

test("grace time shortens the song budget and keeps the class order", () => {
  assert.equal(clampBufferMin(60, 5), 5);
  assert.equal(clampBufferMin(60, 0), 0);
  assert.equal(clampBufferMin(30, 40), 15);
  assert.equal(clampBufferMin(60, -2), 0);

  const full = buildProgram(tracks, { minutes: 60, seed: 1, bufferMin: 5 });
  assert.equal(full.minutes, 60);
  assert.equal(full.bufferMin, 5);
  assert.equal(full.targetSec, 55 * 60);
  assert.equal(full.fits, true);
  assert.ok(full.durationSec <= full.targetSec);
  const nums = new Set(full.songs.map((song) => song.trackNum));
  for (let num = 1; num <= 10; num += 1) assert.equal(nums.has(num), true);
  assert.match(programToText(full), /60分プログラム（合計 .+ \/ 55:00、猶予5分）/);

  const plain = buildProgram(tracks, { minutes: 60, seed: 1 });
  assert.equal(plain.bufferMin, 0);
  assert.equal(plain.targetSec, 60 * 60);
  assert.doesNotMatch(programToText(plain), /猶予/);

  const short = buildProgram(tracks, { minutes: 30, seed: 1, bufferMin: 5 });
  assert.equal(short.targetSec, 25 * 60);
  assert.ok(short.durationSec <= short.targetSec);
  assert.equal(short.fits, true);
});

test("a custom order keeps the chosen roles, count, and time", () => {
  const program = buildProgram(tracks, {
    minutes: 30,
    seed: 2,
    customRoles: ["10", "7", "2", "1A"],
  });
  assert.equal(program.format.title, "カスタム");
  assert.equal(program.fits, true);
  assert.ok(program.durationSec <= 30 * 60);
  assert.deepEqual(
    program.songs.map((song) => song.role),
    ["10", "7", "2", "1A"]
  );
  assert.match(programToText(program), /^カスタム 30分プログラム/);
  const choices = candidatesForSlot(tracks, program.songs[1].slot);
  assert.ok(choices.every((song) => song.role === "7"));
});

test("custom slots can repeat a role and still use different songs", () => {
  const pool = [
    song({ id: "muay-a", trackNum: 7, role: "7", durationSec: 180, rating: 4 }),
    song({ id: "muay-b", trackNum: 7, role: "7", durationSec: 200, rating: 5, release: "4", sortOrder: 4 }),
    song({ id: "cool", trackNum: 10, role: "10", durationSec: 180, rating: 3 }),
  ];
  const program = buildProgram(pool, { minutes: 30, seed: 1, customRoles: ["7", "7", "10"] });
  assert.equal(program.fits, true);
  assert.deepEqual(
    program.songs.map((item) => item.trackNum),
    [7, 7, 10]
  );
  assert.equal(new Set(program.songs.map((item) => item.id)).size, 3);

  const thin = pool.filter((item) => item.id !== "muay-b");
  const missing = buildProgram(thin, { minutes: 30, seed: 1, customRoles: ["7", "7", "10"] });
  assert.equal(missing.fits, false);
  assert.equal(missing.songs.filter((item) => item.trackNum === 7).length, 1);
});

test("a full power track stays separate from its split parts", () => {
  const pool = [
    song({ id: "half", trackNum: 5, role: "5A", part: "a", durationSec: 140, rating: 5 }),
    song({ id: "full", trackNum: 5, role: "5", durationSec: 220, rating: 1 }),
  ];
  const program = buildProgram(pool, { minutes: 30, seed: 1, customRoles: ["5"] });
  assert.equal(program.songs[0].id, "full");
  const halves = buildProgram(pool, { minutes: 30, seed: 1, customRoles: ["5A"] });
  assert.equal(halves.songs[0].id, "half");
});

test("custom format edits round-trip and ignore unknown roles", () => {
  const storage = memoryStorage();
  saveCustomFormat({ minutes: 60, roles: ["7", "nope", "10"], selected: true }, storage);
  assert.equal(storage.getItem(CUSTOM_STORAGE_KEY).includes("60"), true);
  const loaded = loadCustomFormat(storage);
  assert.deepEqual(loaded.roles, ["7", "10"]);
  assert.equal(loaded.minutes, 60);
  assert.equal(loaded.selected, true);
  assert.deepEqual(resizeRoles(["7"], 3), ["7", "1A", "1B"]);
  assert.deepEqual(moveRole(["10", "7", "2"], 2, -1), ["10", "2", "7"]);
  const empty = buildProgram(tracks, { minutes: 45, customRoles: ["nope"] });
  assert.equal(empty.fits, false);
  assert.equal(empty.songs.length, 0);
});
