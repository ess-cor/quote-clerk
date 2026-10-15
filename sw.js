// sw.js: caches the app shell and the WebLLM library so the app opens with no signal.
// (Model weights are cached separately by WebLLM itself, in the browser's Cache Storage.)
const CACHE = "quote-clerk-v1";
const SHELL = [
  "./",
  "./index.html",
  "./style.css",
  "./app.js",
  "./quote.js",
  "./manifest.webmanifest",
  "./icon.svg",
  "https://cdn.jsdelivr.net/npm/@mlc-ai/web-llm@0.2.85/lib/index.js",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith("quote-clerk-") && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  const ours = url.origin === self.location.origin || url.href.startsWith("https://cdn.jsdelivr.net/npm/@mlc-ai/web-llm@");
  if (e.request.method !== "GET" || !ours) return; // leave model downloads to WebLLM
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(e.request, copy));
        }
        return res;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: true }).then((r) => r || caches.match("./index.html")))
  );
});
