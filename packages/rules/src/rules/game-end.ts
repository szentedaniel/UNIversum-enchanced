/**
 * Game end (R15, R76–R79). The check runs at every Turn change (`passTurn`),
 * after the Turn's consequences and before the next Turn begins, so no Turn
 * is cut off (R75). The conditions are checked in a strict order — one Player
 * left, then the Minute limit, then a Super-monopoly, then 3 Monopolies — so
 * there is always exactly one winner (F4, F5, F25).
 */
import type { PlayerId } from "#state.ts";
import { emit, setFinalPhase, type Tx } from "#tx.ts";

/** Why the game ended, which is also what the result screen says (R76–R79). */
export type GameEndReason = "lastPlayer" | "timeUp" | "superMonopoly" | "monopolies";

declare module "#state.ts" {
  interface PhaseMap {
    /**
     * The game is over: `winner` won by `reason`. No Player can act any more,
     * and there is no deadline (the Room never wakes up for it).
     */
    gameOver: { winner: PlayerId; reason: GameEndReason };
  }
}

declare module "#events.ts" {
  interface EventMap {
    /** The game ended (R76–R79): `winner` won by `reason`. */
    GameEnded: { winner: PlayerId; reason: GameEndReason };
  }
}

/** Ends the game: the final phase (no deadline) and the event everyone sees. */
function finish(tx: Tx, winner: PlayerId, reason: GameEndReason): void {
  // The winner is the current Player of the final state, so no Bankrupt Player
  // is ever the current Player (the one invariant that would otherwise break).
  tx.state.currentPlayer = winner;
  setFinalPhase(tx, { kind: "gameOver", winner, reason });
  emit(tx, { type: "GameEnded", winner, reason });
}

/**
 * The game-end check (R76–R79), at the Turn change. Returns whether the game
 * ended; when it did, the Turn does not pass.
 */
export function checkGameEnd(tx: Tx): boolean {
  if (tx.state.phase.kind === "gameOver") return true;
  const alive = tx.state.players.filter((player) => !player.bankrupt);
  const winner = alive[0] ?? tx.state.players[0];
  if (alive.length > 1 || !winner) return false;
  finish(tx, winner.id, "lastPlayer");
  return true;
}
