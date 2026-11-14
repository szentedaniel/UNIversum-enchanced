import type { LobbySeat, RoomSettings } from "@universum/protocol";
import type { GameEvent, GameState } from "@universum/rules";

/** A password hash as stored: never the password itself. */
export type StoredPassword = { salt: string; hash: string };

/**
 * A taken Seat as stored. `tokenHash`: the hash of its Guest's token, so the
 * Guest can take the Seat back after a restart; `null` (or missing, in Rooms
 * stored before Guest tokens) when the Guest sent none.
 */
export type StoredSeat = LobbySeat & { tokenHash?: string | null };

/**
 * One Room as the store keeps it (one row per Room). The snapshot is the
 * source of truth: a restored Room is rebuilt from it alone.
 *
 * `game` is typed `G`: `GameState` when saving, `unknown` when loading,
 * because a stored state may be from an older `stateVersion` and goes through
 * the engine's `migrate` before the Room uses it.
 */
export type StoredRoom<G = GameState> = {
  /** The Room code (R4), kept across restarts. */
  code: string;
  settings: RoomSettings;
  /** The checked Room name, or `null` when its creator left it empty. */
  roomName: string | null;
  /** The creator's public Player id (the Seat with the crown), or `null` if they never joined. */
  creatorId: string | null;
  /** The Room password's salt and scrypt hash (base64), or `null` for a Room without one. */
  password: StoredPassword | null;
  /** Taken Seats in join order. */
  seats: StoredSeat[];
  /** The running game, or `null` while the Room is a Lobby. */
  game: G | null;
  /** When the game ended (epoch ms), or `null` while it is unfinished. */
  endedAt: number | null;
};

/**
 * Where Rooms live between restarts (spec: RoomStore). SQLite now; Postgres
 * can sit behind the same interface for the 10× step (it would need these
 * calls to become async, and the Room to queue intents while a write is out).
 */
export interface RoomStore {
  /** Every Room whose game has not ended, Lobbies included, for restore on boot. */
  unfinished(): StoredRoom<unknown>[];
  /**
   * Every ended Room still stored, with its snapshot, for restore on boot: its
   * Podium offers the rematch again after a restart (spec #175, decision 6).
   * Retention still deletes it `RETENTION_MS` after `endedAt`.
   */
  ended(): StoredRoom<unknown>[];
  /**
   * Saves the Room's snapshot and appends the events of the intent that led
   * to it, in one transaction: both are written or neither is (then it throws).
   */
  save(room: StoredRoom, events: readonly GameEvent[]): void;
  /** Whether a Room under `code` is still stored; such a code is never reissued. */
  isCodeInUse(code: string): boolean;
  /** Deletes the Room and its events. */
  delete(code: string): void;
  /** The event log of one Room, oldest first (debugging and replay fixtures). */
  events(code: string): { version: number; events: GameEvent[] }[];
  close(): void;
}
