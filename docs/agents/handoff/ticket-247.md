# Ticket #247 (protocol watch flag) — join options for spec #179

Branch `agent/issue-247-protocol-join-options-carry-a-watch-flag`. The flag is carried only; no Room or web code reads it yet (#248 onwards).

## Protocol (`packages/protocol/src`)

- `messages.ts` `JoinOptions` is now `{ code; password?; guestToken?; watch? }`. `watch` asks to enter as a spectator (spec #179): a client with no Seat, which takes no Seat and never gets a Guest token.
- `schemas.ts` `joinOptionsSchema` gained `watch: z.boolean().optional()`; `JoinOptionsMatch` is unchanged and still compiles (it checks that the schema's output extends `JoinOptions`, so a new optional type field passes once the schema knows it).
- **The join schema must stay a plain `z.object`.** `GameRoom.authorize` tells a create from a join by `joinOptionsSchema.safeParse(options).success` (`creates = !join.success` when `matchmakeMethod` returns `null`), and today unknown keys are stripped rather than refused. A strict schema would turn a join with an extra key into a create when the method is unknown (a Room made instead of `MALFORMED`); a loose one would let create options through as a join. `apps/server/test/lobby-list.test.ts` covers the create-options-to-`joinById` refusal (`MALFORMED`).
- Tests: `packages/protocol/test/schemas.test.ts`, "Room options" — accepts `watch` true/false/absent, refuses `"yes"`/`1`/`null`, and pins that an unknown key is dropped.

## Server and web

- Unchanged. `GameRoom.authorize`/`onJoin` parse the same fields as before, and `createOptionsSchema` (used by `onCreate`) strips `watch` from create options. #248 reads the flag from `authorize`/`onJoin`'s `join.data`; #251 adds it to the web `joinOptions` in `apps/web/src/connection.ts`.
