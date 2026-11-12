# Ticket #239 (cue table and Playback-driven cues, dice first): extension points and gotchas

Branch `agent/issue-239-sound-cue-table-and-playback-driven-cues-dice-firs`,
spec #178. The one dice element is now a named cue table, a pooled player and
a trigger that follows the Playback frame. Later sound tickets (purchase/Rent,
Chance, Bankrupt/game end, music) build on this table.

## The table (`apps/web/src/sound/cues.ts`)

- `CUES` — cue name → its effect file, imported from `#assets/sounds/`; only
  `dice` today. `CueName = keyof typeof CUES`.
- `EVENT_CUES: CueTable` — one row per `GameEvent["type"]` (the mapped type in
  the same file), `CueName | "none"`, one row per line so parallel sound
  tickets can add rows without conflicts. `DiceRolled: "dice"`; every other
  event is explicitly `"none"`. A new event type fails `pnpm -r run typecheck`
  until it has a row, the same gate as `EVENT_PRESENTATION`.
- `cuesReached(events, from, to)` — the cues of the events in `[from, to)`, in
  order, with the range clamped; a silent event contributes nothing. It does no
  clock arithmetic (the ADR-0004 fence).

## Adding a cue

1. Put the file in `apps/web/assets/sounds/` and add a row to
   `apps/web/assets/sounds/LICENSES.md` (source and licence).
2. Add `name: soundFile` to `CUES`.
3. Set the event type's `EVENT_CUES` row to that name.
4. Update `apps/web/test/cues.test.ts` (`CUED` pins every row).

## The trigger (`apps/web/src/sound/cue-sync.ts`)

- `syncCues(push, frame)` mirrors `syncLog` in `stores/log-store.ts`: it reads
  `frame.eventsReached` and plays the cues of the newly reached events, once
  each, in order. The module keeps a cursor `{ seq, shown }`; a repeated frame,
  a frame for another push's seq and an older seq play nothing. A hidden tab's
  late wake that reaches several events plays all of them, in order. A push
  with no events (a reconnect) plays nothing.
- `resetCues()` clears the cursor. `playback-store`'s `start()` calls it when
  the push becomes `null` (leaving a Room), because `roomStore.reset()` drops
  the push counter back to zero and the next Room's first push would otherwise
  look older than the cursor.
- It is called from `publish()` in `apps/web/src/playback/playback-store.ts`,
  next to `syncLog`, with the same push and frame. `eventsReached` counts an
  event once its step has started, so a push whose first event is `DiceRolled`
  plays the dice on its first frame — the Playback's start is the push's
  arrival. Do not add a second timer or any time conversion here.

## The player (`apps/web/src/audio.ts`)

- `playCue(name)` replaces `playDice()`; each cue has a pool of `POOL_SIZE` (3)
  `HTMLAudioElement`s, round-robin, each play restarting from 0, so two cues in
  quick succession both start. Elements are created lazily on first use.
- `unlockAudio()` / `installAudioUnlock()` keep their names and the first
  `pointerdown`/`keydown` rule. `unlockAudio` starts every pooled element
  silently (volume 0, play, pause, restore); an element created later is
  unlocked when it is made, and a cue on it waits for that silent play to
  finish before playing, so the first sound is audible rather than paused
  under the unlock. Under `navigator.webdriver` each element is muted but
  `play()` is still called, so `two-guests.spec.ts` can count it.
- `playCue` returns early when `Audio` is undefined, because the store's vitest
  imports it through the Playback store in Node. The mute check is still
  `soundStore.muted`; `stores/sound-store.ts` is unchanged by this ticket.
- `#audio.ts` re-exports `soundStore` for `sound.test.ts`; `main.tsx` keeps
  calling `installAudioUnlock()`.
- `Game.tsx` no longer imports `#audio.ts`: the effect that played the dice on
  a push with `DiceRolled` is gone. Never add a push-driven sound; cues follow
  frames.

## Tests

- `apps/web/test/cues.test.ts` pins every `EVENT_CUES` row (against a literal
  table), the two tables' key sets, `CUES.dice`'s file, and `cuesReached`'s
  ranges, order, clamping and empty cases.
- `apps/web/test/sound.test.ts` stubs `Audio` (a `FakeAudio` counting
  `play`/`pause`), `localStorage` and `window`, reloads the module with
  `vi.resetModules()`, and pins pool rotation, mute persistence, unlocking
  every element once, an element created after the unlock, the muted unlock
  and the webdriver mute. `settle()` flushes the unlock's promise chain with
  microtasks, not a timer.
- `apps/web/test/cue-sync.test.ts` mocks `#audio.ts` (`vi.hoisted` + `vi.mock`)
  and drives fake `{ seq, eventsReached }` frames plus one real
  `playbackOfPush(...).frameAt(receivedAt)` at a fixed clock.

## e2e

`apps/e2e/tests/two-guests.spec.ts` still counts
`HTMLMediaElement.prototype.play` as `window.dicePlays`; its assertions are
`> playsBeforeRoll`, which holds with the lazy pool (the first cue's element
adds one silent unlock play). Playwright is run by CI, not by implementers.
