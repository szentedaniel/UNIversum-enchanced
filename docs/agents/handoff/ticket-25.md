# Ticket #25 (Turn timer / Timeout penalty) — extension points for later tickets

Branch `ticket/25-turn-timer`.

## Rules (`packages/rules`)

- `GameState.turnDeadline` (epoch ms). `setPhase` (tx.ts) sets it to `turnDeadlineFrom(ctx.now)` = now + `TURN_LIMIT_MS` (20 000) + `TURN_SLACK_MS` (3 000) on EVERY phase change; `setupGame` sets the first one. Never set `tx.state.phase` directly or the deadline goes stale. Constants in `constants.ts` (`TIMEOUT_PENALTY_THRESHOLD` = 100 000 too); `TURN_LIMIT_MS`/`TURN_SLACK_MS` exported from index.
- `STATE_VERSION` NOT bumped (nothing is persisted yet; #34 should start migrations from whatever shape is current at its merge).
- Handlers may now say `phases: "any"` (handlers.ts/apply.ts). `TurnTimedOut` (system intent, `rules/timeout.ts`) uses it, so it works in every phase added later with no edit here.
- `TurnTimedOut` before `turnDeadline` → `NOT_OFFERED`; wrong `turn` → `STALE_TURN` (apply). Emits `TimedOut {player}` first, then the outcome.
- **#29 / #30:** add an entry to `TIMEOUT_OUTCOMES` in `rules/timeout.ts` keyed by your phase kind: `(tx) => void`, reads `tx.state.phase`, must play everything out INCLUDING `passTurn(tx)`. Default (no entry) = `payTimeoutPenalty(tx, player)` + `passTurn(tx)`.
- **#29:** `payTimeoutPenalty` currently charges nothing at cash ≤ 100 000 (early return) — replace that branch with Auto-sell / cash / Bankrupt. Upper branch emits `TimeoutPenaltyPaid {player, amount}` (amount = Math.round(cash*0.1), as v1).
- `publicView` adds `turnDeadline` and derived `turnTimer: { endsAt: deadline − slack, limitMs: 20 000 }`.
- Tests: `packages/rules/test/timeout.test.ts`. Time = the `now` arg of `accept/reject/roll` helpers; `state.turnDeadline` is the earliest legal timeout.

## Server (`apps/server`)

- `room/scheduler.ts`: `Scheduler = { now(), at(time, task) → cancel }`, `systemScheduler` (setTimeout, past times fire at once). `createGameServer({ scheduler })` defines a `GameRoom` subclass with it; `GameRoom.now()` = `scheduler.now()`.
- `GameRoom.commit` broadcasts `{ view, events, now }` and calls `scheduleDeadline(state)` (one wake-up per Room, previous cancelled; cancelled on dispose). Wake-up → `timeOut(turn)` → `apply(TurnTimedOut, SYSTEM)`; rejections ignored; an engine throw is swallowed (no reschedule — #44 may want a retry/log).
- **#34 restore:** after loading a state, call the commit path / `scheduleDeadline` so a passed deadline fires at once.
- Tests: `startTestServer()` now always uses a `ManualScheduler` (test/helpers.ts, starts at `T0`); `server.scheduler.advanceTo(time)` runs due wake-ups (and ones they schedule) in order; `lastTaskAt(time)` returns a scheduled task's callback to fire it late/stale by hand. Nothing fires on its own, so tests never hit a real 23 s timer. The scheduler is shared by every Room in a test file: advancing time also times out other tests' Rooms (harmless, but don't count pushes across Rooms).

## Protocol

- `GameMessage.now` = server clock at send. Web stores `Push.clockOffset = now − Date.now()`.

## Web

- `screens/TurnRing.tsx` `<TurnRing timer={view.turnTimer} clockOffset />`: SVG ring (`role="timer"`, name "Turn timer"), CSS animation with negative delay; keyed by `turn:turnDeadline` so each decision restarts it. Rendered inside `.figure` of the current Player's `li.player` in `Game.tsx` — #40 restyles/moves it into the Player cards/chips; #29 can reuse it in the pick tray.
- Toasts: `TimedOut` → `event_timed_out`, `TimeoutPenaltyPaid` → `event_timeout_penalty` (en/hu/de).
- E2E asserts one ring per screen on the current Player; no e2e waits for a real timeout (would take 23 s).
