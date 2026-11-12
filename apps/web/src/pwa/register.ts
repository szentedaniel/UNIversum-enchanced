/**
 * The service worker's registration (spec: Mobile polish and installable PWA).
 *
 * Production builds only: a dev server's worker would hide every change behind
 * its cache. Registration waits for `load`, so it never competes with the first
 * render, and it checks the secure context a worker needs — `localhost` counts
 * as one, but a plain `http:` origin does not (the deployment terminates TLS in
 * front of Caddy). There is no `skipWaiting` and no reload: a new worker takes
 * over on the next launch, never in the middle of a game.
 */

/** Registers `/sw.js` at the root; never throws. */
export function registerServiceWorker(): void {
  if (!import.meta.env.PROD) return;
  if (!("serviceWorker" in navigator)) return;
  if (!window.isSecureContext) return;
  window.addEventListener(
    "load",
    () => {
      void navigator.serviceWorker.register("/sw.js", { scope: "/", type: "module" }).catch(() => {
        // Installability is optional: the game runs without the worker.
      });
    },
    { once: true },
  );
}
