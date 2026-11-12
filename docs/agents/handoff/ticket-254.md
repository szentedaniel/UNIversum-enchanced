# Ticket #254 (hints: typed table, pure triggers, seen store) — extension points and gotchas

Branch `agent/issue-254-hints-typed-hint-table-pure-triggers-and-seen-stor`, from `main`.
Spec #180; #255 renders the first three rows, #256 the last three, #257 the menu switch and list.

## The table (`apps/web/src/hints/hints.ts`)

- `HINTS: readonly HintRow[]` has one row per concept, in display order: `offer`,
  `quarantine`, `doubler`, `erasmus`, `sale`, `gameEnd`. A row is
  `{ id: HintId; messageKey: HintMessageKey; trigger: ({ decision, view }) => boolean }`.
  The ids are persisted by the store, so renaming one would show that hint again.
- `nextHint({ decision, view, seen, enabled }): HintRow | null` is the one selector. It returns
  `null` with hints off, otherwise the first row whose id is not in `seen` and whose trigger
  fires; the table order decides a tie.
- Triggers are pure (no store, timer or `Date.now`) and read the Decision module's
  `OpenDecision` rather than re-reading phases: `openDecision` already returns `null` while the
  Playback gate is shut, and `owner: "me"` only for the viewer's own Roll, Offer, Quarantine
  choice, Sale and picks. So another Player's Decision, a spectator and a shut gate show nothing
  without a second gate check here.
- `gameEnd` fires at the viewer's first own Roll (`decision.kind === "roll"`), guarded by
  `view.phase.kind !== "gameOver"` so the Podium never shows it. The spec's "game-over check"
  was left open; if a later view field fits better, keep the row's shape and change only that
  trigger.
- `isHintId(value)` is the type guard the store uses; an id the table no longer knows is
  dropped.

## The store (`apps/web/src/stores/hint-store.ts`)

- `hintStore` (zustand vanilla) state: `seen: ReadonlySet<HintId>` and `enabled: boolean`;
  actions `dismiss(id)`, `setEnabled(enabled)` and `reset()` (clears `seen` and turns hints on).
  `dismiss` is idempotent.
- Keys: `universum.hintsSeen` holds a JSON array of ids, `universum.hintsEnabled` holds
  `"1"`/`"0"`. A missing, corrupt or unknown value reads as nothing seen / hints on. A blocked
  `localStorage` is swallowed as in `sound-store.ts`; the change still applies on the page.

## Messages

- `hint_offer`, `hint_quarantine`, `hint_doubler`, `hint_erasmus`, `hint_sale`, `hint_game_end`
  in `apps/web/messages/{hu,en,de}.json`, one sentence each (owner tone review pending). The
  copy uses the glossary's terms (Offer, Quarantine, PCR test, Doubler, Erasmus, Sale,
  Shortfall, Rent, Tax, Chance card, Museum, Monopoly, Wealth).
- `row.messageKey` is a literal union, so `m[row.messageKey]()` in the card type-checks. Run
  `pnpm --filter @universum/web run paraglide` after editing a message file.

## For the rendering tickets

- The render path is `m[row.messageKey]()` and `hintStore.dismiss(row.id)`. Pass the screen's
  `decision` (`openDecision(frame, me, inFlight)`) and `frame.view` to `nextHint`, plus the
  store's `seen` and `enabled`.
- #255 renders `offer`/`quarantine` in the Game bottom area and `sale` in `DecisionTray`; #256
  renders `doubler`/`erasmus` in the pick tray and `gameEnd` in the bottom area.

## Not touched

No UI, protocol, rules or `STATE_VERSION` change. e2e was not run because no UI changed.
