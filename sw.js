/* Secundus service worker.
   Two jobs: satisfy PWA install criteria, and make sure a deploy actually
   reaches the device. GitHub Pages serves index.html with max-age=600, so an
   installed app can keep running a ten-minute-old build and look broken after a
   fix has already shipped. Navigations therefore go to the network with the HTTP
   cache bypassed; everything else is plain passthrough. Nothing is stored, so
   repo data is never served stale. */
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));
self.addEventListener("fetch", (e) => {
  if (e.request.mode !== "navigate") return;               // passthrough
  e.respondWith(fetch(e.request, { cache: "reload" }).catch(() => fetch(e.request)));
});
