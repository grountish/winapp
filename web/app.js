"use strict";

const audio = document.getElementById("audio");
const $ = (id) => document.getElementById(id);
const marquee = $("marquee");
const timeNow = $("time-now");
const seek = $("seek");
const playlistEl = $("playlist");
const statusEl = $("status");
const stateLed = $("state-led");
const viz = $("viz");

let tracks = [];        // full playlist from manifest
let base = "";          // absolute prefix when audio lives on another origin
let order = [];         // play order (indices into tracks), shuffled or not
let pos = -1;           // position within order
let shuffle = false;
let repeat = false;
let seeking = false;
let durations = {};     // path -> seconds, learned as tracks load

// ---------- playlist ----------

async function loadPlaylist() {
  statusEl.textContent = "loading...";
  try {
    const res = await fetch("playlist.json", { cache: "no-cache" });
    if (!res.ok) throw new Error(res.status);
    const data = await res.json();
    tracks = Array.isArray(data) ? data : data.tracks || [];
    base = Array.isArray(data) ? "" : data.base || "";
    if (base && !base.endsWith("/")) base += "/";
    try { durations = JSON.parse(localStorage.getItem("durations")) || {}; } catch (_) { durations = {}; }
    rebuildOrder();
    render();
    statusEl.textContent = tracks.length + " tracks";
    restoreLast();
  } catch (err) {
    statusEl.textContent = "load failed";
    playlistEl.innerHTML =
      '<div class="empty">no playlist.json found<br><br>' +
      "run scripts/playlist-from-bucket.sh<br>then commit + push</div>";
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

function label(t) {
  return (t.artist ? t.artist + " - " : "") + t.title;
}

function render() {
  const q = $("filter").value.trim().toLowerCase();
  playlistEl.innerHTML = "";
  const frag = document.createDocumentFragment();
  tracks.forEach((t, i) => {
    if (q && !(label(t) + " " + (t.album || "")).toLowerCase().includes(q)) return;
    const row = document.createElement("div");
    row.className = "row" + (i === currentIndex() ? " current" : "");
    row.dataset.index = i;
    row.innerHTML = '<span class="name"></span><span class="dur"></span>';
    row.querySelector(".name").textContent = (i + 1) + ". " + label(t);
    row.querySelector(".dur").textContent = durations[t.path] ? fmt(durations[t.path]) : "";
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

function loadTrack(t) {
  audio.src = trackURL(t);
  marquee.textContent = label(t) + (t.album ? "  [" + t.album + "]  " : "  ");
  marqueeCheck();
  $("fmt-kbps").textContent = (t.path.split(".").pop() || "---").toUpperCase().slice(0, 4);
  $("fmt-khz").textContent = "44";
  seek.disabled = false;
  updateMediaSession(t);
  markCurrent();
}

function playAt(orderPos) {
  if (orderPos >= order.length && repeat && order.length) orderPos = 0;
  if (orderPos < 0 || orderPos >= order.length) return stop();
  pos = orderPos;
  loadTrack(tracks[order[pos]]);
  audio.play().catch(() => {});
  saveLast();
}

function playTrack(index) {
  const p = order.indexOf(index);
  if (p !== -1) playAt(p);
}

function play() {
  if (!audio.src) {
    if (order.length) playAt(0);
    return;
  }
  audio.play().catch(() => {});
}

function pause() { audio.pause(); }

function stop() {
  audio.pause();
  audio.removeAttribute("src");
  audio.load();
  pos = -1;
  marquee.textContent = "*** winapp — drop the needle ***";
  marqueeCheck();
  timeNow.textContent = " 0:00";
  seek.value = 0;
  seek.disabled = true;
  markCurrent();
  setChannels(false);
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

// ---------- persistence ----------

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
    pos = order.indexOf(i);
    loadTrack(tracks[i]);
    audio.currentTime = last.t || 0;
  } catch (_) {}
}

// ---------- lcd time + duration learning ----------

function fmt(s) {
  if (!isFinite(s) || s < 0) return "0:00";
  s = Math.round(s);
  return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0");
}

function lcdTime(s) {
  const str = fmt(s);
  return str.length < 5 ? " " + str : str;
}

audio.addEventListener("loadedmetadata", () => {
  const i = currentIndex();
  if (i < 0 || !isFinite(audio.duration)) return;
  const path = tracks[i].path;
  if (!durations[path]) {
    durations[path] = audio.duration;
    try { localStorage.setItem("durations", JSON.stringify(durations)); } catch (_) {}
    const row = playlistEl.querySelector('.row[data-index="' + i + '"] .dur');
    if (row) row.textContent = fmt(audio.duration);
  }
});

audio.addEventListener("timeupdate", () => {
  timeNow.textContent = lcdTime(audio.currentTime);
  if (!seeking && audio.duration) seek.value = (audio.currentTime / audio.duration) * 1000;
  if ((audio.currentTime | 0) % 5 === 0) saveLast();
});

audio.addEventListener("play", () => {
  stateLed.className = "state-led play";
  setChannels(true);
  setPlaybackState("playing");
  vizRun();
});
audio.addEventListener("pause", () => {
  stateLed.className = "state-led pause";
  setChannels(false);
  setPlaybackState("paused");
});
audio.addEventListener("ended", next);
audio.addEventListener("error", () => {
  if (pos !== -1) { statusEl.textContent = "unplayable, skipping"; next(); }
});

function setChannels(on) {
  $("chan-stereo").classList.toggle("lit", on);
  $("chan-mono").classList.remove("lit");
}

// ---------- marquee ----------

function marqueeCheck() {
  marquee.classList.remove("scroll");
  const box = marquee.parentElement;
  if (marquee.scrollWidth > box.clientWidth) {
    marquee.textContent = marquee.textContent + "   *** " + marquee.textContent + "   *** ";
    marquee.classList.add("scroll");
  }
}

// ---------- visualizer (decorative — no Web Audio, keeps background playback safe) ----------

const vctx = viz.getContext("2d");
const BARS = 19;
const levels = new Array(BARS).fill(0);
const peaks = new Array(BARS).fill(0);
let vizOn = false;

function vizRun() {
  if (vizOn) return;
  vizOn = true;
  requestAnimationFrame(vizFrame);
}

function vizFrame() {
  if (audio.paused || document.hidden) {
    vizOn = false;
    vctx.clearRect(0, 0, viz.width, viz.height);
    return;
  }
  const W = viz.width, H = viz.height, bw = W / BARS;
  vctx.clearRect(0, 0, W, H);
  for (let i = 0; i < BARS; i++) {
    const target = Math.random() * (1 - i / (BARS * 1.6));
    levels[i] += (target - levels[i]) * 0.3;
    const h = Math.max(1, levels[i] * H);
    if (h > peaks[i]) peaks[i] = h; else peaks[i] = Math.max(0, peaks[i] - 0.35);
    const grad = vctx.createLinearGradient(0, H, 0, 0);
    grad.addColorStop(0, "#00e800");
    grad.addColorStop(0.6, "#e8e800");
    grad.addColorStop(1, "#e80000");
    vctx.fillStyle = grad;
    vctx.fillRect(i * bw, H - h, bw - 1, h);
    vctx.fillStyle = "#9c9cb4";
    vctx.fillRect(i * bw, H - peaks[i] - 1, bw - 1, 1);
  }
  requestAnimationFrame(vizFrame);
}

document.addEventListener("visibilitychange", () => { if (!document.hidden) vizRun(); });

// ---------- ui wiring ----------

playlistEl.addEventListener("click", (e) => {
  const row = e.target.closest(".row");
  if (row) playTrack(Number(row.dataset.index));
});

$("btn-playb").addEventListener("click", play);
$("btn-pause").addEventListener("click", pause);
$("btn-stop").addEventListener("click", stop);
$("btn-next").addEventListener("click", next);
$("btn-prev").addEventListener("click", prev);
$("btn-eject").addEventListener("click", loadPlaylist);
$("filter").addEventListener("input", render);
$("vol").addEventListener("input", (e) => { audio.volume = e.target.value / 100; });

$("btn-pl").addEventListener("click", () => {
  const pl = $("pl-win");
  const on = pl.style.display !== "none";
  pl.style.display = on ? "none" : "";
  $("btn-pl").classList.toggle("on", !on);
});

$("btn-shuffle").addEventListener("click", () => {
  shuffle = !shuffle;
  $("btn-shuffle").classList.toggle("on", shuffle);
  const cur = currentIndex();
  rebuildOrder();
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

$("btn-rep").addEventListener("click", () => {
  repeat = !repeat;
  $("btn-rep").classList.toggle("on", repeat);
});

seek.addEventListener("input", () => { seeking = true; });
seek.addEventListener("change", () => {
  if (audio.duration) audio.currentTime = (seek.value / 1000) * audio.duration;
  seeking = false;
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
  ms.setActionHandler("play", play);
  ms.setActionHandler("pause", pause);
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
