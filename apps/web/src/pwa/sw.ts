/**
 * The service worker (spec: Mobile polish and installable PWA). Thin on
 * purpose: `routing.ts` decides what to do and this file does it. A new worker
 * never calls `skipWaiting` or `clients.claim`: it takes over on the next
 * launch, so an update cannot reload a game in progress.
 */

import { routeOf } from "./routing.ts";

/** Vite replaces this with the git SHA (`RELEASE`), the same release as the server's. */
declare const CLIENT_RELEASE: string;

/** One cache per release: a new deploy starts empty and `activate` drops the rest. */
const CACHE_PREFIX = "universum-";
const CACHE = `${CACHE_PREFIX}${CLIENT_RELEASE}`;
/** The last shell that loaded, the fallback when the network is gone. */
const SHELL = "/index.html";

const worker = self as unknown as ServiceWorkerGlobalScope;

worker.addEventListener("install", (event) => {
  // Nothing is precached: the shell arrives from the first successful
  // navigation and each hashed asset from its first use. Wait for the release's
  // cache to exist so `activate` has a stable name to keep.
  event.waitUntil(caches.open(CACHE).then(() => undefined));
});

worker.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names
          .filter((name) => name.startsWith(CACHE_PREFIX) && name !== CACHE)
          .map((name) => caches.delete(name)),
      );
    })(),
  );
});

worker.addEventListener("fetch", (event) => {
  const route = routeOf(
    { url: event.request.url, method: event.request.method, mode: event.request.mode },
    worker.location.origin,
  );
  if (route === "never") return;
  event.respondWith(route === "cache-first-hashed" ? cacheFirst(event) : networkFirst(event));
});

/** Immutable hashed assets: the cache answers, the network only fills it. */
async function cacheFirst(event: FetchEvent): Promise<Response> {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(event.request, { ignoreSearch: true });
  if (cached) return cached;
  const response = await fetch(event.request);
  if (response.ok) event.waitUntil(cache.put(event.request, response.clone()).catch(() => undefined));
  return response;
}

/** Navigations: the network answers, the last successful shell is the fallback. */
async function networkFirst(event: FetchEvent): Promise<Response> {
  try {
    const response = await fetch(event.request);
    if (response.ok) {
      const cache = await caches.open(CACHE);
      event.waitUntil(cache.put(SHELL, response.clone()).catch(() => undefined));
    }
    return response;
  } catch (error) {
    const cached = await (await caches.open(CACHE)).match(SHELL);
    if (cached) return cached;
    throw error;
  }
}
