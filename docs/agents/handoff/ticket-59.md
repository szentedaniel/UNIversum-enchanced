# Ticket #59 (review fixes for spec #58) — what changed and gotchas

Branch `ticket/59-retro-review-fixes` (on `v2-modernization`), spec #58. No
product code changed: the Playback fence, the e2e helpers and the docs.
Version: #58.

## The ADR-0004 fence (the old `playback-fence.test.ts`, split by #68)

#68 replaced this one scanner with the Oxlint import override and
`apps/web/test/server-clock-fence.test.ts`; the points below record how the
scanner #59 reviewed worked.

- **Matching is whole-file, not line by line.** `scan(fence, source, file)`
  runs `matchAll` over the comment-stripped source, so `\s*` may span a
  newline and an expression oxfmt wrapped is still caught. The reported line
  is the line where the match **starts** (a wrapped `Date.now() +` reports
  the `+` line), and the message keeps
  `<file>:<line>: <rule> — use <replacement>. Line: <code>`.
- **Every fence regex needs the `g` flag.** `matchAll` throws without it.
  `PLAYBACK_CONSTANT` anchors with `^`, so it also needs `m`.
- **One violation per line.** A line with two matches reports once, as the
  line-based fence did.
- **`Fence.except(file, line)`** sees the trimmed start line. The clock
  fence's only exception is the declaration line
  `const actsAfter = push.view.actsAfter - push.clockOffset` in
  `playback/playback-store.ts`; a second `clockOffset` sum there fails, and
  so does any other line in the file.
- **Tests to copy:** `scan(...)` with a synthetic source and virtual file name
  is the pattern for each new case; `violations(fence)` is the tree-wide
  assertion. Before adding a case, drop a scratch `.ts` file under
  `apps/web/src`, watch the tree-wide test fail on it, then delete it.
- The four fence constants use `satisfies Fence` (no `as const`), and the
  test names carry the `ADR-0004:` prefix so a reviewer can find them.

## E2E helpers (`apps/e2e/tests/helpers.ts`)

- **One create-and-join path.** `createAndJoin` (private) creates the
  2-Player Room and fills the second Seat; `startGame` (creator + guest,
  starts the game) and `twoInLobby` (creator + joiner, leaves the Lobby
  open) are the two public wrappers. Both register the pages for the failure
  dump. A spec that reopens a page after a drop or a reconnect must call
  `registerPage(name, page)` again, or the dump reads the closed page.
- **`closeAfterDump(...resources)` is variadic**: hand every context and
  launched browser over in one call (`closeAfterDump(desktops, phones)`).
- **`ROLL_PLAYBACK_MS` lives here** (moved from `two-guests.spec.ts`): the
  longest Playback a Roll's push can carry (`playbackOf` over the worst-case
  events). `two-guests` and `failure-dump` use it instead of a bare timeout.
- **Hook types are named in `test-hooks.ts`**: `TestHooks`, `Rejection`,
  `PlaybackHook`. `PageDump` in `helpers.ts` uses `Rejection | null` and
  `PlaybackHook | null`, so the dump and the hooks cannot drift. A new hook
  or a changed return shape goes in `test-hooks.ts` once; consumers follow.

## Docs

- `CODING_STANDARDS.md` §Every area names a test by what it pins (`R44:`,
  `F12:`, `ADR-0004:`) in any package, and allows a helper's own spec to call
  the helper directly (`failure-dump.spec.ts` tests `dumpPage`). Its
  dependency rule names the import fence for the web side; the server's and
  the packages' imports are a review responsibility.
- `docs/agents/implementer.md` §5 points at the standards for Playback waits
  instead of repeating the rule. Change the rule in `CODING_STANDARDS.md`
  §E2E, not in both.
