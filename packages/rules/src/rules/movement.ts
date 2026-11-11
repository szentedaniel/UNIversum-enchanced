/**
 * Moving forward round the ring, and the Round bonus (R23, R73). Every forward
 * move goes through `moveForward`: the dice, the roll out of Quarantine (#30),
 * Erasmus travel (#31) and the Scholarship transfer card (#190). Only
 * `moveForwardWithoutRoundBonus` skips the bonus.
 */
import { FIELD_COUNT, type FieldId } from "#board.ts";
import { ROUND_BONUS } from "#constants.ts";
import type { PlayerId } from "#state.ts";
import { emit, playerById, type Tx } from "#tx.ts";

declare module "#events.ts" {
  interface EventMap {
    Moved: { player: PlayerId; from: FieldId; to: FieldId; steps: number };
    RoundBonusPaid: { player: PlayerId; amount: number };
  }
}

/** Moves a Player `steps` Fields forward and pays the Round bonus for passing or landing on Start. */
export function moveForward(tx: Tx, playerId: PlayerId, steps: number): void {
  const from = playerById(tx, playerId).position;
  moveForwardWithoutRoundBonus(tx, playerId, steps);
  if (from + steps >= FIELD_COUNT) {
    playerById(tx, playerId).cash += ROUND_BONUS;
    emit(tx, { type: "RoundBonusPaid", player: playerId, amount: ROUND_BONUS });
  }
}

/**
 * Moves a Player `steps` Fields forward without the Round bonus, even when the
 * walk passes Start: the Exam period card's way into Quarantine (#190).
 */
export function moveForwardWithoutRoundBonus(tx: Tx, playerId: PlayerId, steps: number): void {
  const player = playerById(tx, playerId);
  const from = player.position;
  const to = (from + steps) % FIELD_COUNT;
  player.position = to;
  emit(tx, { type: "Moved", player: playerId, from, to, steps });
}
