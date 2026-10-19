/**
 * The game state: one JSON-serialisable object (ADR-0003). The Room server
 * stores it after every accepted intent and restores it after a restart, so it
 * holds only plain data: no classes, Maps, functions or `undefined`.
 *
 * Bump `STATE_VERSION` whenever the shape changes, and ship a migration.
 */
import type { FieldId } from "#board.ts";

/** The version of the state's shape (not the per-intent `version`). */
export const STATE_VERSION = 1;

/** A Player's public id: what every client sees instead of a Guest token. */
export type PlayerId = string;

/**
 * A Player name, as word ids. The server picks the words; every client shows
 * them in its own language from its message files.
 */
export type PlayerName = { adjective: string; noun: string };

/** A taken Seat, in join order, as the Room hands it to `setupGame`. */
export type Seat = { playerId: PlayerId; name: PlayerName };

/** The Room settings the game needs. */
export type Settings = {
  maxPlayers: 2 | 3 | 4;
  /** Minutes. */
  minuteLimit: 15 | 30 | 50;
};

/** The four 32-bit words of the PRNG state (pure-rand `xoroshiro128plus`). */
export type Seed = readonly [number, number, number, number];

export type PlayerState = {
  id: PlayerId;
  name: PlayerName;
  /** Seat index in join order, 0–3; also the Player colour. */
  seat: number;
  cash: number;
  /** The Field the Player stands on. */
  position: FieldId;
  bankrupt: boolean;
};

export type FieldState = {
  owner: PlayerId | null;
  /** 0 = unbuilt (or not a University/Museum). */
  level: number;
};

export type DoublerState = { field: FieldId; count: number };

/**
 * Phases, by `kind`. The map is open: each rule area adds its own phases with
 * declaration merging, next to its intent handlers:
 *
 * ```ts
 * declare module "#state.ts" {
 *   interface PhaseMap {
 *     offer: { levels: number[]; buyout: number | null };
 *   }
 * }
 * ```
 *
 * A decision phase lists its legal options, so clients hold no rule logic.
 */
export interface PhaseMap {}

export type PhaseKind = keyof PhaseMap;

/** The flat phase union, built from `PhaseMap`: `{ kind: K } & PhaseMap[K]`. */
export type Phase = { [K in PhaseKind]: { kind: K } & PhaseMap[K] }[PhaseKind];

export type PhaseOf<K extends PhaseKind> = Extract<Phase, { kind: K }>;

export type GameState = {
  stateVersion: number;
  /** Bumped on every accepted intent. */
  version: number;
  /** The Turn number, from 1; every intent carries it. */
  turn: number;
  currentPlayer: PlayerId;
  phase: Phase;
  settings: Settings;
  /** When the Minute limit runs out (epoch ms); checked at each Turn change. */
  endsAt: number;
  /** Players in Seat order. */
  players: PlayerState[];
  /** Per-Field state, indexed by Field id. */
  fields: FieldState[];
  /** The one Doubler token, or `null` before anyone places it. */
  doubler: DoublerState | null;
  /** The PRNG state. Never sent to clients (see `publicView`). */
  rng: number[];
};
