/**
 * Turn flow: the roll (R13, R21). Passing the Turn (R14) lives in
 * `rules/pass-turn.ts` and is re-exported here.
 *
 * This file is also the pattern for every rule area: declare the area's phases,
 * intents and events with declaration merging, export the intent handlers as a
 * `*Intents` object, and register it in `apply.ts`.
 */
import type { PlayerId } from "#state.ts";
import type { IntentHandlers } from "#handlers.ts";
import { landOn } from "#rules/landing.ts";
import { moveForward } from "#rules/movement.ts";
import { passTurn } from "#rules/pass-turn.ts";
import { randomInt } from "#rng.ts";
import { emit } from "#tx.ts";

export { awaitingRoll, passTurn } from "#rules/pass-turn.ts";

declare module "#intents.ts" {
  interface PlayerIntentMap {
    /** Roll two dice and play out the move (R21). */
    Roll: {};
  }
}

declare module "#events.ts" {
  interface EventMap {
    DiceRolled: { player: PlayerId; dice: readonly [number, number] };
  }
}

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
