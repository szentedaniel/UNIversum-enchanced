# Ticket #55 (ADR-0004 fence) — what changed and gotchas

Branch `ticket/55-playback-fence` (on `v2-modernization`), spec #58. One
vitest file, `apps/web/test/playback-fence.test.ts`, reads every `.ts`/`.tsx`
file under `apps/web/src` (minus the generated `paraglide/` folder) and fails
when either of two ADR-0004 patterns comes back. No product code changed.

## The rules it enforces

1. Playback durations come only from `@universum/rules/playback`:
   - no arithmetic on a `PLAYBACK_MS` entry, on either side of the operator
     (`PLAYBACK_MS.Moved * 2`, `2 * PLAYBACK_MS.Moved`);
   - no scaling a `Moved` step count into a length (`event.steps * 160`,
     `160 * event.steps`, `STEP_MS * event.steps`);
   - no numeric `*_MS` constant declared under `apps/web/src/playback/`.
     The replacement is `playbackOfEvent(event)` / `playbackOf(events)`.
2. One server-clock estimate:
   - no file except `lib/server-clock.ts` does arithmetic with `clockOffset`
     or a member expression ending in it (`Date.now() + push.clockOffset`);
   - the replacement is `serverNow(clockOffset)` from `#lib/server-clock.ts`;
   - (**#64**: `serverNow` and its home moved to
     `@universum/protocol/messages`, `lib/server-clock.ts` is deleted, and the
     fence exempts no web file — see `ticket-64.md`.)
   - the one named exception is `decisionOpensAt`'s `actsAfter - clockOffset`
     in `playback/playback-store.ts` (a server timestamp becomes a client one;
     not the same operation as `serverNow`).

## Narrowings (deliberate, do not widen)

- `progress * event.steps` in `board/board.ts` — the pawn's place along the
  walk — is interpolation, not a duration. The step-count fence therefore
  catches `.steps *` plus the reverse order only when the other operand is a
  number literal or a `*_MS` constant. A bare `* <x>.steps` matcher would fail
  on the current tree.
- UI timings that are not Playback lengths stay allowed: `PAN_MS`, `FIT_MS`,
  `SETTLE_MS`, `ZOOM_STEP_MS` (`board/board.ts`), `TAP_MS`
  (`board/gestures.ts`), `AUTO_SELL_WARNING_MS` (`pick/sale.ts`), `COPIED_MS`
  (`screens/Lobby.tsx`), `BACK_HOME_AFTER_MS` (`components/ReconnectOverlay.tsx`).
  The `*_MS` constant rule only covers `apps/web/src/playback/`.
- The clock fence looks for `clockOffset` only. `lobbyClockOffset` (computed in
  `connection.ts` from a Lobby push, read through `serverNow` in `Lobby.tsx`)
  does not match it.

## How the matcher works

- Comments are stripped with line numbers kept (`stripComments`), because the
  playback modules' doc comments mention `PLAYBACK_MS` and `clockOffset`.
  Strings, template literals and regex literals are copied whole, so a `//`
  inside `"https://…"` or `/\/\//` cannot swallow the rest of a line. The
  stripper has its own tests in the same file; keep them if you touch it.
- Matching is line-based: a violation split across lines is not caught. Keep
  these expressions on one line.
- A failure reads
  `apps/web/src/<file>:<line>: <rule> — use <replacement>. Line: <code>`.

## When a fence fires

Do not add an allow-list entry for a new file. Use the replacement, or, if the
rule itself is wrong, change the fence and say why in the commit. #56
(`CODING_STANDARDS.md`) can leave these two rules out of the reviewer's list:
the fence enforces them now.
