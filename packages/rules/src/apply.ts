import type { GameEvent } from "#events.ts";
import type { AnyIntentHandler, IntentHandlers } from "#handlers.ts";
import { SYSTEM, type Ctx, type Intent } from "#intents.ts";
import { rejection, type Rejection } from "#rejections.ts";
import { timeoutIntents } from "#rules/timeout.ts";
import { turnIntents } from "#rules/turn.ts";
import type { GameState } from "#state.ts";
import type { Tx } from "#tx.ts";

/**
 * Every intent's handler. A rule area adds its handlers by spreading its
 * `*Intents` object here; the type fails to compile while any intent in
 * `PlayerIntentMap` or `SystemIntentMap` has no handler.
 */
const HANDLERS: IntentHandlers = {
  ...turnIntents,
  ...timeoutIntents,
};

export type Applied = { state: GameState; events: GameEvent[] };

/**
 * The rules engine (ADR-0003): applies one intent and plays out every
 * automatic consequence up to the next Player decision. Pure: the input state
 * is never changed, and the same state, intent and ctx give the same result.
 */
export function apply(state: GameState, intent: Intent, ctx: Ctx): Applied | Rejection {
  const handler = HANDLERS[intent.type] as AnyIntentHandler | undefined;
  if (!handler) return rejection("NOT_OFFERED");
  if (intent.turn !== state.turn) return rejection("STALE_TURN");
  const allowed = handler.actor === "system" ? SYSTEM : state.currentPlayer;
  if (ctx.actor !== allowed) return rejection("NOT_YOUR_TURN");
  if (handler.phases !== "any" && !handler.phases.includes(state.phase.kind)) {
    return rejection("NOT_OFFERED");
  }

  // The state is plain JSON by contract, so a JSON round trip is a full copy.
  const copy: GameState = JSON.parse(JSON.stringify(state));
  const tx: Tx = { state: copy, events: [], ctx, decided: false };
  const refused = handler.run(tx, intent);
  if (refused) return refused;
  tx.state.version += 1;
  return { state: tx.state, events: tx.events };
}

export function isRejection(result: Applied | Rejection): result is Rejection {
  return "code" in result;
}
