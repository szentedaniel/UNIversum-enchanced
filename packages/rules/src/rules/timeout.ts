/**
 * The Turn timer running out (R17–R19). The Room server keeps one wake-up per
 * Room for `turnDeadline` and sends `TurnTimedOut { turn }` with the `SYSTEM`
 * actor; a stale one (another Turn) is rejected by `apply` as `STALE_TURN`.
 */
import type { IntentHandlers } from "#handlers.ts";
import { rejection } from "#rejections.ts";
import { resumeTransfers } from "#rules/chance-transfer.ts";
import { charge, timeoutPenaltyOf } from "#rules/charge.ts";
import { dealAnswerTimeout } from "#rules/deal.ts";
import { quarantineChoiceTimeout } from "#rules/quarantine-choice.ts";
import { autoSellAndPay } from "#rules/sale.ts";
import { passTurn } from "#rules/turn.ts";
import type { PhaseKind, PlayerId } from "#state.ts";
import { emit, type Tx } from "#tx.ts";

declare module "#intents.ts" {
  interface SystemIntentMap {
    /** The current decision's `turnDeadline` has passed. */
    TurnTimedOut: {};
  }
}

declare module "#events.ts" {
  interface EventMap {
    /** `player`'s Turn timer ran out. */
    TimedOut: { player: PlayerId };
    /** `player` paid the Timeout penalty to the Bank (R19). */
    TimeoutPenaltyPaid: { player: PlayerId; amount: number };
  }
}

/**
 * Phases whose timeout is not "penalty, then the Turn passes" (R18). Each
 * outcome reads `tx.state.phase` and plays everything out, including passing
 * the Turn.
 */
const TIMEOUT_OUTCOMES: Partial<Record<PhaseKind, (tx: Tx) => void>> = {
  // One Quarantine round used up, no penalty (#30).
  quarantineChoice: quarantineChoiceTimeout,
  // The Deal counts as declined, no penalty; the proposer's decision reopens (spec #172).
  dealAnswer: dealAnswerTimeout,
  // Auto-sell and the Charge, then the penalty (R69). No Buyout follows. A
  // Chance card's Player-to-Player payment is not the Turn's own decision: the
  // Sale auto-sells and the card carries on, with no penalty.
  selling(tx) {
    if (tx.state.phase.kind !== "selling") return;
    const { resume } = tx.state.phase;
    autoSellAndPay(tx);
    if (resume.kind === "chanceTransfer") {
      if (resumeTransfers(tx, resume)) passTurn(tx);
      return;
    }
    payTimeoutPenalty(tx, tx.state.currentPlayer);
    passTurn(tx);
  },
};

export const timeoutIntents = {
  TurnTimedOut: {
    actor: "system",
    phases: "any",
    run(tx) {
      const { turnDeadline } = tx.state;
      if (turnDeadline === null || tx.ctx.now < turnDeadline) return rejection("NOT_OFFERED");
      const player = tx.state.currentPlayer;
      emit(tx, { type: "TimedOut", player });
      const outcome = TIMEOUT_OUTCOMES[tx.state.phase.kind];
      if (outcome) return outcome(tx);
      payTimeoutPenalty(tx, player);
      passTurn(tx);
    },
  },
} satisfies Partial<IntentHandlers>;

/**
 * The Timeout penalty (R19, F7), to the Bank: the solvency rule builds the
 * Charge from the Player's cash and settles it with Auto-sell first.
 */
function payTimeoutPenalty(tx: Tx, playerId: PlayerId): void {
  charge(tx, playerId, timeoutPenaltyOf(tx, playerId), { sell: "auto" });
}
