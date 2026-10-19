/**
 * Turn flow: the roll and passing the Turn (R13, R14, R21).
 *
 * This file is also the pattern for every rule area: declare the area's phases,
 * intents and events with declaration merging, export the intent handlers as a
 * `*Intents` object, and register it in `apply.ts`.
 */
import type { PlayerId } from "#state.ts";
import type { IntentHandlers } from "#handlers.ts";
import { landOn } from "#rules/landing.ts";
import { moveForward } from "#rules/movement.ts";
import { beginTurn } from "#rules/quarantine.ts";
import { randomInt } from "#rng.ts";
import { emit, type Tx } from "#tx.ts";

declare module "#state.ts" {
  interface PhaseMap {
    /** The current Player may roll the dice. */
    awaitingRoll: {};
  }
}

declare module "#intents.ts" {
  interface PlayerIntentMap {
    /** Roll two dice and play out the move (R21). */
    Roll: {};
  }
}

declare module "#events.ts" {
  interface EventMap {
    DiceRolled: { player: PlayerId; dice: readonly [number, number] };
    /** The Turn passed to `player`; `turn` is the new Turn number. */
    TurnPassed: { player: PlayerId; turn: number };
  }
}

export const awaitingRoll = () => ({ kind: "awaitingRoll" }) as const;

export const turnIntents = {
  Roll: {
    actor: "player",
    phases: ["awaitingRoll"],
    run(tx) {
      const player = tx.state.currentPlayer;
      const dice = [randomInt(tx, 1, 6), randomInt(tx, 1, 6)] as const;
      emit(tx, { type: "DiceRolled", player, dice });
      moveForward(tx, player, dice[0] + dice[1]);
      landOn(tx, player);
      if (!tx.decided) passTurn(tx);
    },
  },
} satisfies Partial<IntentHandlers>;

/**
 * Passes the Turn to the next non-Bankrupt Player in Seat order (R14).
 * The game-end check (R15, #32) runs here, before the Turn passes.
 */
export function passTurn(tx: Tx): void {
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
