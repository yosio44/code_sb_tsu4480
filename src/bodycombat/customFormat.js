/** One saved custom class: a time plus an ordered list of track roles. */

export const CUSTOM_STORAGE_KEY = "bodycombat:custom-format:v1";
export const MAX_CUSTOM_SONGS = 16;

export const CUSTOM_ROLE_OPTIONS = [
  { id: "1A", label: "ウォーミングアップ（上半身）" },
  { id: "1B", label: "ウォーミングアップ（下半身）" },
  { id: "1", label: "ウォーミングアップ（分割なし）" },
  { id: "1C", label: "ウォーミングアップ（追加）" },
  { id: "2", label: "コンバット1" },
  { id: "3", label: "パワー1" },
  { id: "4", label: "コンバット2" },
  { id: "4A", label: "コンバット2（A）" },
  { id: "4B", label: "コンバット2（B）" },
  { id: "5", label: "パワー2" },
  { id: "5A", label: "パワー2（前半）" },
  { id: "5B", label: "パワー2（後半）" },
  { id: "6", label: "コンバット3" },
  { id: "7", label: "ムエタイ" },
  { id: "8", label: "パワー3" },
  { id: "9", label: "筋力コンディショニング" },
  { id: "10", label: "クールダウン" },
];

const ROLE_IDS = new Set(CUSTOM_ROLE_OPTIONS.map((option) => option.id));
const EXACT_ROLES = new Set(["1A", "1B", "1C", "4A", "4B", "5A", "5B"]);
const FILL_ROLES = ["1A", "1B", "2", "3", "4", "5", "6", "7", "8", "9", "10"];

export const DEFAULT_CUSTOM_FORMAT = {
  minutes: 45,
  roles: ["1A", "1B", "2", "3", "4", "5", "6", "7", "8"],
  selected: false,
};

export function customRoleLabel(roleId) {
  return CUSTOM_ROLE_OPTIONS.find((option) => option.id === roleId)?.label || String(roleId || "");
}

export function normalizeRoleList(roles) {
  if (!Array.isArray(roles)) return [];
  return roles
    .map((roleId) => String(roleId))
    .filter((roleId) => ROLE_IDS.has(roleId))
    .slice(0, MAX_CUSTOM_SONGS);
}

export function normalizeCustomFormat(value) {
  const minutes = [30, 45, 60].includes(Number(value?.minutes)) ? Number(value.minutes) : DEFAULT_CUSTOM_FORMAT.minutes;
  const roles = normalizeRoleList(value?.roles);
  return {
    minutes,
    roles: roles.length ? roles : DEFAULT_CUSTOM_FORMAT.roles.slice(),
    selected: Boolean(value?.selected),
  };
}

export function describeCustom(format) {
  return `${format.minutes}分・${format.roles.length}曲。並びは下の順番です。リリースによって曲の分かれ方が違うときは、ここで種類と曲数を合わせます。`;
}

export function resizeRoles(roles, count) {
  const size = Math.min(MAX_CUSTOM_SONGS, Math.max(1, count));
  const next = roles.slice(0, size);
  while (next.length < size) {
    const unused = FILL_ROLES.find((roleId) => !next.includes(roleId));
    next.push(unused || "3");
  }
  return next;
}

export function moveRole(roles, index, delta) {
  const next = roles.slice();
  const to = index + delta;
  if (index < 0 || index >= next.length || to < 0 || to >= next.length) return next;
  const [roleId] = next.splice(index, 1);
  next.splice(to, 0, roleId);
  return next;
}

export function matchesRole(track, roleId) {
  if (roleId === "1" || roleId === "5") {
    return track.trackNum === Number(roleId) && track.part === "";
  }
  if (EXACT_ROLES.has(roleId)) return track.role === roleId;
  const trackNum = Number(roleId);
  if (!Number.isInteger(trackNum) || trackNum < 1) return false;
  return track.trackNum === trackNum && track.part !== "c";
}

export function tracksForRole(tracks, roleId) {
  return tracks.filter((track) => matchesRole(track, roleId));
}

export function coversRoles(tracks, roles) {
  const pool = tracks.slice();
  for (const roleId of roles) {
    const index = pool.findIndex((track) => matchesRole(track, roleId));
    if (index < 0) return false;
    pool.splice(index, 1);
  }
  return true;
}

export function roleIdFromSlot(slot) {
  const text = String(slot ?? "");
  const split = text.indexOf(":");
  if (split === -1) return null;
  return text.slice(split + 1);
}

function storageOf(storage) {
  return storage || globalThis.localStorage;
}

export function loadCustomFormat(storage) {
  const store = storageOf(storage);
  if (!store) return normalizeCustomFormat(DEFAULT_CUSTOM_FORMAT);
  try {
    const raw = store.getItem(CUSTOM_STORAGE_KEY);
    if (!raw) return normalizeCustomFormat(DEFAULT_CUSTOM_FORMAT);
    return normalizeCustomFormat(JSON.parse(raw));
  } catch {
    return normalizeCustomFormat(DEFAULT_CUSTOM_FORMAT);
  }
}

export function saveCustomFormat(format, storage) {
  const normalized = normalizeCustomFormat(format);
  storageOf(storage).setItem(CUSTOM_STORAGE_KEY, JSON.stringify(normalized));
  return normalized;
}
