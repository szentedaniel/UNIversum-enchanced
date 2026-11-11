# Ticket #198 (a Bot stands in for a dropped Player) — extension points and gotchas

Branch `agent/issue-198-a-bot-stands-in-for-a-dropped-player`, from main at `9f1bc31`.

## What landed

- **The Seat's connection is the new fact.** `GameDriverOptions.isSeatConnected`
  (`apps/server/src/room/game-driver.ts`) takes the Room's callback;
  `GameRoom.isSeatConnected` answers it from `this.clients.get(seat.sessionId)`.
  `gauges()` reads the same helper, so the metrics and the Bot agree on
  "connected". A Bot's Seat has `sessionId: null` and never counts.
- **`#botPlays(state)`** decides the open Decision: the current Player is a
  seated Bot (`PlayerState.bot`), or their Seat has no live connection (a drop,
  or a consented leave). `#armBot(state, plays)` arms the single wake-up at
  `max(actsAfter, now) + BOT_DELAY_MS`; `#playBot` re-checks `#botPlays` before
  acting (a reconnect may have raced the timer) and submits with
  `state.currentPlayer` as the actor.
- **`GameDriver.refreshBot()`** re-evaluates the open Decision's Bot action. The
  Room calls it on `onDrop`, `onReconnect`, `takeBack` and `onLeave` (running
  game only). A reconnect cancels the pending action, so the Guest answers the
  Decision; an action already applied stands because its commit armed the next
  Decision's wake-up.
- **`resume` arms only a seated Bot** (`player?.bot === true`), not an absent
  Guest: a restored game has had no connection to lose in this server's run, so
  its absent Guests keep their Turn timers until the first connection change.
  After that first change (or any commit) `#botPlays` applies and the absent
  Seats play. A restored Bot Seat still acts 1.5 s after boot, as #196 set.
- **No web change.** A stand-in Guest's Seat and Player card are not marked
  BOT: the Player is still the Guest (#196 marks only seated Bots).
- **Tests.** `apps/server/test/bots.test.ts` (`a Bot stands in for a dropped
  Guest`: plays without a `TimedOut`, a reconnect cancels the pending action and
  the Guest rolls, an applied action stands, and a consented leave is played
  too), all through real SDK clients and the `ManualScheduler`; wait for
  `room.gauges().held === 1` before advancing the clock, or the drop may land
  after the advance. The #35 test in `apps/server/test/reconnect.test.ts` that
  expected a dropped Guest's Turn to time out now expects the Bot's Roll;
  `turn-timer.test.ts`, `playback.test.ts` and `engine-errors.test.ts` keep
  their timeout cases with a connected Player who simply does not act.

## Extension points and gotchas

- **Ticket #199 owns "no Guest connected".** `#botPlays` has no Room-level
  guard: after a restart (from the first commit on), or once the last Guest
  leaves, the Bots play the game out among themselves. #199 should suppress
  arming when no Guest is connected (`GameRoom.gauges().connected` is the same
  fact), inside `#botPlays` or at the Room's `refreshBot` call sites.
- **A drop within `BOT_DELAY_MS` (1.5 s) of the Turn deadline still times out.**
  The wake-up is `max(actsAfter, now) + BOT_DELAY_MS`; it is not clamped to
  `turnDeadline`, so a Guest who drops at the last second pays the penalty.
- **`refreshBot` re-arms from now.** It cancels and re-arms, so it must only be
  called on a connection change: calling it while a Bot Seat's action is pending
  delays that action by another `BOT_DELAY_MS`.
- **A restored Seat whose Guest has not come back looks absent.** It has
  `sessionId: null`, so `gauges().held` counts it and any later commit arms the
  Bot for it. That is the #199 case above.
- A refused Bot intent is still only logged (`Bot intent refused`); there is no
  metric for a stand-in's action, and the Turn timer still moves the game on.
