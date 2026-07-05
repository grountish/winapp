"use strict";

const deckA = document.getElementById("audio");
const deckB = deckA.cloneNode();      // second deck so automix can overlap tracks
deckB.removeAttribute("id");          // clone must not duplicate #audio
document.body.appendChild(deckB);
let audio = deckA;                    // active deck
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
let userVol = 1;        // slider volume; deck volumes are scaled by fades
let mix = localStorage.getItem("mix") === "1";
let fading = null;      // {id, from} while a crossfade is running
const MIX_SECS = 6;
let collapsed = new Set();   // album names folded shut in the playlist tree
try { collapsed = new Set(JSON.parse(localStorage.getItem("collapsed")) || []); } catch (_) {}
// iOS ignores programmatic volume changes — without WebAudio it falls back to a hard cut
const canFade = (() => { const a = document.createElement("audio"); a.volume = 0.5; return a.volume === 0.5; })();

// ---------- WebAudio fades (mobile) ----------
// Element volume is read-only on iOS, so crossfades run through gain nodes when
// possible. createMediaElementSource taints cross-origin media unless the bucket
// serves CORS, so the graph is only enabled after probeCors() confirms it.

let webAudio = false;   // decided once per load, before any src is set
let audioCtx = null;
const gains = new Map();      // deck element -> GainNode
let blessed = false;          // idle deck has had a user-gesture play()

// ~50ms of silent wav — used to bless the idle deck inside a tap
const SILENCE = "data:audio/wav;base64,UklGRnQAAABXQVZFZm10IBAAAAABAAEAgD4AAAB9AAACABAAZGF0YVAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==";

async function probeCors() {
  if (!tracks.length) return false;
  try {
    const res = await fetch(trackURL(tracks[0]), { method: "HEAD", mode: "cors" });
    return res.ok;
  } catch (_) { return false; }
}

function ensureGraph() {
  if (!webAudio || audioCtx) return;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) { webAudio = false; return; }
  audioCtx = new AC();
  for (const el of [deckA, deckB]) {
    const src = audioCtx.createMediaElementSource(el);
    const g = audioCtx.createGain();
    src.connect(g).connect(audioCtx.destination);
    g.gain.value = userVol;
    el.volume = 1;            // gain owns loudness from here on
    gains.set(el, g);
  }
}

// one volume knob for both modes: gain node when the graph runs, element volume otherwise
function setVol(el, v) {
  const g = gains.get(el);
  if (g) g.gain.value = v; else el.volume = v;
}

// mobile browsers only allow play() on elements a user has touched, and
// AudioContext starts suspended — fix both inside the first real gesture
function unlockAudio() {
  ensureGraph();
  if (audioCtx && audioCtx.state === "suspended") audioCtx.resume().catch(() => {});
  if (blessed || fading) return;   // during a fade the idle deck is the outgoing one
  blessed = true;
  const idle = audio === deckA ? deckB : deckA;
  idle.muted = true;
  idle.src = SILENCE;
  idle.play().then(() => {
    idle.pause(); idle.removeAttribute("src"); idle.load(); idle.muted = false;
  }).catch(() => {
    blessed = false;          // gesture didn't count (e.g. synthetic) — retry on next tap
    idle.removeAttribute("src"); idle.load(); idle.muted = false;
  });
}
document.addEventListener("pointerdown", unlockAudio, { capture: true });
document.addEventListener("keydown", unlockAudio, { capture: true });

// ---------- playlist ----------

const QUOTA_BYTES = 10 * 1024 ** 3;   // R2 free tier: 10 GB storage

// bucket usage meter in the playlist footer; hidden when the worker
// doesn't report usedBytes (old worker or committed playlist fallback)
function setStorageUI(usedBytes) {
  const el = $("storage");
  if (typeof usedBytes !== "number") { el.hidden = true; return; }
  const pct = Math.min(100, (usedBytes / QUOTA_BYTES) * 100);
  const gb = usedBytes / 1024 ** 3;
  el.hidden = false;
  el.querySelector(".used").textContent =
    (gb >= 1 ? gb.toFixed(1) : (usedBytes / 1024 ** 2).toFixed(0) + "M") + "/10G";
  el.querySelector(".fill").style.width = pct.toFixed(1) + "%";
  el.classList.toggle("warn", pct >= 90);
  el.title = "bucket storage: " + gb.toFixed(2) + " GB of 10 GB (" + pct.toFixed(1) + "%)";
}

async function loadPlaylist() {
  statusEl.textContent = "loading...";
  try {
    // dynamic endpoint first (lists the bucket live), committed manifest as fallback
    const sources = [window.PLAYLIST_URL, "playlist.json"].filter(Boolean);
    let data = null;
    for (const url of sources) {
      try {
        const res = await fetch(url, { cache: "no-cache" });
        if (!res.ok) throw new Error(res.status);
        data = await res.json();
        break;
      } catch (_) {}
    }
    if (!data) throw new Error("no playlist source reachable");
    tracks = Array.isArray(data) ? data : data.tracks || [];
    base = Array.isArray(data) ? "" : data.base || "";
    if (base && !base.endsWith("/")) base += "/";
    setStorageUI(Array.isArray(data) ? null : data.usedBytes);
    // decide fade mode before any src is set: crossorigin must be in place first
    webAudio = await probeCors();
    if (webAudio) { deckA.crossOrigin = "anonymous"; deckB.crossOrigin = "anonymous"; }
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
  let group = null;      // container for the current album run
  let groupKey = null;   // album of that run ("" = loose tracks)

  tracks.forEach((t, i) => {
    if (q && !(label(t) + " " + (t.album || "")).toLowerCase().includes(q)) return;

    const alb = t.album || "";
    if (alb !== groupKey || (!alb && group)) {
      groupKey = alb;
      group = null;
      if (alb) {
        group = document.createElement("div");
        // a filter search always shows its matches expanded
        group.className = "group" + (!q && collapsed.has(alb) ? " closed" : "");
        const hdr = document.createElement("div");
        hdr.className = "row hdr";
        hdr.dataset.album = alb;
        hdr.innerHTML = '<span class="twist"></span><span class="name"></span><span class="cnt"></span>';
        hdr.querySelector(".name").textContent = alb;
        group.appendChild(hdr);
        frag.appendChild(group);
      }
    }

    const row = document.createElement("div");
    row.className = "row" + (i === currentIndex() ? " current" : "");
    row.dataset.index = i;
    row.innerHTML = '<span class="name"></span><span class="dur"></span>';
    row.querySelector(".name").textContent = (i + 1) + ". " + label(t);
    row.querySelector(".dur").textContent = durations[t.path] ? fmt(durations[t.path]) : "";
    (group || frag).appendChild(row);
  });

  for (const g of frag.querySelectorAll(".group")) {
    g.querySelector(".cnt").textContent = g.querySelectorAll(".row:not(.hdr)").length + " trk";
  }
  playlistEl.appendChild(frag);
  markCurrent();
  if (!playlistEl.children.length && tracks.length) {
    playlistEl.innerHTML = '<div class="empty">no match</div>';
  }
}

function setCollapsed(alb, closed) {
  if (closed) collapsed.add(alb); else collapsed.delete(alb);
  try { localStorage.setItem("collapsed", JSON.stringify([...collapsed])); } catch (_) {}
  // same album can appear as several runs — fold every one of them
  for (const hdr of playlistEl.querySelectorAll(".row.hdr")) {
    if (hdr.dataset.album === alb) hdr.parentElement.classList.toggle("closed", closed);
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
  setNowPlayingUI(t);
}

function setNowPlayingUI(t) {
  marquee.textContent = label(t) + (t.album ? "  [" + t.album + "]  " : "  ");
  marqueeCheck();
  $("fmt-kbps").textContent = (t.path.split(".").pop() || "---").toUpperCase().slice(0, 4);
  $("fmt-khz").textContent = "44";
  seek.disabled = false;
  updateMediaSession(t);
  markCurrent();
}

function playAt(orderPos) {
  endFade();
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

function pause() {
  endFade();
  audio.pause();
}

function stop() {
  endFade();
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

// ---------- automix ----------

function nextOrderPos() {
  const p = pos + 1;
  if (p < order.length) return p;
  return repeat && order.length ? 0 : -1;
}

function maybeMix() {
  if (!mix || (!canFade && !gains.size) || fading || seeking || audio.paused) return;
  const dur = audio.duration;
  if (!isFinite(dur) || !dur) return;
  const fade = Math.min(MIX_SECS, dur / 3);
  const left = dur - audio.currentTime;
  if (left > fade || left <= 0) return;
  const p = nextOrderPos();
  if (p !== -1) beginFade(p, left);
}

function beginFade(orderPos, secs) {
  const from = audio;
  const to = from === deckA ? deckB : deckA;
  pos = orderPos;
  const t = tracks[order[pos]];
  to.src = trackURL(t);
  setVol(to, 0);
  audio = to;
  setNowPlayingUI(t);
  to.play().catch(() => {});
  if (gains.size && audioCtx) {
    // ramps on the audio clock survive background timer throttling on mobile
    const n = 32;
    const down = new Float32Array(n), up = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const x = i / (n - 1);
      down[i] = Math.cos((x * Math.PI) / 2) * userVol;          // equal-power
      up[i] = Math.cos(((1 - x) * Math.PI) / 2) * userVol;
    }
    const t0 = audioCtx.currentTime;
    for (const g of gains.values()) g.gain.cancelScheduledValues(t0);
    gains.get(from).gain.setValueCurveAtTime(down, t0, secs);
    gains.get(to).gain.setValueCurveAtTime(up, t0, secs);
    fading = { id: setTimeout(endFade, secs * 1000 + 250), from, timer: "timeout" };
  } else {
    const t0 = performance.now();
    const id = setInterval(() => {
      const x = Math.min(1, (performance.now() - t0) / (secs * 1000));
      from.volume = Math.cos((x * Math.PI) / 2) * userVol;      // equal-power
      to.volume = Math.cos(((1 - x) * Math.PI) / 2) * userVol;
      if (x === 1) endFade();
    }, 50);
    fading = { id, from, timer: "interval" };
  }
  saveLast();
}

// finishes or cancels a crossfade: outgoing deck is silenced and unloaded
function endFade() {
  if (!fading) return;
  (fading.timer === "timeout" ? clearTimeout : clearInterval)(fading.id);
  const from = fading.from;
  fading = null;
  from.pause();
  from.removeAttribute("src");
  from.load();
  if (audioCtx) {
    const t = audioCtx.currentTime;
    for (const g of gains.values()) g.gain.cancelScheduledValues(t);
    setVol(from, userVol);    // silent while unloaded; primed for its next turn
  }
  setVol(audio, userVol);
}

function markCurrent() {
  const cur = currentIndex();
  for (const row of playlistEl.querySelectorAll(".row:not(.hdr)")) {
    row.classList.toggle("current", Number(row.dataset.index) === cur);
  }
  // a folded album still signals that the current track lives inside it
  for (const hdr of playlistEl.querySelectorAll(".row.hdr")) {
    hdr.classList.toggle("current-in", !!hdr.parentElement.querySelector(".row.current"));
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

function wireDeck(el) {
  el.addEventListener("loadedmetadata", () => {
    if (el !== audio) return;
    const i = currentIndex();
    if (i < 0 || !isFinite(el.duration)) return;
    const path = tracks[i].path;
    if (!durations[path]) {
      durations[path] = el.duration;
      try { localStorage.setItem("durations", JSON.stringify(durations)); } catch (_) {}
      const row = playlistEl.querySelector('.row[data-index="' + i + '"] .dur');
      if (row) row.textContent = fmt(el.duration);
    }
  });

  el.addEventListener("timeupdate", () => {
    if (el !== audio) return;
    timeNow.textContent = lcdTime(el.currentTime);
    if (!seeking && el.duration) seek.value = (el.currentTime / el.duration) * 1000;
    if ((el.currentTime | 0) % 5 === 0) saveLast();
    maybeMix();
  });

  el.addEventListener("play", () => {
    if (el !== audio) return;
    stateLed.className = "state-led play";
    setChannels(true);
    setPlaybackState("playing");
    vizRun();
  });

  el.addEventListener("pause", () => {
    if (el !== audio) return;
    stateLed.className = "state-led pause";
    setChannels(false);
    setPlaybackState("paused");
  });

  el.addEventListener("ended", () => {
    if (fading && fading.from === el) return endFade();  // outgoing deck ran out
    if (el === audio) next();
  });

  el.addEventListener("error", () => {
    if (fading && fading.from === el) return endFade();
    if (el === audio && pos !== -1) { statusEl.textContent = "unplayable, skipping"; next(); }
  });
}

wireDeck(deckA);
wireDeck(deckB);

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
  const hdr = e.target.closest(".row.hdr");
  if (hdr) {
    setCollapsed(hdr.dataset.album, !hdr.parentElement.classList.contains("closed"));
    return;
  }
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
$("vol").addEventListener("input", (e) => {
  userVol = e.target.value / 100;
  if (!fading) setVol(audio, userVol);   // during a fade the ramp rescales both decks
});

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

$("btn-mix").addEventListener("click", () => {
  mix = !mix;
  $("btn-mix").classList.toggle("on", mix);
  try { localStorage.setItem("mix", mix ? "1" : "0"); } catch (_) {}
});
$("btn-mix").classList.toggle("on", mix);

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
