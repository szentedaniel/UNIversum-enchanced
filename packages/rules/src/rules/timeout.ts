/**
 * The Turn timer running out (R17–R19). The Room server keeps one wake-up per
 * Room for `turnDeadline` and sends `TurnTimedOut { turn }` with the `SYSTEM`
 * actor; a stale one (another Turn) is rejected by `apply` as `STALE_TURN`.
 */
import { TIMEOUT_PENALTY_THRESHOLD } from "#constants.ts";
import type { IntentHandlers } from "#handlers.ts";
import { rejection } from "#rejections.ts";
import { quarantineChoiceTimeout } from "#rules/quarantine-choice.ts";
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
 * the Turn. The Sale (#29: Auto-sell, then the penalty) and the Quarantine
 * choice (#30: one round used up, no penalty) add their entries here.
 */
const TIMEOUT_OUTCOMES: Partial<Record<PhaseKind, (tx: Tx) => void>> = {
  quarantineChoice: quarantineChoiceTimeout,
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
 * The Timeout penalty (R19). Above 100,000 cash: 10% of cash, rounded, to the
 * Bank. The ≤ 100,000 branch (Auto-sell, then cash, then Bankrupt) comes with
 * the Sale (#29); until then it charges nothing.
 */
export function payTimeoutPenalty(tx: Tx, playerId: PlayerId): void {
  const player = playerById(tx, playerId);
  if (player.cash <= TIMEOUT_PENALTY_THRESHOLD) return;
  const amount = Math.round(player.cash * 0.1);
  player.cash -= amount;
  emit(tx, { type: "TimeoutPenaltyPaid", player: playerId, amount });
}
