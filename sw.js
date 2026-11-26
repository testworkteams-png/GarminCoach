const CACHE_NAME = "garmincoach-shell-v35";
const SHARE_CACHE_NAME = "garmincoach-share-temp-v1";
const SHARE_IMAGE_KEY = "./__shared-scale-image";
const SHELL_ASSETS = ["./", "./index.html", "./styles.css", "./theme-engine.js", "./ai-insights.js", "./body-scale.js", "./health-meds.js", "./lab-reports.js", "./app.js", "./manifest.json", "./icon.svg"];

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
      Promise.all(keys.filter((k) => k !== CACHE_NAME && k !== SHARE_CACHE_NAME).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (
    event.request.method === "POST" &&
    url.origin === self.location.origin &&
    url.pathname.endsWith("/share-scale")
  ) {
    event.respondWith(
      (async () => {
        try {
          const formData = await event.request.formData();
          const file = formData.get("scale_image");
          if (file && typeof file.arrayBuffer === "function") {
            const cache = await caches.open(SHARE_CACHE_NAME);
            await cache.put(
              SHARE_IMAGE_KEY,
              new Response(file, {
                headers: { "Content-Type": file.type || "image/jpeg" },
              })
            );
          }
        } catch (_) {}
        return Response.redirect("./index.html?shared_scale=1", 303);
      })()
    );
    return;
  }

  if (event.request.method !== "GET") return;
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
