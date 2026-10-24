/**
 * Passing the Turn (R14) and the phase every Turn starts in. Kept apart from
 * the roll (`rules/turn.ts`) so the rule areas a landing leads to (Universities,
 * Museums, …) can pass the Turn without an import cycle through `landing.ts`.
 */
import { beginTurn } from "#rules/quarantine.ts";
import { checkGameEnd } from "#rules/game-end.ts";
import type { PlayerId } from "#state.ts";
import { emit, type Tx } from "#tx.ts";

declare module "#state.ts" {
  interface PhaseMap {
    /** The current Player may roll the dice. */
    awaitingRoll: {};
  }
}

declare module "#events.ts" {
  interface EventMap {
    /** The Turn passed to `player`; `turn` is the new Turn number. */
    TurnPassed: { player: PlayerId; turn: number };
  }
}

export const awaitingRoll = () => ({ kind: "awaitingRoll" }) as const;

/**
 * Passes the Turn to the next non-Bankrupt Player in Seat order (R14).
 * The game-end check (R15, #32) runs here first, before the Turn passes; the
 * new Turn then starts in `beginTurn` (the dice, or the Quarantine choice).
 */
export function passTurn(tx: Tx): void {
  if (checkGameEnd(tx)) return;
  const { players } = tx.state;
  const current = players.findIndex((p) => p.id === tx.state.currentPlayer);
  for (let step = 1; step <= players.length; step++) {
    const next = players[(current + step) % players.length];
    if (next && !next.bankrupt) {
      tx.state.currentPlayer = next.id;
      break;
    }
  }
  tx.state.turn += 1;
  emit(tx, { type: "TurnPassed", player: tx.state.currentPlayer, turn: tx.state.turn });
  beginTurn(tx);
}
