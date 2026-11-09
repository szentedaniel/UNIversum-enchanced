# Ticket #120 (one request-reading module for matchmaking and browser routes) — extension points and gotchas

Branch `agent/issue-120-matchmaking-and-browser-http-routes-share-one-requ`. Builds on #37 (the
gate) and #44 (`/errors` tunnel).

## The shared reader (`apps/server/src/abuse/gated-http.ts`)

- `readRequest(req, { max, rate? })` is the one reader for a route's request. It resolves the
  client bucket (`ipBucket(clientIp(...))`), refuses a declared `content-length` over `max`,
  consults `rate(bucket)`, then reads the body under the same cap. It returns
  `{ bucket, body }` or `{ refusal, status }` (413 `MALFORMED` over the cap, 429 with the
  `rate` check's Refusal).
- The order is **declared cap → rate → body**. Matchmaking used to ask the limiter before the
  declared cap; `/errors` already had this order. A rate-limited IP that also declares an
  over-cap body now gets 413 and the request costs no rate point.
- `readBody` is private: a new route calls `readRequest`, never its own body read.
- `reply(response, status, refusal, request?)` is the one refusal writer: `retry-after` when the
  Refusal carries one; with `request` it adds Colyseus's CORS headers and its `{ code, error }`
  JSON (matchmaking), without it an empty body (`/errors`). The tunnel's old `retryAfter ?? 60`
  fallback is gone: `errorReportRefusal` always carries one today.
- `TOO_LARGE` is the single spelling of the 413 `MALFORMED` refusal.

## Call sites

- Matchmaking `gate()` (`gated-http.ts`) passes `max: guard.limits.matchmakeBodyBytes` (2 KB) and
  `rate: kind === null ? undefined : (bucket) => guard.admitRequest(kind, bucket)` — the Lobby
  list's own Room has no `kind` and is not counted. The request id and the
  `finish`-releases-the-Seat listener are still set before the reader.
- `apps/server/src/http/browser-routes.ts` `errorTunnel` passes
  `max: guard.limits.errorReportBytes` (200 KB) and `rate: (bucket) => guard.errorReportRefusal(bucket)`. The
  404-when-reporting-off and 405 checks stay in the route before the reader, so a huge body is
  not counted while reporting is off.
- Non-refusal browser answers (200/400/404/405/502) still use the route's local `empty()`; `reply`
  is for refusals (413/429, and the gate's 500).

## Tests

- `apps/server/test/abuse.test.ts` pins the matchmaking 413 wire shape (`{ code: 413, error:
  "MALFORMED" }`, `content-type: application/json`, no `retry-after`, the CORS header) and the
  chunked actual-cap path.
- `apps/server/test/error-tunnel.test.ts` pins the tunnel's empty 413 reply and its chunked
  actual-cap path; the 10/min test pins `retry-after` on the tunnel's 429.
