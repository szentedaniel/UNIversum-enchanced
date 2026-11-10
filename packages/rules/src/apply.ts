import type { GameEvent } from "#events.ts";
import type { AnyIntentHandler, IntentHandlers } from "#handlers.ts";
import { SYSTEM, type Ctx, type Intent } from "#intents.ts";
import { playbackOf } from "#playback.ts";
import { rejection, type Rejection } from "#rejections.ts";
import { turnDeadlineFrom } from "#constants.ts";
import { doublerIntents } from "#rules/doubler.ts";
import { erasmusIntents } from "#rules/erasmus-travel.ts";
import { dealIntents } from "#rules/deal.ts";
import { museumIntents } from "#rules/museums.ts";
import { quarantineChoiceIntents } from "#rules/quarantine-choice.ts";
import { saleIntents } from "#rules/sale.ts";
import { timeoutIntents } from "#rules/timeout.ts";
import { turnIntents } from "#rules/turn.ts";
import { universityIntents } from "#rules/universities.ts";
import type { GameState } from "#state.ts";
import type { Tx } from "#tx.ts";
import type { Reveal } from "#reveal.ts";

/**
 * Every intent's handler. A rule area adds its handlers by spreading its
 * `*Intents` object here; the type fails to compile while any intent in
 * `PlayerIntentMap` or `SystemIntentMap` has no handler.
 */
const HANDLERS: IntentHandlers = {
  ...turnIntents,
  ...universityIntents,
  ...timeoutIntents,
  ...museumIntents,
  ...doublerIntents,
  ...erasmusIntents,
  ...quarantineChoiceIntents,
  ...saleIntents,
  ...dealIntents,
};

export type Applied = { state: GameState; events: GameEvent[]; reveals: Reveal[] };

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
  // ADR-0004: nobody acts while the last intent's Playback is still running.
  // A system intent (TurnTimedOut) is never held: its deadline is later than
  // `actsAfter`, and the Playback must not be able to stall a Turn.
  if (handler.actor === "player" && ctx.now < state.actsAfter) {
    return rejection("PLAYBACK_RUNNING");
  }

  // The state is plain JSON by contract, so a JSON round trip is a full copy.
  const copy: GameState = JSON.parse(JSON.stringify(state));
  const tx: Tx = {
    state: copy,
    events: [],
    reveals: [],
    ctx,
    decided: false,
    phaseSet: false,
    finalPhase: false,
  };
  const refused = handler.run(tx, intent);
  if (refused) return refused;
  tx.state.version += 1;
  // The Playback is known only now that the event list is complete, so both
  // `actsAfter` and the deadline are fixed here, not in `setPhase` (ADR-0004).
  const actsAfter = ctx.now + playbackOf(tx.events);
  tx.state.actsAfter = actsAfter;
  if (tx.phaseSet) {
    tx.state.turnDeadline = tx.finalPhase ? null : turnDeadlineFrom(actsAfter, ctx.turnLimitMs);
  }
  return { state: tx.state, events: tx.events, reveals: tx.reveals };
}

export function isRejection(result: Applied | Rejection): result is Rejection {
  return "code" in result;
}
