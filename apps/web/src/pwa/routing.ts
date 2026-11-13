/**
 * The service worker's routing, kept pure so the worker shell stays thin
 * (spec: Mobile polish and installable PWA). The hashed `/assets/*` names are
 * immutable (`Caddyfile`), so those come from the cache first. A navigation is
 * the app shell: it goes to the network first, so a working network never
 * serves a stale `index.html`, and the last successful shell is the fallback.
 * Everything else — the Room server's socket and matchmaking paths, error
 * reporting, non-GET requests and other origins — is left to the browser.
 */

export type Route = "never" | "network-first" | "cache-first-hashed";

export type RoutableRequest = {
  readonly url: string;
  readonly method: string;
  readonly mode: string;
};

/** `/colyseus` (the WebSocket upgrade included), error reporting, exactly. */
const SERVER_PATHS = ["/colyseus", "/client-config", "/errors"] as const;

/** The Vite proxy and Caddy forward these to the Room server; the worker must not. */
function isServerPath(pathname: string): boolean {
  return SERVER_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`));
}

/** Which route the worker gives `request`: a cache, the network first, or nothing. */
export function routeOf(request: RoutableRequest, origin: string): Route {
  const url = new URL(request.url, origin);
  if (url.origin !== new URL(origin).origin) return "never";
  if (request.method !== "GET") return "never";
  if (isServerPath(url.pathname)) return "never";
  if (url.pathname.startsWith("/assets/")) return "cache-first-hashed";
  if (request.mode === "navigate") return "network-first";
  return "never";
}
