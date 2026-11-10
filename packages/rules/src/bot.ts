/**
 * The Bot policy (spec #171): one "normal" level of simple heuristics, from a
 * Player's view and the open Decision to one Player intent.
 *
 * It reads only the `publicView` a client gets — no clock, no randomness, no
 * PRNG state — so it cannot know a future Roll or Chance card. Static Board
 * data is the rules' constant, not hidden state. The Room server submits the
 * intent like any Guest's, and the engine validates it (ADR-0001, ADR-0003).
 */
import type { PlayerIntent } from "#intents.ts";
import type { PublicView } from "#view.ts";

/**
 * The intent a Bot submits for the open Decision, or `null` once the game is
 * over. The switch is exhaustive: a new phase fails to compile until the
 * policy covers it.
 */
export function botIntent(view: PublicView): PlayerIntent | null {
  const turn = view.turn;
  switch (view.phase.kind) {
    case "awaitingRoll":
      return { type: "Roll", turn };
    case "gameOver":
      return null;
    default: {
      const unhandled: never = view.phase;
      throw new Error(`the Bot has no policy for phase ${JSON.stringify(unhandled)}`);
    }
  }
}
