/* Secundus service worker.
   Two jobs: satisfy PWA install criteria, and make sure a deploy actually
   reaches the device. GitHub Pages serves index.html with max-age=600, so an
   installed app can keep running a ten-minute-old build and look broken after a
   fix has already shipped. Navigations and the app's own stylesheets and
   scripts therefore go to the network with the HTTP cache bypassed (a CSS-only
   deploy behind a cached index.html looked stale for ten minutes, 2026-09-13);
   everything else is plain passthrough. Nothing is stored, so repo data is
   never served stale. */
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  const ownAsset = url.origin === self.location.origin && /\.(css|js)$/.test(url.pathname);
  if (e.request.mode !== "navigate" && !ownAsset) return;  // passthrough
  e.respondWith(fetch(e.request, { cache: "reload" }).catch(() => fetch(e.request)));
});
