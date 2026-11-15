# Ticket #253 (a spectator watches a Roll and cannot act) — the e2e spec and what it pins

Branch `agent/issue-253-e2e-a-spectator-watches-a-move-and-cannot-act`, from `main`
after #252 (the read-only Lobby and the spectator chip). Spec #179. No production
code changed: the code diff is one Playwright spec, tested in CI only.

## The spec

- **`apps/e2e/tests/spectator.spec.ts`**, one test: `a spectator watches a Roll in
  step with the Playback and has no way to act`. It runs in both default projects
  (desktop-chromium and iphone-webkit): `playwright.config.ts`'s `MIXED` only
  catches `two-guests`/`full-game`, so no config entry was needed.
- It drives `createAndJoin` (creator on the `page` fixture, guest in a fresh
  context) with `{ turnLimitMs: 30_000 }`, then `startLobby`, then a third fresh
  context for the spectator. Each Guest has its own context, so its own Guest
  token.
- The 30 s Turn limit is deliberate: the spectator joins the _started_ game, so
  three Boards must come up (WebKit's first Board budget is 15 s in
  `expectBoardUp`) before the creator's first Roll; the default 20 s Turn can run
  out meanwhile.
- The spectator takes the real Home path: `goto("/")`,
  `getByRole("textbox", { name: "Room code" }).fill(code)`,
  `getByTestId("watch").click()`. It lands on `/game/:code` through the Lobby's
  `started` navigation, because a spectator joining a running Room receives a
  `GameMessage` (the server's count-only broadcast, #249), never a `WelcomeMessage`.

## What it asserts, and the ids it reads

- `data-testid="watching"` with the text `Watching`; `data-testid="board"` visible;
  `expectBoardUp`; `room().me` is `null`; two Player cards/chips.
- `data-testid="spectators"` contains `1 spectator` on both Players' screens and
  on the spectator's own screen.
- The spectator's Board view equals the creator's pushed view (`view()` hook).
- No intent control: no button named `Roll`, no `data-testid="deal-open"`, no
  `data-testid="offer"`, no `data-testid="sale-tray"`, no `data-testid="pick-tray"`,
  and `data-testid="turn-of"` never says `Your Turn`.
- The Roll's Playback runs on the spectator: `playback().gateOpen` goes false,
  the `dice` cue count rises by exactly one, then the gate opens and
  `data-testid="offer"` is visible on the creator. The moved pawn sits on its
  destination's `fieldCenter` (within 2 px) and the spectator's `view()` equals
  the Roll's pushed view.

The Roll control has no `data-testid`, so the spec finds it by its accessible
name (`getByRole("button", { name: "Roll", exact: true })`); the buy/offer
control is `data-testid="offer"`. The game has no end-turn control at all, so
there is nothing to assert for it.

## Gotchas for later e2e work

- `GAME_SEED` (`playwright.config.ts`) fixes the first Roll of a 2-Guest game: the
  dice [5, 5] move the creator from Start to Field 10 and stop at a University
  offer (verified against `newGame`/`roll` with seed `4,29,55,129`). A spec that
  changes the Seat count or the seed breaks that offer assertion.
- The Playback waits budget with `ROLL_PLAYBACK_MS` (`playbackOf` over the
  longest Roll), per `CODING_STANDARDS.md` §E2E; the actual first Roll is only
  `DiceRolled` + a 10-Field `Moved`.
- The password case is not covered: `createAndJoin` has no password option, and
  `apps/server/test/spectators.test.ts` already pins the password gate for a
  spectator.
