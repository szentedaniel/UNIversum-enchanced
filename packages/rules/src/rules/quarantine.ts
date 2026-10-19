/**
 * Quarantine (R16, R39, R40, R45): entering it on landing, and what a
 * quarantined Player gets at the start of their Turn. The choice itself (roll
 * for 12, PCR test, timeout) is in `rules/quarantine-choice.ts`, which needs
 * the Turn flow; this module needs nothing above `tx.ts`, so landing and
 * passing the Turn can import it without a cycle.
 */
import { PCR_TEST_PRICE, QUARANTINE_ROUNDS } from "#constants.ts";
import type { PlayerId } from "#state.ts";
import { emit, playerById, setPhase, type Tx } from "#tx.ts";

declare module "#state.ts" {
  interface PhaseMap {
    /**
     * A quarantined Player with rounds left chooses (R41): roll for 12 (always
     * offered), buy a PCR test (with at least 200,000 cash), or use a held one.
     */
    quarantineChoice: { canBuyPcrTest: boolean; canUsePcrTest: boolean };
  }
}

declare module "#events.ts" {
  interface EventMap {
    /** `player` landed on the Quarantine Field and sits out `rounds` Quarantine rounds (R39). */
    QuarantineEntered: { player: PlayerId; rounds: number };
    /** `player` left Quarantine: rounds served, a 12, or a PCR test (R42–R45). */
    QuarantineReleased: { player: PlayerId };
  }
}

/** Landing on the Quarantine Field (R39); nothing happens if already in Quarantine (R40). */
export function enterQuarantine(tx: Tx, playerId: PlayerId): void {
  const player = playerById(tx, playerId);
  if (player.quarantineRounds !== null) return;
  player.quarantineRounds = QUARANTINE_ROUNDS;
  emit(tx, { type: "QuarantineEntered", player: playerId, rounds: QUARANTINE_ROUNDS });
}

/**
 * The first phase of the current Player's Turn (R16): the dice, or the
 * Quarantine choice while rounds are left. A Player whose rounds have run out
 * is released here and rolls normally (R45).
 */
export function beginTurn(tx: Tx): void {
  const playerId = tx.state.currentPlayer;
  const player = playerById(tx, playerId);
  if (player.quarantineRounds !== null && player.quarantineRounds > 0) {
    setPhase(tx, {
      kind: "quarantineChoice",
      canBuyPcrTest: player.cash >= PCR_TEST_PRICE,
      canUsePcrTest: player.hasPcrTest,
    });
    return;
  }
  if (player.quarantineRounds === 0) release(tx, playerId);
  setPhase(tx, { kind: "awaitingRoll" });
}

/** Takes a Player out of Quarantine. */
export function release(tx: Tx, playerId: PlayerId): void {
  playerById(tx, playerId).quarantineRounds = null;
  emit(tx, { type: "QuarantineReleased", player: playerId });
}
