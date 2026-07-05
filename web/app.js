"use strict";

const audio = document.getElementById("audio");
const $ = (id) => document.getElementById(id);
const lcdTitle = $("lcd-title");
const timeNow = $("time-now");
const timeTotal = $("time-total");
const seek = $("seek");
const playlistEl = $("playlist");
const statusEl = $("status");
const btnPlay = $("btn-play");
const btnShuffle = $("btn-shuffle");

let tracks = [];        // full playlist from manifest
let base = "";          // absolute prefix when audio lives on another origin
let order = [];         // play order (indices into tracks), shuffled or not
let pos = -1;           // position within order
let shuffle = false;
let seeking = false;

// ---------- playlist ----------

async function loadPlaylist() {
  statusEl.textContent = "loading playlist...";
  try {
    const res = await fetch("playlist.json", { cache: "no-cache" });
    if (!res.ok) throw new Error(res.status);
    const data = await res.json();
    tracks = Array.isArray(data) ? data : data.tracks || [];
    base = Array.isArray(data) ? "" : data.base || "";
    if (base && !base.endsWith("/")) base += "/";
    rebuildOrder();
    render();
    statusEl.textContent = tracks.length + " tracks";
    restoreLast();
  } catch (err) {
    statusEl.textContent = "playlist load failed";
    playlistEl.innerHTML =
      '<div class="empty">no playlist.json found<br><br>' +
      "run scripts/sync-music.sh to upload<br>music + playlist to the bucket</div>";
  }
}

function rebuildOrder() {
  order = tracks.map((_, i) => i);
  if (shuffle) {
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [order[i], order[j]] = [order[j], order[i]];
    }
  }
}

function render() {
  const q = $("filter").value.trim().toLowerCase();
  playlistEl.innerHTML = "";
  const frag = document.createDocumentFragment();
  tracks.forEach((t, i) => {
    if (q && !(t.title + " " + (t.album || "")).toLowerCase().includes(q)) return;
    const row = document.createElement("div");
    row.className = "row" + (i === currentIndex() ? " current" : "");
    row.dataset.index = i;
    row.innerHTML =
      '<span class="num">' + (i + 1) + ".</span>" +
      '<span class="name"></span>' +
      '<span class="album"></span>';
    row.querySelector(".name").textContent = t.title;
    row.querySelector(".album").textContent = t.album || "";
    frag.appendChild(row);
  });
  playlistEl.appendChild(frag);
  if (!playlistEl.children.length && tracks.length) {
    playlistEl.innerHTML = '<div class="empty">no match</div>';
  }
}

function currentIndex() {
  return pos >= 0 ? order[pos] : -1;
}

// ---------- playback ----------

function trackURL(t) {
  return base + t.path.split("/").map(encodeURIComponent).join("/");
}

function playAt(orderPos) {
  if (orderPos < 0 || orderPos >= order.length) return stop();
  pos = orderPos;
  const t = tracks[order[pos]];
  audio.src = trackURL(t);
  audio.play().catch(() => {});
  lcdTitle.textContent = t.title + (t.album ? " [" + t.album + "]" : "");
  seek.disabled = false;
  updateMediaSession(t);
  markCurrent();
  saveLast();
}

function playTrack(index) {
  const p = order.indexOf(index);
  if (p !== -1) playAt(p);
}

function togglePlay() {
  if (!audio.src) {
    if (order.length) playAt(0);
    return;
  }
  if (audio.paused) audio.play().catch(() => {});
  else audio.pause();
}

function stop() {
  audio.pause();
  audio.removeAttribute("src");
  audio.load();
  pos = -1;
  lcdTitle.textContent = "*** no track loaded ***";
  timeNow.textContent = "0:00";
  timeTotal.textContent = "0:00";
  seek.value = 0;
  seek.disabled = true;
  markCurrent();
}

function next() { playAt(pos + 1); }

function prev() {
  if (audio.currentTime > 3 || pos <= 0) audio.currentTime = 0;
  else playAt(pos - 1);
}

function markCurrent() {
  const cur = currentIndex();
  for (const row of playlistEl.querySelectorAll(".row")) {
    row.classList.toggle("current", Number(row.dataset.index) === cur);
  }
}

// ---------- persistence (resume last track) ----------

function saveLast() {
  const i = currentIndex();
  if (i < 0) return;
  localStorage.setItem("last", JSON.stringify({ path: tracks[i].path, t: audio.currentTime | 0 }));
}

function restoreLast() {
  try {
    const last = JSON.parse(localStorage.getItem("last"));
    if (!last) return;
    const i = tracks.findIndex((t) => t.path === last.path);
    if (i === -1) return;
    const t = tracks[i];
    pos = order.indexOf(i);
    audio.src = trackURL(t);
    audio.currentTime = last.t || 0;
    lcdTitle.textContent = t.title + (t.album ? " [" + t.album + "]" : "");
    seek.disabled = false;
    updateMediaSession(t);
    markCurrent();
  } catch (_) {}
}

// ---------- ui wiring ----------

function fmt(s) {
  if (!isFinite(s) || s < 0) return "0:00";
  s = Math.round(s);
  return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0");
}

playlistEl.addEventListener("click", (e) => {
  const row = e.target.closest(".row");
  if (row) playTrack(Number(row.dataset.index));
});

$("btn-play").addEventListener("click", togglePlay);
$("btn-stop").addEventListener("click", stop);
$("btn-next").addEventListener("click", next);
$("btn-prev").addEventListener("click", prev);
$("btn-reload").addEventListener("click", loadPlaylist);
$("filter").addEventListener("input", render);

btnShuffle.addEventListener("click", () => {
  shuffle = !shuffle;
  btnShuffle.classList.toggle("on", shuffle);
  const cur = currentIndex();
  rebuildOrder();
  // keep current track playing at its new position in the order
  if (cur !== -1) {
    if (shuffle) {
      const p = order.indexOf(cur);
      [order[0], order[p]] = [order[p], order[0]];
      pos = 0;
    } else {
      pos = order.indexOf(cur);
    }
  }
});

seek.addEventListener("input", () => { seeking = true; });
seek.addEventListener("change", () => {
  if (audio.duration) audio.currentTime = (seek.value / 1000) * audio.duration;
  seeking = false;
});

audio.addEventListener("timeupdate", () => {
  timeNow.textContent = fmt(audio.currentTime);
  timeTotal.textContent = fmt(audio.duration);
  if (!seeking && audio.duration) seek.value = (audio.currentTime / audio.duration) * 1000;
  if ((audio.currentTime | 0) % 5 === 0) saveLast();
});

audio.addEventListener("play", () => { btnPlay.innerHTML = "&#10074;&#10074;"; setPlaybackState("playing"); });
audio.addEventListener("pause", () => { btnPlay.innerHTML = "&#9654;"; setPlaybackState("paused"); });
audio.addEventListener("ended", next);
audio.addEventListener("error", () => {
  if (pos !== -1) { statusEl.textContent = "unplayable, skipping"; next(); }
});

// ---------- media session (lock screen) ----------

function updateMediaSession(t) {
  if (!("mediaSession" in navigator)) return;
  navigator.mediaSession.metadata = new MediaMetadata({
    title: t.title,
    artist: t.artist || "",
    album: t.album || "",
  });
}

function setPlaybackState(state) {
  if ("mediaSession" in navigator) navigator.mediaSession.playbackState = state;
}

if ("mediaSession" in navigator) {
  const ms = navigator.mediaSession;
  ms.setActionHandler("play", () => audio.play());
  ms.setActionHandler("pause", () => audio.pause());
  ms.setActionHandler("previoustrack", prev);
  ms.setActionHandler("nexttrack", next);
  try {
    ms.setActionHandler("seekto", (e) => { if (e.seekTime != null) audio.currentTime = e.seekTime; });
  } catch (_) {}
}

// ---------- service worker ----------

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("sw.js").catch(() => {});
}

loadPlaylist();
