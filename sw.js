// FlatSwipe service worker.
// Shell and data caching only; Worker API auth and data calls are never cached.
const CACHE = "flatswipe-v22";
const SHELL = [
  "./",
  "index.html",
  "styles.css",
  "app.js",
  "config.js",
  "listings-data.js",
  "manifest.webmanifest",
  "icon-192.png",
  "icon-512.png",
  "icon-maskable-512.png",
  "icon-180.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  // Cross-origin (Worker API, fonts, CDNs): fonts cache-first, everything else network only.
  if (url.origin !== self.location.origin) {
    if (url.hostname === "fonts.gstatic.com" || url.hostname === "fonts.googleapis.com") {
      event.respondWith(
        caches.match(req).then((hit) => hit || fetch(req).then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((cache) => cache.put(req, copy));
          return res;
        }))
      );
    }
    return;
  }

  // Navigations: network first, fall back to the cached shell offline.
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req).then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((cache) => cache.put("index.html", copy));
        return res;
      }).catch(() => caches.match("index.html"))
    );
    return;
  }

  // Core files (page, code, listings data): network first, so a deploy never
  // mixes a new page with stale cached code or data. Cache is offline fallback.
  const CORE = ["index.html", "styles.css", "app.js", "config.js", "listings-data.js", "manifest.webmanifest"];
  if (CORE.some((n) => url.pathname.endsWith(n))) {
    event.respondWith(
      fetch(req).then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((cache) => cache.put(req, copy));
        return res;
      }).catch(() => caches.match(req))
    );
    return;
  }

  // Other same-origin assets (photos, icons): stale-while-revalidate.
  event.respondWith(
    caches.match(req).then((hit) => {
      const network = fetch(req).then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((cache) => cache.put(req, copy));
        return res;
      }).catch(() => hit);
      return hit || network;
    })
  );
});
