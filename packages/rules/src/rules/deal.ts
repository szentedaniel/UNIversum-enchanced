/**
 * Deals (spec #172): an exchange of Fields and cash between two Players. The
 * current Player proposes one at their Roll or Quarantine choice; the recipient
 * then answers while the proposer's own decision waits. Fields change hands at
 * their current Level and the Doubler stays where it stands; cash moves
 * between the two Players, never via the Bank.
 *
 * The answer is a Decision of the recipient's, so the recipient becomes the
 * current Player until the answer: the Turn timer on screen is theirs, and
 * `TurnTimedOut` names them. The proposer's Roll or Quarantine choice is
 * reopened by `beginTurn` once the answer's Playback ends, with a fresh
 * deadline and its options recomputed (a Deal moves cash).
 */
import type { FieldId } from "#board.ts";
import type { IntentHandlers } from "#handlers.ts";
import { rejection, type RulesRejectionCode } from "#rejections.ts";
import { beginTurn } from "#rules/quarantine.ts";
import { recordMonopolies } from "#rules/summary.ts";
import type { Deal, DealSide, PlayerId } from "#state.ts";
import { decide, emit, playerById, type Tx } from "#tx.ts";

declare module "#state.ts" {
  interface PhaseMap {
    /** The recipient answers the pending Deal (`state.deal`); the proposer waits. */
    dealAnswer: {};
  }
}

declare module "#intents.ts" {
  interface PlayerIntentMap {
    /** Put an exchange of Fields and cash to another Player (spec #172). */
    ProposeDeal: { recipient: PlayerId; give: DealSide; take: DealSide };
    /** Accept the pending Deal: the Fields and cash change hands. */
    AcceptDeal: {};
    /** Turn the pending Deal down; nothing moves. */
    DeclineDeal: {};
  }
}

declare module "#events.ts" {
  interface EventMap {
    /** `proposer` put `give` and `take` to `recipient`; the answer is pending. */
    DealProposed: Deal;
    /** `recipient` accepted: the Fields and the cash moved as the terms say. */
    DealAccepted: Deal;
    /** `recipient` turned the Deal down; nothing moved. */
    DealDeclined: { proposer: PlayerId; recipient: PlayerId };
    /** `recipient`'s Turn timer ran out; the Deal counts as declined, with no penalty. */
    DealExpired: { proposer: PlayerId; recipient: PlayerId };
  }
}

/**
 * Why a Deal cannot stand, or `null` when it can. The same check runs at the
 * proposal and at the acceptance, so a Field that changed hands or cash that is
 * no longer covered refuses the Deal instead of applying it.
 */
function dealProblem(tx: Tx, deal: Deal): RulesRejectionCode | null {
  const proposer = tx.state.players.find((player) => player.id === deal.proposer);
  const recipient = tx.state.players.find((player) => player.id === deal.recipient);
  if (!proposer || !recipient) return "DEAL_RECIPIENT_INVALID";
  if (proposer.bankrupt || recipient.bankrupt || proposer.id === recipient.id) {
    return "DEAL_RECIPIENT_INVALID";
  }
  const fields = [...deal.give.fields, ...deal.take.fields];
  if (new Set(fields).size !== fields.length) return "DEAL_FIELD_REPEATED";
  if (deal.give.fields.some((field) => tx.state.fields[field]?.owner !== proposer.id)) {
    return "DEAL_FIELD_NOT_OWNED";
  }
  if (deal.take.fields.some((field) => tx.state.fields[field]?.owner !== recipient.id)) {
    return "DEAL_FIELD_NOT_OWNED";
  }
  if (fields.length === 0 && deal.give.cash === 0 && deal.take.cash === 0) return "DEAL_EMPTY";
  if (proposer.cash < deal.give.cash || recipient.cash < deal.take.cash) {
    return "DEAL_CASH_NOT_COVERED";
  }
  return null;
}

/** Moves `fields` to `owner`; the Level and a Doubler standing there stay put. */
function transfer(tx: Tx, fields: readonly FieldId[], owner: PlayerId): void {
  for (const id of fields) {
    const field = tx.state.fields[id];
    if (field) field.owner = owner;
  }
}

/** Ends the pending Deal: the proposer's Roll or Quarantine choice reopens. */
function reopenProposer(tx: Tx, deal: Deal): void {
  tx.state.deal = null;
  tx.state.currentPlayer = deal.proposer;
  beginTurn(tx);
}

export const dealIntents = {
  ProposeDeal: {
    actor: "player",
    phases: ["awaitingRoll", "quarantineChoice"],
    run(tx, intent) {
      if (tx.state.dealUsed) return rejection("DEAL_ALREADY_PROPOSED");
      const deal: Deal = {
        proposer: tx.state.currentPlayer,
        recipient: intent.recipient,
        give: { fields: [...intent.give.fields], cash: intent.give.cash },
        take: { fields: [...intent.take.fields], cash: intent.take.cash },
      };
      const problem = dealProblem(tx, deal);
      if (problem) return rejection(problem);
      tx.state.deal = deal;
      tx.state.dealUsed = true;
      emit(tx, { type: "DealProposed", ...deal });
      tx.state.currentPlayer = deal.recipient;
      decide(tx, { kind: "dealAnswer" });
      return undefined;
    },
  },
  AcceptDeal: {
    actor: "player",
    phases: ["dealAnswer"],
    run(tx) {
      const deal = tx.state.deal;
      if (!deal) return rejection("NOT_OFFERED");
      const problem = dealProblem(tx, deal);
      if (problem) return rejection(problem);
      transfer(tx, deal.give.fields, deal.recipient);
      recordMonopolies(tx.state.summary, tx.state, deal.recipient, deal.give.fields);
      transfer(tx, deal.take.fields, deal.proposer);
      recordMonopolies(tx.state.summary, tx.state, deal.proposer, deal.take.fields);
      playerById(tx, deal.proposer).cash += deal.take.cash - deal.give.cash;
      playerById(tx, deal.recipient).cash += deal.give.cash - deal.take.cash;
      emit(tx, { type: "DealAccepted", ...deal });
      reopenProposer(tx, deal);
      return undefined;
    },
  },
  DeclineDeal: {
    actor: "player",
    phases: ["dealAnswer"],
    run(tx) {
      const deal = tx.state.deal;
      if (!deal) return rejection("NOT_OFFERED");
      emit(tx, { type: "DealDeclined", proposer: deal.proposer, recipient: deal.recipient });
      reopenProposer(tx, deal);
      return undefined;
    },
  },
} satisfies Partial<IntentHandlers>;

/**
 * The recipient's Turn timer ran out (spec #172): the Deal counts as declined,
 * with no Timeout penalty, and the proposer's decision reopens.
 */
export function dealAnswerTimeout(tx: Tx): void {
  const deal = tx.state.deal;
  if (!deal) return;
  emit(tx, { type: "DealExpired", proposer: deal.proposer, recipient: deal.recipient });
  reopenProposer(tx, deal);
}
