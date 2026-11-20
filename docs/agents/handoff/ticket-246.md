# Ticket #246 (cue play counts for the e2e specs) — what changed and gotchas

Branch `agent/issue-246-e2e-count-plays-per-cue-and-assert-a-purchase-cue`,
spec #178. A spec asserts a cue without hearing it: the app counts its own
`playCue` calls per cue name.

## The counter

- `apps/web/src/audio.ts`: `cueCounts` holds one number per `CueName`, the
  private `countPlay(name)` bumps it, and the exported
  `cuePlays(): Record<CueName, number>` returns a copy. `playCue` counts after
  its mute and no-`Audio` early returns, so a muted cue counts nothing, and
  before the element is touched, so a rejected `play()` (no gesture yet) still
  counts.
- The record's keys are a literal typed `Record<CueName, number>`, so a new cue
  row fails typecheck until it is added here too.
- The count sits behind the build-time `TEST_HOOKS_ENABLED` define
  (`apps/web/vite.config.ts`): `TEST_HOOKS=1` keeps it, a production build
  compiles the `countPlay` call out and tree-shakes `cuePlays` — after a plain
  `vite build`, `grep cuePlays apps/web/dist/assets/*.js` finds nothing, and
  neither does `grep universumTest`.
- Vitest's mode is `test`, so `TEST_HOOKS_ENABLED` is true there and
  `apps/web/test/sound.test.ts` (the two `cuePlays` tests) needs no env var.

## The hooks and the spec

- `apps/web/src/test-hooks.ts` adds `cuePlays` to the `TestHooks` object, so
  `window.universumTest?.cuePlays()` answers while the Board is mounted
  (`exposeBoard` installs and removes the hooks). The counts are per page load:
  a reload resets them — the language switch at the end of
  `two-guests.spec.ts` reloads a page, so read counts before it.
- `apps/e2e/tests/test-hooks.ts` mirrors it as
  `cuePlays(): Record<string, number>`; `window.dicePlays` and the
  `HTMLMediaElement.prototype.play` init script stay for the spec that still
  reads them.
- `apps/e2e/tests/two-guests.spec.ts` has the spec-local `readCuePlays(page)`
  and `cueCountsOnBoth(cue)` (one count per page, in `both`'s order): every
  Roll must raise `dice` by exactly one on both pages, and every purchase (the
  first Level, the first Museum) must raise `buy` by exactly one on both. Both
  waits go through `expectCueOnce(cue, before)`, which polls for
  `ROLL_WAIT_MS` (`ROLL_PLAYBACK_MS + 1_000`), not a bare number.
- `expectCueOnce` then settles: after the count reaches `before + 1`, it waits
  for both pages' Decision gate to open (`expectGate` from `helpers.ts`, so
  the cue's Playback frame has ended, ADR-0004), holds the count for
  `CUE_RECHECK_MS` (150 ms; a named, commented constant in the spec, kept
  short because it runs after every Roll and purchase) and re-asserts it, so a
  duplicate from a re-read frame or one that lands once the gate opens fails;
  the hold is also the settle's wait when the gate was already open at the
  count poll. The count poll comes first, so a decision's answer push cannot
  pass on the previous push's open gate, and the settle sits after the dice
  poll, never before `expectPlaybackHold`.
- A cue plays from the push's Playback frame at its step's start
  (`playback-store.ts` → `sound/cue-sync.ts`), never from the push itself:
  the first step starts at the push's arrival, a later one after the steps
  before it, which is what the poll waits out. The cursor in `cue-sync.ts`
  keeps one push's frame re-reads from playing a cue twice.

Read for: any e2e assertion on a sound cue, a new `CUES` row, or a test-hook
guard change.
