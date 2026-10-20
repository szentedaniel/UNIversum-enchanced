/**
 * Intents: what a Player, or the Room server itself, asks the engine to do.
 * Every intent carries the `turn` it was meant for; a mismatch is stale.
 *
 * The maps are open: each rule area adds its intents with declaration merging,
 * next to their handlers (see `rules/turn.ts`). Player intents go in
 * `PlayerIntentMap`; intents only the Room server sends (deadlines) go in
 * `SystemIntentMap`:
 *
 * ```ts
 * declare module "#intents.ts" {
 *   interface PlayerIntentMap {
 *     BuyLevel: { level: number };
 *   }
 *   interface SystemIntentMap {
 *     TurnTimedOut: {};
 *   }
 * }
 * ```
 *
 * The protocol package checks its Zod schemas against `PlayerIntent` at compile
 * time, so a new Player intent also needs a schema there.
 */
import type { PlayerId } from "#state.ts";

export interface PlayerIntentMap {}

export interface SystemIntentMap {}

type IntentUnion<M> = { [K in keyof M]: { type: K; turn: number } & M[K] }[keyof M];

/** Intents a Player sends, as the current Player. */
export type PlayerIntent = IntentUnion<PlayerIntentMap>;

/** Intents the Room server sends with the `SYSTEM` actor. */
export type SystemIntent = IntentUnion<SystemIntentMap>;

export type Intent = PlayerIntent | SystemIntent;

export type IntentType = Intent["type"];

export type IntentOf<K extends IntentType> = Extract<Intent, { type: K }>;

/** The actor of intents the Room server makes itself (deadlines): no Player. */
export const SYSTEM = null;

/** The acting Player's public id, or `SYSTEM`. */
export type Actor = PlayerId | typeof SYSTEM;

/** What `apply` needs from outside the state: who acts, and the server's clock. */
export type Ctx = {
  actor: Actor;
  /** The server's `now` (epoch ms). The engine never reads a clock itself. */
  now: number;
  /**
   * The Turn limit in ms (`TURN_LIMIT_MS` when left out). The server sets a
   * shorter one for e2e runs; it is not part of the game state.
   */
  turnLimitMs?: number;
};
