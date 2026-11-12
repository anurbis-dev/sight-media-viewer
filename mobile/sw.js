// Service worker of the Sight Review app (docs/PLAN-mobile.md stage 3). tools/build_pwa.py fills in
// the version and the file list. Every app file is cached on install, so the app starts and works
// without network. A new version installs in the background and waits; the page shows
// "New version — Reload" and sends {type: "skip"} when the user taps it (never mid-review on its own).
"use strict";
var VERSION = "%%VERSION%%";
var CACHE = "sight-review-" + VERSION;
var FILES = %%FILES%%;

self.addEventListener("install", function(e){
  e.waitUntil(caches.open(CACHE).then(function(c){ return c.addAll(FILES.map(function(f){ return new Request(f, { cache: "reload" }); })); }));
});
self.addEventListener("activate", function(e){
  e.waitUntil(caches.keys().then(function(keys){
    return Promise.all(keys.filter(function(k){ return k.indexOf("sight-review-") === 0 && k !== CACHE; }).map(function(k){ return caches.delete(k); }));
  }).then(function(){ return self.clients.claim(); }));
});
self.addEventListener("message", function(e){
  if (e.data && e.data.type === "skip") self.skipWaiting();
});
self.addEventListener("fetch", function(e){
  var req = e.request;
  if (req.method !== "GET") return;
  var url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  e.respondWith(caches.open(CACHE).then(function(c){
    // Pages (start URL, reloads) are the app shell whatever the query.
    var key = req.mode === "navigate" ? "./" : req;
    return c.match(key, { ignoreSearch: true }).then(function(hit){
      return hit || fetch(req);
    });
  }));
});
