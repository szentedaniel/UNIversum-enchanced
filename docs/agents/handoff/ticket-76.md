# Ticket #76 (Decision review fixes): extension points and gotchas

Branch `ticket/76-decision-review-fixes`, spec #72, its last ticket. The
spec-wide review's facts, now read one way and pinned by a test. Nothing
visible changed.

## The module (`apps/web/src/decision/decision.ts`)

- **`mySaleOrPick(decision)`** → `MySaleOrPick | null`: this client's Sale or
  pick with the readings the slot, a tap and the pick UI share — `kind`
  (`"sale" | "pick"`), the `sale`/`pick` value, `key`, `pickable` and `busy`.
  `null` for every other Decision, a waiting line included. It is now the one
  place `"sale" in` / `"pick" in` narrows: `owner` cannot ("`PlayerId` is a
  string", `ticket-74.md`).
- **`waitingLine(decision)`** → `"sale" | "pick" | null`: another Player's
  Sale or pick for the Turn card's waiting line. Keyed on the payload's
  absence, so my Sale or pick (which carries it) reads `null`, and so does
  another Player's Roll, Offer or Quarantine choice.
- **The `podium` slot carries its phase**: `{ kind: "podium"; phase:
  PhaseOf<"gameOver"> }`. `Game.tsx` renders `<Podium view={view}
  phase={slot.phase} />` from the slot alone (the `gameOver` local is gone).
- `bottomSlot`, `fieldTap` and `decisionKey` all read `mySaleOrPick`; the
  shared inspect→Field-card branch and `busy` live there once. `fieldTap`'s
  `ignore` while busy and `decisionKey` ignoring `busy` are unchanged.
- No `"sale" in` / `"pick" in` / `owner === "me"` / `owner !== "me"` exists
  outside `decision.ts` (grep the tree): a new read goes through the helpers,
  not the union. Tests may use the helpers too.

## Board and Game

- `Board.tsx`'s `currentDecision()` reads `roomStore.getState()` once and
  passes that state to `inFlightOf`. `syncPick`'s marks read
  `mySaleOrPick(decision)` (`kind: "sale"` / `"pick"`); a waiting line draws
  no marks, as before.
- `Game.tsx` has one `waiting = waitingLine(decision)` for both waiting lines
  (`sale-waiting`, `pick-waiting`).

## Tests

- `apps/web/test/decision.test.ts` adds `describe("mySaleOrPick")` and
  `describe("waitingLine")`; the Sale/pick tests narrow through
  `mySaleOrPick`. `sellingRoll()` returns the Roll's `Applied`, and the
  ADR-0004 key test builds its push with those events through
  `playbackOfPush`: `decisionKey` is `null` at `receivedAt` and at
  `opensAt - 1`, and the Sale's key at `opensAt`.
- Repeat run for this ticket (ports `3176`/`5276`, `--repeat-each 6
  --retries 0`): `sale-tray` 72 passed; `pick-tray`, `podium`, `chance-card`
  and `two-guests` 66 passed. Full suite: 67 passed, 1 skipped.
