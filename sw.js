/* Sultan service worker: keeps the app shell, fonts and viewed photos available offline. */
const VERSION = "sultan-v2";
const SHELL = ["./", "./index.html", "./config.js", "./shim.js", "./vendor/supabase.js", "./manifest.webmanifest",
  "./icons/icon-192.png", "./icons/icon-512.png", "./icons/apple-touch-icon.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k.startsWith("sultan-") && k !== VERSION && k !== "sultan-photos" && k !== "sultan-fonts").map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  // App files: network first so updates arrive, cache as the offline fallback.
  if (url.origin === location.origin) {
    // bypass the browser's HTTP cache (GitHub Pages caches for 10 minutes) so new versions show up at once
    e.respondWith(fetch(req, { cache: "no-store" }).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(VERSION).then((c) => c.put(req, copy)); }
      return res;
    }).catch(() => caches.match(req, { ignoreSearch: true }).then((r) => r || caches.match("./index.html"))));
    return;
  }
  // Google Fonts: cache first.
  if (url.hostname === "fonts.googleapis.com" || url.hostname === "fonts.gstatic.com") {
    e.respondWith(caches.open("sultan-fonts").then((c) => c.match(req).then((hit) => hit || fetch(req).then((res) => { c.put(req, res.clone()); return res; }))));
    return;
  }
  // Signed photo links change their token; cache them by path so viewed photos work offline.
  if (url.pathname.includes("/storage/v1/object/sign/")) {
    const key = new Request(url.origin + url.pathname);
    e.respondWith(caches.open("sultan-photos").then((c) => fetch(req).then((res) => { if (res.ok) c.put(key, res.clone()); return res; })
      .catch(() => c.match(key).then((hit) => hit || Response.error()))));
  }
});
