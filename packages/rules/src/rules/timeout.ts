/**
 * The Turn timer running out (R17–R19). The Room server keeps one wake-up per
 * Room for `turnDeadline` and sends `TurnTimedOut { turn }` with the `SYSTEM`
 * actor; a stale one (another Turn) is rejected by `apply` as `STALE_TURN`.
 */
import { LOW_CASH_TIMEOUT_PENALTY, TIMEOUT_PENALTY_THRESHOLD } from "#constants.ts";
import type { IntentHandlers } from "#handlers.ts";
import { rejection } from "#rejections.ts";
import {
  autoSellPicks,
  fieldsOf,
  goBankrupt,
  payFromCash,
  saleValueOfAll,
  sellFields,
} from "#rules/charge.ts";
import { quarantineChoiceTimeout } from "#rules/quarantine-choice.ts";
import { autoSellAndPay } from "#rules/sale.ts";
import { passTurn } from "#rules/turn.ts";
import type { PhaseKind, PlayerId } from "#state.ts";
import { emit, playerById, type Tx } from "#tx.ts";

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
  // Auto-sell and the Charge, then the penalty (R69). No Buyout follows.
  selling(tx) {
    autoSellAndPay(tx);
    payTimeoutPenalty(tx, tx.state.currentPlayer);
    passTurn(tx);
  },
};

export const timeoutIntents = {
  TurnTimedOut: {
    actor: "system",
    phases: "any",
    run(tx) {
      if (tx.ctx.now < tx.state.turnDeadline) return rejection("NOT_OFFERED");
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
 * The Timeout penalty (R19, F7), to the Bank. Above 100,000 cash: 10% of cash,
 * rounded. At 100,000 or less: 100,000, raised by Auto-sell first (cheapest
 * Fields until the proceeds reach it), with cash paying only what the Fields
 * can't; Bankrupt when cash and every Field together fall short.
 */
export function payTimeoutPenalty(tx: Tx, playerId: PlayerId): void {
  const player = playerById(tx, playerId);
  if (player.cash <= TIMEOUT_PENALTY_THRESHOLD) {
    const pending = { kind: "timeoutPenalty", amount: LOW_CASH_TIMEOUT_PENALTY } as const;
    const sale = saleValueOfAll(tx.state, fieldsOf(tx.state, playerId));
    if (player.cash + sale < pending.amount) return goBankrupt(tx, playerId, pending);
    sellFields(tx, playerId, autoSellPicks(tx.state, playerId, pending.amount), true);
    return payFromCash(tx, playerId, pending);
  }
  const amount = Math.round(player.cash * 0.1);
  player.cash -= amount;
  emit(tx, { type: "TimeoutPenaltyPaid", player: playerId, amount });
}
