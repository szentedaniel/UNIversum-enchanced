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

/** Options for `client.create(GAME_ROOM, options)`; missing settings take the defaults. */
export type CreateOptions = Partial<RoomSettings>;

/** Options for `client.joinById(code, options)`. Guest token (#35) and password (#36) land here. */
export type JoinOptions = Record<string, never>;

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
  // Room server
  "MALFORMED",
  "INTERNAL",
  "ROOM_NOT_FOUND",
] as const;

export type RejectionCode = (typeof REJECTION_CODES)[number];

/** Fails to compile unless `T` is `true`. */
export type Assert<T extends true> = T;

/** Compile-time check: every rules Rejection code is in `REJECTION_CODES`. */
export type RulesCodesAreListed = Assert<
  [RulesRejectionCode] extends [RejectionCode] ? true : false
>;
