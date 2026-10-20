/**
 * The Erasmus travel intent (R65): move forward to the chosen Field and land
 * there normally. Split from `erasmus.ts` because `landing.ts` imports the
 * corner's landing function, so the handler cannot import `landOn` back.
 */
import { FIELD_COUNT } from "#board.ts";
import type { IntentHandlers } from "#handlers.ts";
import { rejection } from "#rejections.ts";
import { landOn } from "#rules/landing.ts";
import { moveForward } from "#rules/movement.ts";
import { passTurn } from "#rules/pass-turn.ts";
import { playerById, type Tx } from "#tx.ts";

export const erasmusIntents = {
  TravelErasmus: {
    actor: "player",
    phases: ["choosingErasmus"],
    run(tx: Tx, intent) {
      const { phase } = tx.state;
      if (phase.kind !== "choosingErasmus" || !phase.fields.includes(intent.field)) {
        return rejection("NOT_OFFERED");
      }
      const player = playerById(tx, tx.state.currentPlayer);
      // Always forward round the ring: the bonus and the landing follow the dice path (R65).
      const steps = (intent.field - player.position + FIELD_COUNT) % FIELD_COUNT;
      moveForward(tx, player.id, steps);
      landOn(tx, player.id);
      if (!tx.decided) passTurn(tx);
      return undefined;
    },
  },
} satisfies Partial<IntentHandlers>;
