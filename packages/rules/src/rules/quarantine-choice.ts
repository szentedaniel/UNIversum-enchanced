/**
 * The Quarantine choice (R41–R44, R46): roll for 12, buy a PCR test or use a
 * held one, and what a timeout on the choice does. Entering Quarantine and the
 * phase itself are in `rules/quarantine.ts`.
 */
import { PCR_TEST_PRICE, QUARANTINE_ESCAPE_ROLL } from "#constants.ts";
import type { IntentHandlers } from "#handlers.ts";
import { rejection } from "#rejections.ts";
import { landOn } from "#rules/landing.ts";
import { moveForward } from "#rules/movement.ts";
import { release } from "#rules/quarantine.ts";
import { passTurn } from "#rules/turn.ts";
import { randomInt } from "#rng.ts";
import type { PlayerId } from "#state.ts";
import { decide, emit, playerById, type Tx } from "#tx.ts";

declare module "#intents.ts" {
  interface PlayerIntentMap {
    /** Roll the dice in Quarantine: only a 12 gets out (R24, R42). */
    RollForTwelve: {};
    /** Buy a PCR test for 200,000 and leave Quarantine at once (R43). */
    BuyPcrTest: {};
    /** Spend the held PCR test and leave Quarantine at once (R44). */
    UsePcrTest: {};
  }
}

declare module "#events.ts" {
  interface EventMap {
    /** `player` paid `amount` to the Bank for a PCR test (R43). */
    PcrTestBought: { player: PlayerId; amount: number };
    /** `player` spent their held PCR test (R44). */
    PcrTestUsed: { player: PlayerId };
    /** `player` used up a Quarantine round and stays; `roundsLeft` remain (R42, R46). */
    QuarantineRoundUsed: { player: PlayerId; roundsLeft: number };
  }
}

export const quarantineChoiceIntents = {
  RollForTwelve: {
    actor: "player",
    phases: ["quarantineChoice"],
    run(tx) {
      const player = tx.state.currentPlayer;
      const dice = [randomInt(tx, 1, 6), randomInt(tx, 1, 6)] as const;
      emit(tx, { type: "DiceRolled", player, dice });
      if (dice[0] + dice[1] !== QUARANTINE_ESCAPE_ROLL) {
        useRound(tx, player);
        passTurn(tx);
        return;
      }
      release(tx, player);
      moveForward(tx, player, QUARANTINE_ESCAPE_ROLL);
      landOn(tx, player);
      if (!tx.decided) passTurn(tx);
    },
  },
  BuyPcrTest: {
    actor: "player",
    phases: ["quarantineChoice"],
    run(tx) {
      if (tx.state.phase.kind !== "quarantineChoice" || !tx.state.phase.canBuyPcrTest) {
        return rejection("NOT_OFFERED");
      }
      const player = tx.state.currentPlayer;
      playerById(tx, player).cash -= PCR_TEST_PRICE;
      emit(tx, { type: "PcrTestBought", player, amount: PCR_TEST_PRICE });
      return releaseToRoll(tx, player);
    },
  },
  UsePcrTest: {
    actor: "player",
    phases: ["quarantineChoice"],
    run(tx) {
      if (tx.state.phase.kind !== "quarantineChoice" || !tx.state.phase.canUsePcrTest) {
        return rejection("NOT_OFFERED");
      }
      const player = tx.state.currentPlayer;
      playerById(tx, player).hasPcrTest = false;
      emit(tx, { type: "PcrTestUsed", player });
      return releaseToRoll(tx, player);
    },
  },
} satisfies Partial<IntentHandlers>;

/** A timeout on the Quarantine choice: one round used up, no penalty, the Turn passes (R46). */
export function quarantineChoiceTimeout(tx: Tx): void {
  useRound(tx, tx.state.currentPlayer);
  passTurn(tx);
}

/** A PCR test releases the Player at once, and they roll normally this Turn (R43, R44). */
function releaseToRoll(tx: Tx, playerId: PlayerId): void {
  release(tx, playerId);
  decide(tx, { kind: "awaitingRoll" });
}

/** One Quarantine round is used up; the Player stays in Quarantine. */
function useRound(tx: Tx, playerId: PlayerId): void {
  const player = playerById(tx, playerId);
  const roundsLeft = Math.max(0, (player.quarantineRounds ?? 0) - 1);
  player.quarantineRounds = roundsLeft;
  emit(tx, { type: "QuarantineRoundUsed", player: playerId, roundsLeft });
}
