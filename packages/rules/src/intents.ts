/**
 * Intents: what a Player (or the Room server, as `system`) asks the engine to
 * do. Every intent carries the `turn` it was meant for; a mismatch is stale.
 *
 * The map is open: each rule area adds its intents with declaration merging,
 * next to their handlers (see `rules/turn.ts`):
 *
 * ```ts
 * declare module "#intents.ts" {
 *   interface IntentMap {
 *     BuyLevel: { level: number };
 *   }
 * }
 * ```
 *
 * The protocol package checks its Zod schemas against `Intent` at compile time,
 * so a new intent also needs a schema there.
 */
import type { PlayerId } from "#state.ts";

export interface IntentMap {}

export type IntentType = keyof IntentMap;

export type Intent = {
  [K in IntentType]: { type: K; turn: number } & IntentMap[K];
}[IntentType];

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
};
