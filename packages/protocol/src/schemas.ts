/**
 * Zod schemas for everything a client sends: the `intent` message and the
 * Room create/join options. The server parses with `safeParse`; the web app
 * never imports this file (it only sends what the view offers).
 *
 * Add a schema to `PLAYER_INTENT_SCHEMAS` for every new Player intent in the
 * rules engine; `PlayerIntentsMatchRules` below fails to compile until the
 * schemas and the rules' `PlayerIntent` type agree.
 */
import type { PlayerIntent } from "@universum/rules";
import { z } from "zod";
import {
  DEFAULT_SETTINGS,
  MINUTE_LIMITS,
  PLAYER_COUNTS,
  type Assert,
  type ClientIntent,
  type CreateOptions,
  type JoinOptions,
  type RoomSettings,
} from "#messages.ts";

const turn = z.int().nonnegative();

const PLAYER_INTENT_SCHEMAS = [
  z.strictObject({ type: z.literal("Roll"), turn }),
  z.strictObject({ type: z.literal("RollForTwelve"), turn }),
  z.strictObject({ type: z.literal("BuyPcrTest"), turn }),
  z.strictObject({ type: z.literal("UsePcrTest"), turn }),
] as const;

const ROOM_INTENT_SCHEMAS = [z.strictObject({ type: z.literal("Start") })] as const;

export const playerIntentSchema = z.discriminatedUnion("type", [...PLAYER_INTENT_SCHEMAS]);

export const intentSchema = z.discriminatedUnion("type", [
  ...ROOM_INTENT_SCHEMAS,
  ...PLAYER_INTENT_SCHEMAS,
]);

type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;

/** Compile-time check: the Player intent schemas parse exactly the rules' `PlayerIntent`. */
export type PlayerIntentsMatchRules = Assert<
  Same<z.infer<typeof playerIntentSchema>, PlayerIntent>
>;

/** Compile-time check: `intentSchema` parses exactly `ClientIntent`. */
export type ClientIntentsMatch = Assert<Same<z.infer<typeof intentSchema>, ClientIntent>>;

export const createOptionsSchema = z.object({
  maxPlayers: z.literal(PLAYER_COUNTS).default(DEFAULT_SETTINGS.maxPlayers),
  minuteLimit: z.literal(MINUTE_LIMITS).default(DEFAULT_SETTINGS.minuteLimit),
});

export type CreateOptionsInputMatch = Assert<
  Same<z.input<typeof createOptionsSchema>, CreateOptions>
>;
export type CreateOptionsOutputMatch = Assert<
  Same<z.output<typeof createOptionsSchema>, RoomSettings>
>;

export const joinOptionsSchema = z.object({});

export type JoinOptionsMatch = Assert<
  [z.output<typeof joinOptionsSchema>] extends [JoinOptions] ? true : false
>;
