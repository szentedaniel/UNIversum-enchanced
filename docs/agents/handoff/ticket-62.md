# Ticket #62 (review fixes for #61 and the first CI fixes) — what changed and gotchas

Branch `ticket/62-review-fixes-61` (on `v2-modernization`), spec #22. Test
infrastructure and docs only; no product code changed.

## Two auto fixtures, not one (`apps/e2e/tests/helpers.ts`)

- **`pageErrorGuard`** owns `pageErrors`: it resets the list at setup, then
  fails the test with `<registered name> threw: <stack>`.
- **`failureDump` depends on `pageErrorGuard`.** Fixtures tear down in reverse
  setup order, so the dump attaches and closes the handed-over resources first;
  the guard throws last, after the dumps exist. Without the dependency the
  guard would fail a passing test before anything was attached.
- `failureDump` still decides on its own whether to attach **on a failure or
  when `pageErrors` is non-empty**: at its teardown `testInfo.status` cannot
  know that the guard will throw (`testInfo.expectedStatus` is unaffected).
- A page's errors are reported under its **current** registered name
  (`pageNames`, a `WeakMap<Page, string>`). Registering a page under a new name
  also drops its old dump name, so it gets one attachment.
- The guard hooks start in `registerPage` (one `pageerror` listener per page);
  a page that is never registered gets no guard. Register before navigating if
  a load-time error must be caught.
- `pageErrorGuard`'s empty fixture destructure carries an oxlint disable: the
  fixture needs no other fixture, only the module state.

## Socket probe exports

- `probeSockets(page)` must run **before** the page navigates to a Room;
  `createAndJoin` does it for `startGame`/`twoInLobby`.
- `expectOneJoinSocket(page, name)` asserts exactly one construction, with
  `protocols: "undefined"`. A page that opened another socket first cannot use
  the count: lobby-list's joiner and watcher open the **Lobby list** socket on
  `/rooms` before joining, so that spec checks only the creator's direct
  create. Both are still probed, so the recorded calls stay in the page.
- `SocketCall.protocols` is the `typeof` literal union
  (`"undefined" | "object" | …`). TypeScript types `typeof value` as that
  union, so the probe needs no cast; the assertion keeps its expected value
  type-checked with `[{ protocols: "undefined" }] satisfies SocketCall[]`.

## Spec migrations

- `tabletop.spec.ts`: the Lobby-and-game test registers `creator`/`guest`,
  installs the probe on both, and hands the guest's context to
  `closeAfterDump`. The Seat-card assertions run before the guest joins, so
  `twoInLobby` does not fit; the hand-rolled flow stays. The other three tests
  use no fixture pages, so the shared `test` is a no-op for them.
- `lobby-list.spec.ts`: the password-Lobby test registers `creator`, `joiner`
  and `watcher`, hands both contexts over, and probes creator + joiner;
  `closeAfterDump` replaced its `finally`. The other password tests keep their
  own contexts: they never reach `/game/`.
- Every spec that reaches `/game/` now imports `test` from `./helpers.ts`.
  `error-reporting.spec.ts` stays on `@playwright/test` because it throws on
  purpose.
- `fieldCenter` and `scale` are exported from `helpers.ts` (`camera` is private
  under `scale`); `startGame`'s Board-up poll and tabletop's settled-camera
  poll use `scale`.
- `CODING_STANDARDS.md` §Docs and commits now lists `ci` (CI workflow changes).

## Proof recipe (repeat when you touch the guard)

Plant a page error in the game screen only: `useEffect(() => { setTimeout(() =>
{ throw new Error("planted page error"); }, 0); }, [])` at the top of `Game()`.
Rebuild with `TEST_HOOKS=1`, then run tabletop and lobby-list: their game tests
fail with `creator threw: Error: planted page error` and the rest pass. Revert
and rebuild before continuing. A module-level throw would break the Lobby too
(`App.tsx` imports `Game` eagerly), so it proves nothing.
