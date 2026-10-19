// Nanosaur service worker: precaches the whole game so an installed copy always plays offline.
// The version string and precache list below are filled in at build time (tools/finalize-dist.py).

const VERSION = "__VERSION__";
const CACHE = `nanosaur-${VERSION}`;
const PRECACHE = __PRECACHE__;

self.addEventListener("install", (event) => {
	event.waitUntil((async () => {
		const cache = await caches.open(CACHE);
		// The page may already have stored the big downloads (wasm/data) in this cache.
		for (const url of PRECACHE) {
			if (await cache.match(url)) continue;
			const res = await fetch(new Request(url, { cache: "reload" }));
			if (!res.ok) throw new Error(`precache failed: ${url} (${res.status})`);
			await cache.put(url, res);
		}
		// First install: take control right away so this visit is already offline-capable.
		// Updates wait for the player to choose "Reload" so a level is never interrupted.
		if (!self.registration.active) self.skipWaiting();
	})());
});

self.addEventListener("activate", (event) => {
	event.waitUntil((async () => {
		const names = await caches.keys();
		await Promise.all(names.filter((n) => n.startsWith("nanosaur-") && n !== CACHE).map((n) => caches.delete(n)));
		await self.clients.claim();
		const clients = await self.clients.matchAll({ includeUncontrolled: true });
		for (const c of clients) c.postMessage({ type: "precached", version: VERSION });
	})());
});

self.addEventListener("message", (event) => {
	if (event.data && event.data.type === "skip-waiting") self.skipWaiting();
});

self.addEventListener("fetch", (event) => {
	const req = event.request;
	if (req.method !== "GET") return;
	const url = new URL(req.url);
	if (url.origin !== self.location.origin) return;

	event.respondWith((async () => {
		const cache = await caches.open(CACHE);
		let hit = await cache.match(req, { ignoreSearch: true });
		if (!hit && req.mode === "navigate") hit = await cache.match("index.html");
		if (hit) return hit;
		try {
			return await fetch(req);
		} catch (e) {
			if (req.mode === "navigate") {
				const shell = await cache.match("index.html");
				if (shell) return shell;
			}
			throw e;
		}
	})());
});
