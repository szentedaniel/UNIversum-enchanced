/**
 * The Zod-free part of the protocol: message names, payload types, Room
 * options, Rejection codes and the Player-name words. This subpath
 * (`@universum/protocol/messages`) is the only one the web app may import, so
 * it imports nothing at runtime except other Zod-free files of this package.
 *
 * The server sends ids, codes and numbers only, never text.
 */
import type {
  GameEvent,
  PlayerId,
  PlayerIntent,
  PlayerName,
  PublicView,
  RulesRejectionCode,
} from "@universum/rules";

export * from "#player-names.ts";

/** The Colyseus Room type every game is played in. */
export const GAME_ROOM = "game";

/** The Colyseus LobbyRoom that streams the Lobby list. */
export const LOBBY_ROOM = "lobby";

/**
 * Messages of the LobbyRoom (Colyseus's own names), server → client:
 * `rooms` the whole list on join, `+` `[code, listing]` a Lobby added or
 * changed, `-` `code` a Lobby gone (closed or started). Each listing's
 * `metadata` is a `LobbyListingMetadata`.
 */
export const LOBBY_LIST_MESSAGE = { rooms: "rooms", add: "+", remove: "-" } as const;

/** Message names. The client sends only `intent`; everything else is server → client. */
export const MESSAGE = {
  /** Client → server: one `ClientIntent`. */
  intent: "intent",
  /** Server → the joining client: `WelcomeMessage`. */
  welcome: "welcome",
  /** Server → every client while the Room is a Lobby: `LobbyMessage`. */
  lobby: "lobby",
  /** Server → every client after the game starts and after each accepted intent: `GameMessage`. */
  game: "game",
  /** Server → the sender only: `RejectionMessage`. */
  rejected: "rejected",
} as const;

// ---------------------------------------------------------------- intents

/** Intents the Room handles itself, outside the rules engine. */
export type RoomIntent = {
  /** Start the game; any Player may, once every Seat is taken (R5). */
  type: "Start";
};

/** Everything a client may send as an `intent` message. */
export type ClientIntent = RoomIntent | PlayerIntent;

// ---------------------------------------------------------------- server messages

export type WelcomeMessage = {
  /** The receiving client's own public Player id. */
  playerId: PlayerId;
};

export type LobbySeat = { playerId: PlayerId; name: PlayerName };

export type LobbyMessage = {
  code: string;
  /** `null`: the creator left it empty, and the client shows a generated one. */
  roomName: string | null;
  hasPassword: boolean;
  settings: RoomSettings;
  /** Taken Seats in join order; the rest of `settings.maxPlayers` are open. */
  seats: LobbySeat[];
};

export type GameMessage = {
  view: PublicView;
  /** What this push's intent did, in order, for the Board to animate. */
  events: GameEvent[];
  /**
   * The server's clock when it sent this push (epoch ms), so clients can show
   * the Turn timer without trusting their own clock.
   */
  now: number;
};

export type RejectionMessage = { code: RejectionCode };

// ---------------------------------------------------------------- Room options

export const PLAYER_COUNTS = [2, 3, 4] as const;
export const MINUTE_LIMITS = [15, 30, 50] as const;

export type RoomSettings = {
  maxPlayers: (typeof PLAYER_COUNTS)[number];
  minuteLimit: (typeof MINUTE_LIMITS)[number];
};

export const DEFAULT_SETTINGS: RoomSettings = { maxPlayers: 4, minuteLimit: 50 };

/** A password is at most this many UTF-8 bytes. */
export const PASSWORD_MAX_BYTES = 64;

/** The length of `text` in UTF-8 bytes (a lone surrogate counts as U+FFFD, as `TextEncoder` does). */
export function utf8Length(text: string): number {
  let bytes = 0;
  for (const char of text) {
    const point = char.codePointAt(0) ?? 0;
    bytes += point < 0x80 ? 1 : point < 0x800 ? 2 : point < 0x10000 ? 3 : 4;
  }
  return bytes;
}

/**
 * Options for `client.create(GAME_ROOM, options)`; missing settings take the
 * defaults. An empty Room name gets a generated one; an empty password means
 * none. Settings are fixed at creation (R1, R3, R11).
 */
export type CreateOptions = Partial<RoomSettings> & { roomName?: string; password?: string };

/**
 * Options for `client.joinById(code, options)`. The Room code is repeated
 * here because the password is checked before a Seat is reserved, where the
 * server does not yet know which Room is meant. Guest token (#35) lands here.
 */
export type JoinOptions = { code: string; password?: string };

/** One Lobby on the Lobby list: the LobbyRoom listing's `metadata`. Never a password or hash. */
export type LobbyListingMetadata = {
  /** `null`: the client shows a generated one. */
  roomName: string | null;
  /** Taken Seats. */
  players: number;
  maxPlayers: RoomSettings["maxPlayers"];
  minuteLimit: RoomSettings["minuteLimit"];
  hasPassword: boolean;
};

/** A Lobby on the Lobby list. */
export type LobbyListing = LobbyListingMetadata & { code: string };

// ---------------------------------------------------------------- Rejections

/**
 * The closed list of Rejection codes. It must hold every rules-engine code
 * (checked below at compile time); the web app has a hu/en/de message for each.
 */
export const REJECTION_CODES = [
  // rules engine
  "STALE_TURN",
  "NOT_YOUR_TURN",
  "NOT_OFFERED",
  "SHORTFALL_NOT_COVERED",
  // Room server
  "MALFORMED",
  "INTERNAL",
  "ROOM_NOT_FOUND",
  "ROOM_FULL",
  "ROOM_NAME_INVALID",
  "WRONG_PASSWORD",
] as const;

export type RejectionCode = (typeof REJECTION_CODES)[number];

/** Fails to compile unless `T` is `true`. */
export type Assert<T extends true> = T;

/** Compile-time check: every rules Rejection code is in `REJECTION_CODES`. */
export type RulesCodesAreListed = Assert<
  [RulesRejectionCode] extends [RejectionCode] ? true : false
>;

/** Colyseus's matchmaker error for a Room code it does not know, or a Room it has locked (started). */
export const MATCHMAKE_INVALID_ROOM_ID = 522;

/**
 * The Rejection code of a failed create or join (`MatchMakeError`). The Room
 * server throws its matchmaking errors with a Rejection code as the message;
 * Colyseus's own "no such Room" becomes `ROOM_NOT_FOUND`; anything else is
 * `INTERNAL`.
 */
export function matchmakeRejection(error: { code: number; message: string }): RejectionCode {
  const code = REJECTION_CODES.find((c) => c === error.message);
  if (code) return code;
  return error.code === MATCHMAKE_INVALID_ROOM_ID ? "ROOM_NOT_FOUND" : "INTERNAL";
}
