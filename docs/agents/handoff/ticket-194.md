# Ticket #194 (Deal composer and answer UI) — extension points and gotchas

Branch `agent/issue-194-deal-composer-and-answer-ui`, from `main`. Spec #172; builds on the
Deal engine from #192.

## The composer's rules are a pure module

- `apps/web/src/deal/deal.ts` derives the composer's choices from a `PublicView`:
  `dealRecipients(view, me)` (other active Players), `dealFields(view, owner)` (that owner's
  Fields in Board order), `dealCash(view, player)`, `dealProblem(view, me, draft)` (the
  refusal: `"recipient" | "field" | "cash" | "empty"`) and `dealProposal(view, me, draft)`
  (`IntentOf<"ProposeDeal"> | null`). `DealDraft` is `{ recipient, give: DealSide, take:
  DealSide }`.
- The module mirrors the engine's own refusals so the composer offers only what the server
  accepts; the engine remains the authority. `apps/web/test/deal.test.ts` drives these
  functions from real `publicView`s. **No `dealUsed`/one-per-Turn input exists yet**: #193 owns
  that guard, and the composer will need to read its view flag once it lands.

## The UI

- `apps/web/src/screens/DealTray.tsx` exports two components:
  - `DealComposer({ view, me, onClose })`: the recipient `fieldset` (`deal-recipient` buttons,
    `aria-pressed`), one `FieldChoices` per side, the cash input (`max` = that payer's cash;
    test ids `deal-give-cash` / `deal-take-cash`), the Field toggles (`deal-give-field-<id>` /
    `deal-take-field-<id>`), `deal-problem` and `deal-propose`. It sends `ProposeDeal` itself.
  - `DealAnswerPanel({ view, deal, clockOffset, seat })`: `deal-answer` with `deal-from`,
    `deal-answer-give` (what the recipient gives = `deal.take`), `deal-answer-get` (what they
    get = `deal.give`), a `TimerRing`/`TurnRing` for the recipient's deadline, `deal-accept`
    and `deal-decline`.
- `apps/web/src/screens/TurnCard.tsx` owns the wiring: a `deal-open` button beside Roll and
  under the Quarantine choice, the answer panel, and the `deal-waiting` line for the proposer
  and bystanders. The composer's visibility is local state keyed by
  `` `${view.turn}:${view.turnDeadline}` `` — a new decision (the answer, the next Turn, the
  reopened Roll after an answer) leaves it closed, with no `setState` in an effect.
- `TurnCard` now takes `clockOffset` and `seat` from `Game.tsx` for the answer timer.

## The Decision module

- `apps/web/src/decision/decision.ts` gained `{ owner: "me"; kind: "deal"; deal }` for the
  recipient (hidden while its intent is in flight, like Roll/Offer) and
  `{ owner: "other"; player; kind: "deal" }` as the waiting line. `mySaleOrPick` ignores it,
  so the Board does not treat a Deal answer as a pick; the bottom slot still shows the Turn
  card.
- `apps/web/src/text.ts` now owns `dealSideText` (moved out of
  `apps/web/src/playback/presentation.ts`), so the Playback toast and the answer panel render
  the same Field-name/cash list. The Deal events and their toasts were already in the
  presentation table from #192.

## Messages

- New keys in `apps/web/messages/{hu,en,de}.json`: `deal_open`, `deal_title`,
  `deal_recipient`, `deal_you_give`, `deal_you_get`, `deal_cash_max`, `deal_propose`,
  `deal_cancel`, `deal_problem_{recipient,empty,field,cash}`, `deal_from`, `deal_accept`,
  `deal_decline`, `deal_waiting`. Run `pnpm --filter @universum/web run paraglide` after
  editing them.

## E2E

- `apps/e2e/tests/helpers.ts`'s `resolveDecision` takes a fourth argument,
  `chooseDeal: (deal: Deal) => "accept" | "decline"` (default `"decline"`), and returns
  `{ kind: "deal"; accepted }`; the old `dealAnswer` throw is gone. Existing specs never
  propose, so their calls are unchanged.
- `apps/e2e/tests/deal.spec.ts` starts two Guests, buys the creator a Field, proposes it for
  100,000 Ft, accepts on the guest, then asserts both views and both Field cards show the new
  owner. It relies on the e2e `GAME_SEED` (`4,29,55,129`) making the creator's first Roll an
  offer; a seed change needs the loop's expectations re-checked.

Read for: #193 (the per-Turn guard the composer must honour), #200 (the loadtest Bot's
`dealAnswer`), any Deal UI, Deal message, or `resolveDecision` change.
