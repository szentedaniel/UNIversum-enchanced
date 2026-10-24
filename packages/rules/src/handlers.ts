import type { Intent, IntentOf, IntentType, SystemIntent } from "#intents.ts";
import type { Rejection } from "#rejections.ts";
import type { PhaseKind } from "#state.ts";
import type { Tx } from "#tx.ts";

/** How `apply` runs one intent type. */
export type IntentHandler<K extends IntentType> = {
  /** `player`: only the current Player may send it. `system`: only the Room server. */
  actor: K extends SystemIntent["type"] ? "system" : "player";
  /**
   * The phases in which the intent is legal; anywhere else it is `NOT_OFFERED`.
   * `"any"`: every phase, including ones added later (`TurnTimedOut`).
   */
  phases: readonly PhaseKind[] | "any";
  /**
   * Plays the intent out on `tx` up to the next Player decision. Return a
   * Rejection to refuse it (for example an option the phase does not offer);
   * the state is then left untouched.
   */
  run(tx: Tx, intent: IntentOf<K>): Rejection | void;
};

/** One handler for every intent type: `apply.ts` fails to compile if one is missing. */
export type IntentHandlers = { [K in IntentType]: IntentHandler<K> };

/** A handler seen without its intent type, as `apply` dispatches it. */
export type AnyIntentHandler = {
  actor: "player" | "system";
  phases: readonly PhaseKind[] | "any";
  run(tx: Tx, intent: Intent): Rejection | void;
};
