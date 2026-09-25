import { tracks as catalogTracks } from "./catalog.js";
import { FORMATS, roleLabel } from "./roles.js";
import { applyMeta, loadMeta, saveMeta } from "./metaStore.js";
import {
  buildProgram,
  candidatesForSlot,
  formatDuration,
  listReleases,
  parseDuration,
  programToText,
  replaceSong,
} from "./buildProgram.js";

const state = {
  minutes: 45,
  seed: 1,
  minRating: 1,
  includeBonus: false,
  releaseMode: "mix",
  releaseId: "",
  releaseFrom: null,
  releaseTo: null,
  locks: {},
  meta: loadMeta(),
  catalogRelease: "",
  catalogRole: "",
  catalogQuery: "",
  program: null,
};

const releases = listReleases(catalogTracks);

function tracksNow() {
  return applyMeta(catalogTracks, state.meta);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function buildOptions() {
  const sameRelease =
    state.releaseMode === "auto" ? "auto" : state.releaseMode === "one" ? state.releaseId : "mix";
  return {
    minutes: state.minutes,
    seed: state.seed,
    minRating: state.minRating,
    includeBonus: state.includeBonus,
    releaseFrom: state.releaseFrom,
    releaseTo: state.releaseTo,
    sameRelease,
    locks: state.locks,
  };
}

function rebuild() {
  state.program = buildProgram(tracksNow(), buildOptions());
  renderProgram();
}

function optionList(includeAll) {
  const rows = releases.map(
    (release) =>
      `<option value="${escapeHtml(release.release)}">${escapeHtml(release.label)}${
        release.period ? `（${escapeHtml(release.period)}）` : ""
      }</option>`
  );
  return `${includeAll ? '<option value="">すべて</option>' : ""}${rows.join("")}`;
}

function fillSelects() {
  document.querySelector("#release-pick").innerHTML = optionList(false);
  document.querySelector("#release-from").innerHTML = `<option value="">最初から</option>${optionList(false)}`;
  document.querySelector("#release-to").innerHTML = `<option value="">最後まで</option>${optionList(false)}`;
  document.querySelector("#catalog-release").innerHTML = optionList(true);
  const latest = releases[releases.length - 1];
  if (latest) {
    state.releaseId = latest.release;
    document.querySelector("#release-pick").value = latest.release;
  }
}

function starsHtml(id, rating, custom) {
  const buttons = [1, 2, 3, 4, 5]
    .map(
      (value) =>
        `<button type="button" class="star${value <= rating ? " is-on" : ""}" data-rate="${value}" data-id="${escapeHtml(
          id
        )}" aria-label="評価${value}">${value <= rating ? "★" : "☆"}</button>`
    )
    .join("");
  return `<div class="stars" role="group" aria-label="5段階評価">${buttons}${
    custom ? "" : '<span class="badge">仮</span>'
  }</div>`;
}

function renderFormat() {
  document.querySelectorAll(".time-btn").forEach((button) => {
    button.classList.toggle("is-active", Number(button.dataset.minutes) === state.minutes);
  });
  document.querySelector("#format-detail").textContent = FORMATS[state.minutes].detail;
  document.querySelector("#release-pick-label").hidden = state.releaseMode !== "one";
}

function renderProgram() {
  const program = state.program;
  const title = document.querySelector("#program-title");
  const total = document.querySelector("#program-total");
  const note = document.querySelector("#program-note");
  const list = document.querySelector("#program-list");
  const bar = document.querySelector("#meter-bar");
  title.textContent = program.format.title;
  const over = program.durationSec > program.targetSec;
  total.className = `total ${program.fits ? "is-ok" : over ? "is-over" : ""}`;
  total.textContent = `合計 ${formatDuration(program.durationSec)} / ${program.minutes}:00${
    program.fits ? "" : "（時間内に収まりきっていません）"
  }`;
  const ratio = program.targetSec ? Math.min(100, (program.durationSec / program.targetSec) * 100) : 0;
  bar.style.width = `${ratio}%`;
  bar.classList.toggle("is-over", over || !program.fits);
  const blocks = new Set(program.songs.map((song) => song.trackNum)).size;
  const releaseNote = program.release ? ` ${program.songs[0]?.releaseLabel || ""} だけで構成。` : "";
  const missing = program.missingSlots.length
    ? ` 入れられなかった枠: ${program.missingSlots.join("、")}。`
    : "";
  note.textContent = `音源 ${program.songs.length}曲 / トラック ${blocks}。${releaseNote}${missing} 星と長さを変えても、この並びは「別の組み合わせを作る」まで維持します。`;

  const pool = tracksNow();
  const options = buildOptions();
  list.innerHTML = program.songs
    .map((song) => {
      const choices = candidatesForSlot(pool, song.slot, {
        includeBonus: state.includeBonus,
        releaseFrom: state.releaseFrom,
        releaseTo: state.releaseTo,
        release: options.sameRelease && options.sameRelease !== "auto" && options.sameRelease !== "mix"
          ? options.sameRelease
          : program.release,
      }).sort((a, b) => b.rating - a.rating || a.releaseLabel.localeCompare(b.releaseLabel) || a.title.localeCompare(b.title));
      const swap = [`<option value="${escapeHtml(song.id)}">${escapeHtml(song.releaseLabel)} ${escapeHtml(song.title)}</option>`]
        .concat(
          choices
            .filter((choice) => choice.id !== song.id)
            .slice(0, 80)
            .map(
              (choice) =>
                `<option value="${escapeHtml(choice.id)}">${escapeHtml(choice.releaseLabel)} ${escapeHtml(
                  choice.title
                )}（★${choice.rating} / ${formatDuration(choice.durationSec)}）</option>`
            )
        )
        .join("");
      return `<li class="song">
        <div class="song-head">
          <span class="role">${escapeHtml(roleLabel(song.role))}</span>
          <span class="meta">${escapeHtml(song.releaseLabel)}${song.period ? ` ・ ${escapeHtml(song.period)}` : ""}</span>
        </div>
        <p class="title">${escapeHtml(song.title)}</p>
        <p class="artist">${song.artist ? escapeHtml(song.artist) : "アーティスト名は掲載なし"}</p>
        <div class="song-tools">
          ${starsHtml(song.id, song.rating, song.ratingCustom)}
          <label>長さ
            <input class="duration" data-duration="${escapeHtml(song.id)}" type="text" inputmode="numeric" value="${formatDuration(
              song.durationSec
            )}" aria-label="${escapeHtml(song.title)}の長さ" />
          </label>
          <label class="check"><input type="checkbox" data-lock="${escapeHtml(song.slot)}" ${
            state.locks[song.slot] === song.id ? "checked" : ""
          } /> 固定</label>
          <label class="swap">別の曲
            <select data-swap="${escapeHtml(song.slot)}">${swap}</select>
          </label>
          <a href="${escapeHtml(song.sourceUrl)}" rel="noreferrer">掲載ページ</a>
        </div>
      </li>`;
    })
    .join("");
  if (!program.songs.length) {
    list.innerHTML = `<li class="song"><p class="title">この条件では時間内のプログラムを作れません。</p><p class="artist">評価の下限を下げるか、リリースの範囲を広げてください。</p></li>`;
  }
}

function catalogTracksFiltered() {
  const q = state.catalogQuery.trim().toLowerCase();
  return tracksNow().filter((track) => {
    if (state.catalogRelease && track.release !== state.catalogRelease) return false;
    if (state.catalogRole === "1" && track.role !== "1") return false;
    if (state.catalogRole === "4" && track.trackNum !== 4) return false;
    if (state.catalogRole === "5" && track.trackNum !== 5) return false;
    if (
      state.catalogRole &&
      !["1", "4", "5"].includes(state.catalogRole) &&
      track.role !== state.catalogRole
    ) {
      return false;
    }
    if (!q) return true;
    return `${track.releaseLabel} ${track.title} ${track.artist} ${track.id}`.toLowerCase().includes(q);
  });
}

function renderCatalog() {
  const matches = catalogTracksFiltered();
  const shown = matches.slice(0, 120);
  document.querySelector("#catalog-count").textContent = `${matches.length}曲のうち ${shown.length}曲を表示`;
  document.querySelector("#catalog-list").innerHTML = shown
    .map(
      (track) => `<article class="song">
        <div class="song-head">
          <span class="role">${escapeHtml(track.releaseLabel)} ・ ${escapeHtml(roleLabel(track.role))}</span>
          ${track.bonus ? '<span class="badge">ボーナス</span>' : ""}
        </div>
        <p class="title">${escapeHtml(track.title)}</p>
        <p class="artist">${track.artist ? escapeHtml(track.artist) : "アーティスト名は掲載なし"}</p>
        <div class="song-tools">
          ${starsHtml(track.id, track.rating, track.ratingCustom)}
          <label>長さ
            <input class="duration" data-duration="${escapeHtml(track.id)}" type="text" inputmode="numeric" value="${formatDuration(
              track.durationSec
            )}" />
          </label>
          <a href="${escapeHtml(track.sourceUrl)}" rel="noreferrer">掲載ページ</a>
        </div>
      </article>`
    )
    .join("");
}

function setRating(id, rating) {
  state.meta = { ...state.meta, [id]: { ...(state.meta[id] || {}), rating } };
  saveMeta(state.meta);
  syncCurrentSong(id);
}

function setDuration(id, text) {
  const seconds = parseDuration(text);
  if (seconds == null) {
    renderProgram();
    renderCatalog();
    return;
  }
  const durationSec = Math.min(15 * 60, Math.max(30, seconds));
  state.meta = { ...state.meta, [id]: { ...(state.meta[id] || {}), durationSec } };
  saveMeta(state.meta);
  syncCurrentSong(id);
}

function syncCurrentSong(id) {
  const updated = tracksNow().find((track) => track.id === id);
  if (updated && state.program) {
    state.program = {
      ...state.program,
      songs: state.program.songs.map((song) =>
        song.id === id ? { ...updated, slot: song.slot } : song
      ),
    };
    state.program.durationSec = state.program.songs.reduce((sum, song) => sum + song.durationSec, 0);
    state.program.ratingSum = state.program.songs.reduce((sum, song) => sum + song.rating, 0);
    state.program.fits =
      state.program.durationSec <= state.program.targetSec &&
      state.program.missingSlots.length === 0 &&
      state.program.songs.length > 0;
  }
  renderProgram();
  renderCatalog();
}

function bind() {
  document.querySelector(".time-row").addEventListener("click", (event) => {
    const button = event.target.closest("[data-minutes]");
    if (!button) return;
    state.minutes = Number(button.dataset.minutes);
    state.locks = {};
    renderFormat();
    rebuild();
  });
  document.querySelector("#min-rating").addEventListener("change", (event) => {
    state.minRating = Number(event.target.value);
    rebuild();
  });
  document.querySelector("#release-mode").addEventListener("change", (event) => {
    state.releaseMode = event.target.value;
    renderFormat();
    rebuild();
  });
  document.querySelector("#release-pick").addEventListener("change", (event) => {
    state.releaseId = event.target.value;
    if (state.releaseMode === "one") rebuild();
  });
  document.querySelector("#release-from").addEventListener("change", (event) => {
    const release = releases.find((item) => item.release === event.target.value);
    state.releaseFrom = release ? release.sortOrder : null;
    rebuild();
  });
  document.querySelector("#release-to").addEventListener("change", (event) => {
    const release = releases.find((item) => item.release === event.target.value);
    state.releaseTo = release ? release.sortOrder : null;
    rebuild();
  });
  document.querySelector("#include-bonus").addEventListener("change", (event) => {
    state.includeBonus = event.target.checked;
    rebuild();
  });
  document.querySelector("#rebuild").addEventListener("click", () => {
    state.seed += 1;
    rebuild();
  });
  document.querySelector("#clear-locks").addEventListener("click", () => {
    state.locks = {};
    rebuild();
  });
  document.querySelector("#copy-program").addEventListener("click", async () => {
    const text = programToText(state.program);
    const status = document.querySelector("#copy-status");
    try {
      await navigator.clipboard.writeText(text);
      status.textContent = "コピーしました。";
    } catch {
      status.textContent = text;
    }
  });
  document.querySelector("#catalog-release").addEventListener("change", (event) => {
    state.catalogRelease = event.target.value;
    renderCatalog();
  });
  document.querySelector("#catalog-role").addEventListener("change", (event) => {
    state.catalogRole = event.target.value;
    renderCatalog();
  });
  document.querySelector("#catalog-query").addEventListener("input", (event) => {
    state.catalogQuery = event.target.value;
    renderCatalog();
  });

  document.body.addEventListener("click", (event) => {
    const star = event.target.closest("[data-rate]");
    if (!star) return;
    setRating(star.dataset.id, Number(star.dataset.rate));
  });
  document.body.addEventListener("change", (event) => {
    const duration = event.target.closest("[data-duration]");
    if (duration) {
      setDuration(duration.dataset.duration, duration.value);
      return;
    }
    const lock = event.target.closest("[data-lock]");
    if (lock) {
      const song = state.program.songs.find((item) => item.slot === lock.dataset.lock);
      if (lock.checked && song) state.locks[lock.dataset.lock] = song.id;
      else delete state.locks[lock.dataset.lock];
      return;
    }
    const swap = event.target.closest("[data-swap]");
    if (swap) {
      const song = tracksNow().find((item) => item.id === swap.value);
      if (!song) return;
      state.locks[swap.dataset.swap] = song.id;
      state.program = replaceSong(state.program, swap.dataset.swap, song);
      renderProgram();
    }
  });
}

fillSelects();
renderFormat();
bind();
rebuild();
renderCatalog();
