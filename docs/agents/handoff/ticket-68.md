# Ticket #68 (the fence as import rules and one pattern check): gotchas

Branch `ticket/68-fence-import-rules` (on `v2-modernization`), spec #63. The
358-line source scanner in `playback-fence.test.ts` is gone. Its two rules
became an Oxlint import override and a 105-line server-clock check.

## The Playback import rule (`.oxlintrc.json`)

- A second override covers `apps/web/src/**/*.{ts,tsx}` and excludes
  `apps/web/src/playback/**`. It adds `@universum/rules/playback` to
  `no-restricted-imports.paths`; the help reads "Only the Playback module
  (apps/web/src/playback/) may import @universum/rules/playback."
- **An override's rule config replaces the base one; it does not merge.** The
  src override repeats the whole `no-restricted-imports` (paths, patterns, the
  `@universum/rules` type allowance, protocol and Zod). A change to the web
  app's import rules belongs in both overrides, or the first reaches only
  `apps/web/test` and other non-src files.
- The src override's rules pattern keeps `!@universum/rules/playback`, so one
  import produces one diagnostic (from `paths`, whose help names the module).
  Oxlint would otherwise report the pattern match too.
- The rule covers `apps/web/src` only: `apps/web/test` may still import the
  durations, and `apps/e2e/tests/helpers.ts` keeps importing `PLAYBACK_MS` /
  `playbackOf` from `@universum/rules` (the root) for its Playback budgets.
- Type-only imports of `@universum/rules/playback` outside `playback/` are
  refused too (no `allowTypeImports`). None exist; types the web app needs from
  rules are at the root or `board`.
- `import-fence.test.ts` runs its allowed and forbidden lists at three
  locations: the scratch dir under `apps/web/test` (the base config), a sample
  in `apps/web/src/board/` (the override), and one in `apps/web/src/playback/`
  (the base config again, because the override excludes it). The two copies of
  `no-restricted-imports` must stay in step; a drift fails at the location it
  affects. Sample files are unique-named and removed in `afterAll`, also when a
  case fails. Oxlint's custom messages arrive in the JSON diagnostic's `help`,
  not `message`.

## The server-clock check (`apps/web/test/server-clock-fence.test.ts`)

- Scans `apps/web/src`, `apps/e2e/tests` and `apps/loadtest/src` for
  `clockOffset` or `serverOffset` next to `+ - * /`, on either side. Matching
  is over the whole file, so an oxfmt-wrapped `Date.now() +` on one line and
  `push.clockOffset` on the next is still caught and reported at the `+` line.
- The one exception is `playbackOfPush`'s inverse conversion, by file and line
  text: `apps/web/src/playback/playback.ts` +
  `/^const actsAfter = push\.view\.actsAfter\s*-/`. Moving or reflowing that
  line means updating `EXCEPTION_FILE`/`EXCEPTION_LINE` here.
- Comments are blanked with two regexes (block, then line), not the old
  hand-written tokenizer. A `//` inside a string on the same line as a
  violation would hide the violation (false negative); there is no false
  positive from doc comments.
- Deliberately not flagged: `connection.ts`'s offset computations
  (`clockOffset: now - receivedAt`, `lobbyClockOffset: lobby.now - Date.now()`)
  and `serverNow(push.clockOffset)` — neither puts an offset identifier next to
  an operator.
- The sample-file test plants a `Date.now() + push.clockOffset` in each of the
  three trees in memory. To prove the walk, drop a real `planted.ts` in a tree
  and run this spec; that was done for all three before the handoff.

## What is no longer fenced

- Rule 1 of the old fence — no arithmetic on `PLAYBACK_MS` entries, no scaling
  a `Moved` step count, no `*_MS` constant in `playback/` — is gone. The import
  rule keeps `PLAYBACK_MS`/`playbackOfEvent` inside `playback/`, which the spec
  accepted. A new duration or timing in `playback/` is a review responsibility
  now, as is any arithmetic on the rules constants inside the module.
- `CODING_STANDARDS.md` line 3 names both checks (import fence with the
  Playback restriction, server-clock fence) and no longer names the deleted
  file. The rest of the standards is unchanged.
