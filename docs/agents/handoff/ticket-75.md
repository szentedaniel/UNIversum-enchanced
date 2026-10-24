# Ticket #75 (the Board reads the Decision): extension points and gotchas

Branch `ticket/75-board-decision` (on `v2-modernization`), spec #72, its last
ticket. `Board.tsx` no longer derives the open Sale or pick; it asks
`decision/decision.ts`, like `Game.tsx`. The only visible change is story 2: a
tap on the Board while an intent is in flight no longer changes the picks.

## The Board (`apps/web/src/board/Board.tsx`)

- `openView`, `currentSale` and `currentPick` are gone. `currentDecision()` is
  the one read: `openDecision(playbackStore.getState().frame,
  roomStore.getState().me, inFlightOf(roomStore.getState()))` (#74's module,
  #73's lock). It is called at the moment of the tap and again in `syncPick`;
  there is no subscription for the lock, because `decisionKey` ignores `busy`
  and a tap reads `inFlightOf` itself.
- `onFieldTap` computes `fieldTap(currentDecision(), { inspect }, id)` and
  applies the result to `uiStore` (`selectField` / `toggleSalePick` /
  `choosePick`; `ignore` does nothing). Every new `FieldTap` kind needs a case
  there.
- `syncPick` keeps the reset (focus, inspect, open Field card) and the Sale's
  last-seconds warning timer; the key is `decisionKey(decision)`. `openDecision`
  is still the gate check: it returns `null` while the gate is shut, so the
  reset at a push (#70) fires at once, not when the gate opens. Marks come from
  `"sale" in decision` / `"pick" in decision` (a waiting line has neither);
  the Sale's marks still need `frame.view.turnTimer` and `push.clockOffset`.

## Fence (`apps/web/test/decision-fence.test.ts`)

- Reads `apps/web/src` (Paraglide excluded) for `saleFor` / `singlePickFor`.
  Only `decision/decision.ts` may name them; the two definitions in
  `pick/sale.ts` and `pick/pick.ts` are allowed by their `export function` line.
  A new caller belongs behind `openDecision`, not in the fence's allow-list.
- The scan (`withoutComments`, `sourceFiles`, the violation format) is shared
  with the server-clock fence in `apps/web/test/source-scan.ts`; change it there.
- The scan blanks comments, so a comment may mention the names.

## Test hook (`holdIntent`)

- `window.universumTest.holdIntent()` applies `inFlightPatch(state)` from
  `#stores/room-store.ts` — the same write `sendIntent` makes — and sends
  nothing: the in-flight lock stays, so a spec can tap the Board while a Sale or
  pick is busy without a timing race (`sale-tray.spec.ts`, "a Board tap while an
  intent is in flight…"). It is in both hook types
  (`apps/web/src/test-hooks.ts`, `apps/e2e/tests/test-hooks.ts`).
- A `showView` push bumps `seq` and clears the lock, like the server's answer;
  pass it the current `room().push.view` to keep the same Decision (and so the
  same pick UI — `decisionKey` is unchanged, no reset).
- The hook never sends, so a spec that holds an intent must not expect the
  server to move; it is a made-up state like `showView`.
