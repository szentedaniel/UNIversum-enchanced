# Ticket #124 (Decision pick sync) — extension points and gotchas

Branch `agent/issue-124-decision-module-owns-the-board-s-pick-sync-marks-d`, from `main` after
#76 and #119.

## The module (`apps/web/src/decision/decision.ts`)

- `OpenDecision`'s waiting line is `{ owner: "other"; player: PlayerId; kind: "sale" | "pick" }`
  and every Decision of mine has `owner: "me"`. `owner` is the discrimination now (`PlayerId` is a
  string, so the payload-presence test of #76 is gone); `Game.tsx`'s waiting line is
  `decision?.owner === "other" ? decision.kind : null`.
- `pickSyncOf(decision, frame, serverNowMs: number | null, selection)` → `{ key, marks, wakeInMs }`:
  - `key` is my Sale's or pick's key, else `null` — the new-Decision marker. It ignores `busy`, so
    a send never resets the picks, and it is `null` through a Playback's gate (`openDecision`
    returns `null` there).
  - `marks` are `singleMarks`/`saleMarks`, with the selection filtered by the Decision's key: a
    pick made for an earlier Decision is ignored. A Sale without a `turnTimer` — or without the
    server clock (`serverNowMs` is `null`, no push yet; #162) — marks nothing (as #76's Board did).
  - `wakeInMs` is `msLeft - AUTO_SELL_WARNING_MS` when the Sale's countdown is still outside the
    warning window, else `null` (no Sale, the warning is due, no Turn timer, or no server clock).
- `PickSelection` is the two `uiStore` slices: `{ salePicks: SalePicks; singlePick: { key, field } }`.
  The Board passes `uiStore.getState()` whole; a fourth argument is the one deviation from the
  issue's sketch signature, because the picked marks need the client's selection.
- `mySaleOrPick` is now module-private; `decisionKey` and `waitingLine` are deleted.
  `AUTO_SELL_WARNING_MS`, `saleMarks`, `singleMarks` and `selectedPick` are read only here.

## Board (`apps/web/src/board/Board.tsx`)

- `syncPick` is now: clear its timer, read the frame and `serverNow(push.clockOffset)` — or `null`
  with no push, so the Sale marks nothing on an uncorrected clock (#162) — call
  `pickSyncOf(currentDecision(), frame, now, uiStore.getState())`,
  reset the pick UI when `key` changes, `renderer.setPick(sync.marks)`, and arm
  `setTimeout(syncPick, wakeInMs + WAKE_SLACK_MS)`.
- `WAKE_SLACK_MS = 50` replaces the old inline `+ 50`: the wake-up must not land before the
  warning's marks change.
- The subscriptions are unchanged: the push, `gateOpenOf`, `salePicks`, `singlePick`, selection,
  pick focus, inspect and follow.

## Sale picks move

- `salePicksFor` and `SalePicks` moved from `stores/ui-store.ts` to `pick/sale.ts`, so the Decision
  module filters picks without importing a store. `Game.tsx` imports `salePicksFor` from
  `#pick/sale.ts`; `uiStore.salePicks` is typed `SalePicks`.

## Tests

- `apps/web/test/decision.test.ts`'s `pickSyncOf` suite drives the marks, the stale selection, the
  warning window, the covered Sale, the busy case, a missing Turn timer, the non-mine Decisions and
  the ADR-0004 key reset with `playbackOfPush` frames and a plain server-clock reading.
- The Decision fence's suggestion string and `CODING_STANDARDS.md`'s Decision bullet both name
  `openDecision`, `bottomSlot`, `fieldTap` and `pickSyncOf`.

## Gotchas

- The e2e `pick()` hook sees exactly `pickSyncOf`'s `marks` through `setPick`; `sale-tray.spec.ts`'s
  ring assertions depend on `wakeInMs` arming and on `saleMarks`' covered/uncovered rule.
- A covered Sale still gets a `wakeInMs` (the timer fires once, then the marks stay unringed), as
  before #124.

Read for: any Decision/Board pick mark, Auto-sell warning or `uiStore` pick change.
