"use strict";

const CACHE = "winapp-v5";
const SHELL = ["index.html", "style.css", "app.js", "manifest.json", "icon-192.png", "icon-512.png", "fonts/DSEG7Classic-Bold.woff2"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (url.origin !== location.origin) return;

  // audio: let the browser handle it natively (range requests / streaming)
  if (url.pathname.includes("/music/")) return;

  // playlist: network first, cache fallback
  if (url.pathname.endsWith("playlist.json")) {
    e.respondWith(
      fetch(e.request)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(e.request, copy));
          return res;
        })
        .catch(() => caches.match(e.request))
    );
    return;
  }

  // app shell: cache first
  e.respondWith(caches.match(e.request).then((hit) => hit || fetch(e.request)));
});
