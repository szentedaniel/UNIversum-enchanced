/**
 * @universum/rules: the pure rules engine (ADR-0003). No I/O, no timers, no
 * `Math.random`/`Date.now`, no Zod. Exported as `.ts` source with no build step.
 *
 * Public interface: `setupGame`, `apply`, `publicView`, the static Board data
 * and the types. Everything else is internal to the engine.
 */
export * from "#board.ts";
export { apply, isRejection, type Applied } from "#apply.ts";
export { START_CASH, ROUND_BONUS } from "#constants.ts";
export type { EventMap, EventOf, EventType, GameEvent } from "#events.ts";
export {
  SYSTEM,
  type Actor,
  type Ctx,
  type Intent,
  type PlayerIntent,
  type PlayerIntentMap,
  type SystemIntent,
  type SystemIntentMap,
  type IntentOf,
  type IntentType,
} from "#intents.ts";
export { RULES_REJECTION_CODES, type Rejection, type RulesRejectionCode } from "#rejections.ts";
export { setupGame, type SetupInput } from "#setup.ts";
export {
  STATE_VERSION,
  type DoublerState,
  type FieldState,
  type GameState,
  type Phase,
  type PhaseKind,
  type PhaseMap,
  type PhaseOf,
  type PlayerId,
  type PlayerName,
  type PlayerState,
  type Seat,
  type Seed,
  type Settings,
} from "#state.ts";
export { publicView, type PublicView } from "#view.ts";
