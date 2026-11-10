/**
 * Zod schemas for everything a client sends: the `intent` message and the
 * Room create/join options. The server parses with `safeParse`; the web app
 * never imports this file (it only sends what the view offers).
 *
 * Add a schema to `PLAYER_INTENT_SCHEMAS` for every new Player intent in the
 * rules engine; `PlayerIntentsMatchRules` below fails to compile until the
 * schemas and the rules' `PlayerIntent` type agree.
 */
import { FIELD_COUNT, MAX_LEVEL, type PlayerIntent } from "@universum/rules";
import { z } from "zod";
import {
  DEFAULT_SETTINGS,
  GUEST_TOKEN_PATTERN,
  MINUTE_LIMITS,
  PASSWORD_MAX_BYTES,
  PLAYER_COUNTS,
  STARTING_CASHES,
  TURN_LIMITS,
  utf8Length,
  type Assert,
  type ClientIntent,
  type CreateOptions,
  type JoinOptions,
  type RoomSettings,
} from "#messages.ts";

const turn = z.int().nonnegative();

/** A Player id: what the server hands out (`newPlayerId`), never a Guest token. */
const playerId = z.string().min(1).max(64);

/** One side of a Deal: Fields on the Board, and whole forints of cash. */
const dealSide = z.strictObject({
  fields: z
    .array(
      z
        .int()
        .min(0)
        .max(FIELD_COUNT - 1),
    )
    .max(FIELD_COUNT),
  cash: z.int().nonnegative(),
});

const PLAYER_INTENT_SCHEMAS = [
  z.strictObject({ type: z.literal("Roll"), turn }),
  z.strictObject({ type: z.literal("BuyLevel"), turn, level: z.int().min(1).max(MAX_LEVEL) }),
  z.strictObject({ type: z.literal("DeclineOffer"), turn }),
  z.strictObject({ type: z.literal("Buyout"), turn }),
  z.strictObject({ type: z.literal("BuyMuseum"), turn }),
  z.strictObject({ type: z.literal("RollForTwelve"), turn }),
  z.strictObject({ type: z.literal("BuyPcrTest"), turn }),
  z.strictObject({ type: z.literal("UsePcrTest"), turn }),
  z.strictObject({
    type: z.literal("SellFields"),
    turn,
    fields: z
      .array(
        z
          .int()
          .min(0)
          .max(FIELD_COUNT - 1),
      )
      .min(1)
      .max(FIELD_COUNT),
  }),
  z.strictObject({ type: z.literal("AutoSell"), turn }),
  z.strictObject({
    type: z.literal("PlaceDoubler"),
    turn,
    field: z
      .int()
      .min(0)
      .max(FIELD_COUNT - 1),
  }),
  z.strictObject({
    type: z.literal("TravelErasmus"),
    turn,
    field: z
      .int()
      .min(0)
      .max(FIELD_COUNT - 1),
  }),
  z.strictObject({
    type: z.literal("ProposeDeal"),
    turn,
    recipient: playerId,
    give: dealSide,
    take: dealSide,
  }),
  z.strictObject({ type: z.literal("AcceptDeal"), turn }),
  z.strictObject({ type: z.literal("DeclineDeal"), turn }),
] as const;

const ROOM_INTENT_SCHEMAS = [
  z.strictObject({ type: z.literal("Start") }),
  z.strictObject({ type: z.literal("AddBot") }),
  // The public Player id a Room made: bounded, but the Room looks it up in its own Seats.
  z.strictObject({ type: z.literal("RemoveBot"), playerId: z.string().min(1).max(64) }),
] as const;

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

/** A password of at most `PASSWORD_MAX_BYTES` UTF-8 bytes. */
const password = z
  .string()
  .refine((value) => utf8Length(value) <= PASSWORD_MAX_BYTES, "password too long");

/** A raw Room name; the server's Room name check normalises and judges it. This only bounds the work. */
const ROOM_NAME_MAX_RAW_LENGTH = 256;

/** See `GUEST_TOKEN_PATTERN`. */
const guestToken = z.string().regex(GUEST_TOKEN_PATTERN);

export const createOptionsSchema = z.object({
  maxPlayers: z.literal(PLAYER_COUNTS).default(DEFAULT_SETTINGS.maxPlayers),
  minuteLimit: z.literal(MINUTE_LIMITS).default(DEFAULT_SETTINGS.minuteLimit),
  startingCash: z.literal(STARTING_CASHES).default(DEFAULT_SETTINGS.startingCash),
  turnLimitMs: z.literal(TURN_LIMITS).default(DEFAULT_SETTINGS.turnLimitMs),
  roomName: z.string().max(ROOM_NAME_MAX_RAW_LENGTH).optional(),
  password: password.optional(),
  guestToken: guestToken.optional(),
});

export type CreateOptionsInputMatch = Assert<
  Same<z.input<typeof createOptionsSchema>, CreateOptions>
>;
export type CreateOptionsOutputMatch = Assert<
  Same<z.output<typeof createOptionsSchema>, Required<RoomSettings> & CreateOptions>
>;

export const joinOptionsSchema = z.object({
  code: z.string().regex(/^\d{6}$/),
  password: password.optional(),
  guestToken: guestToken.optional(),
});

export type JoinOptionsMatch = Assert<
  [z.output<typeof joinOptionsSchema>] extends [JoinOptions] ? true : false
>;
