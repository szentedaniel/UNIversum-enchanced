# Ticket #428 (review follow-ups for the `@colyseus/core` 0.18.29 bump) — verified wire shapes and dependency parents

Branch `agent/issue-428-factory-review-follow-ups-426`. Verifies what the #426 dependabot bump changed; no
production or lockfile edit.

## The matchmaking 400 for a malformed body

- Colyseus' own malformed-JSON 400 is now the better-call error body, observed against
  `@colyseus/core@0.18.29` + `@colyseus/better-call@1.3.4`:
  `{"message":"Invalid JSON in request body","code":"BAD_REQUEST"}`, status 400, `content-type:
  application/json`, Colyseus' CORS headers present. It comes from `getBody` in
  `@colyseus/better-call/dist/utils.mjs`, which turns the `SyntaxError` into
  `APIError(400, { message, code })`; the `{ error: e.message }` in core's
  `build/router/node.mjs` `readBody` is not the reply this gate produces: `gate()` has already read
  the stream, so better-call's node adapter (`adapters/node/request.mjs` `getRequest`) falls back to
  the `req.body` string the gate set and its JSON parse fails.
- Our own refusals are unchanged: `reply()` in `apps/server/src/abuse/gated-http.ts` still writes
  `{ code: status, error: refusalMessage(refusal) }`.
- No app code reads a raw matchmaking body. The browser and the loadtest go through
  `@colyseus/sdk`, whose `build/HTTP.mjs` reads `data.message ?? data.error ?? raw.statusText`
  and wraps it in `MatchMakeError`; `matchmakeRefusal` then maps our message. The only `.error`
  reader is `apps/server/test/helpers.ts` `matchmake`, which reads our gate's body, not Colyseus'.
  `apps/loadtest/src/prometheus.ts:25` is a Prometheus response and unrelated.
- `apps/server/test/abuse.test.ts` (`describe("malformed matchmaking JSON")`) pins the boundary:
  a non-JSON body gets 400, `content-type: application/json`, and a JSON object with a `code` and
  a string `message` or `error`. It asserts loosely on purpose: `@colyseus/sdk` accepts either
  key, and a future bump should keep passing while the reply stays JSON. The test fetches
  directly because `server.matchmake(..., { rawBody })` collapses the answer to a `Refusal` and
  drops the status, headers and body.

## Dependency parents (`pnpm why`)

- `@better-auth/utils@0.5.1` ← `@colyseus/better-call@1.3.4` ← `@colyseus/core@0.18.29` (the
  bump). `@better-auth/utils@0.3.1` also remains via `@colyseus/better-call@1.3.3` ← the SDK.
- `@noble/hashes@2.4.0` ← `@better-auth/utils@0.5.1` ← `@colyseus/better-call@1.3.4`.
- `magic-string` is not from the Colyseus bump: `0.30.21` ← `@inlang/paraglide-js`; `1.4.3` ←
  `@sentry/bundler-plugins@11.15.0` (the same #426 group's Sentry 11.12 → 11.15) and
  `@tailwindcss/node@4.3.5`; `1.4.5` ← `@vitest/mocker@5.1.1` ← `vitest@5.1.1` (the group's
  vitest 5.1.0 → 5.1.1).

Read for: any `/matchmake` error-body reader or assertion, a Colyseus matchmaker bump, or a
`pnpm why` check of the better-call and magic-string parents.
