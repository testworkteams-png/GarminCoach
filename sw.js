const CACHE_NAME = "garmincoach-shell-v22";
const SHELL_ASSETS = ["./", "./index.html", "./styles.css", "./theme-engine.js", "./ai-insights.js", "./app.js", "./manifest.json", "./icon.svg"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      Promise.all(
        SHELL_ASSETS.map(async (asset) => {
          const res = await fetch(new Request(asset, { cache: "no-cache" }));
          if (res.ok) await cache.put(asset, res.clone());
        })
      )
    ).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  if (url.origin === self.location.origin) {
    event.respondWith(
      fetch(event.request, { cache: "no-cache" })
        .then((res) => {
          if (res && res.ok) {
            const copy = res.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy)).catch(() => {});
          }
          return res;
        })
        .catch(() =>
          caches.match(event.request).then((r) => r || (event.request.mode === "navigate" ? caches.match("./index.html") : undefined))
        )
    );
  }
});
