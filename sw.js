/* Secundus service worker — install-criteria only. Network passthrough,
   zero caching: a deploy is live on the next load, and repo data is never
   served stale from a cache. */
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));
self.addEventListener("fetch", (e) => { /* passthrough */ });
