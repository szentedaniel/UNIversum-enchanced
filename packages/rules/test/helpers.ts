/**
 * Test helpers for rule tests. They drive the engine only through its public
 * interface (`setupGame`, `apply`, `publicView`) and build states as plain JSON,
 * the same way the Room server would hand them in.
 */
import { expect } from "vitest";
import {
  apply,
  setupGame,
  type Actor,
  type Applied,
  type GameState,
  type Intent,
  type PlayerId,
  type PlayerState,
  type Rejection,
  type Seat,
  type Seed,
  type Settings,
} from "#index.ts";

/** A fixed server clock for tests: 2026-10-19 12:00:00 UTC. */
export const T0 = Date.UTC(2026, 9, 19, 12, 0, 0);

export const SEED: Seed = [0x1234_5678, -0x2345_6789, 0x0bad_f00d, 0x7777_1111];

/** `n` Seats in join order, with public Player ids "p1", "p2", … */
export function seats(n: number): Seat[] {
  return Array.from({ length: n }, (_, i) => ({
    playerId: `p${i + 1}`,
    name: { adjective: `adj${i}`, noun: `noun${i}` },
  }));
}

export type GameOptions = {
  players?: number;
  settings?: Partial<Settings>;
  seed?: Seed;
  now?: number;
};

/** A freshly started game with default settings (4 Players, 50-minute Minute limit). */
export function newGame(options: GameOptions = {}): GameState {
  const players = options.players ?? options.settings?.maxPlayers ?? 4;
  return setupGame({
    seats: seats(players),
    settings: { maxPlayers: 4, minuteLimit: 50, ...options.settings },
    seed: options.seed ?? SEED,
    now: options.now ?? T0,
  });
}

/** Applies an intent that must be accepted, and returns the new state and its events. */
export function accept(state: GameState, intent: Intent, actor: Actor, now = T0): Applied {
  const result = apply(state, intent, { actor, now });
  if ("code" in result)
    throw new Error(`expected ${intent.type} to be accepted, got ${result.code}`);
  return result;
}

/** Applies an intent that must be rejected, and returns the Rejection. */
export function reject(state: GameState, intent: Intent, actor: Actor, now = T0): Rejection {
  const result = apply(state, intent, { actor, now });
  if (!("code" in result)) throw new Error(`expected ${intent.type} to be rejected`);
  return result;
}

/** The current Player rolls; the intent carries the current Turn number. */
export function roll(state: GameState, now = T0): Applied {
  return accept(state, { type: "Roll", turn: state.turn }, state.currentPlayer, now);
}

/** Returns a copy of `state` with one Player's fields replaced. */
export function withPlayer(
  state: GameState,
  playerId: PlayerId,
  patch: Partial<PlayerState>,
): GameState {
  expect(state.players.some((p) => p.id === playerId)).toBe(true);
  return {
    ...state,
    players: state.players.map((p) => (p.id === playerId ? { ...p, ...patch } : p)),
  };
}

export function player(state: GameState, playerId: PlayerId): PlayerState {
  const found = state.players.find((p) => p.id === playerId);
  if (!found) throw new Error(`no Player ${playerId}`);
  return found;
}

/** The two dice of the `DiceRolled` event in an event list. */
export function diceOf(applied: Applied): readonly [number, number] {
  const rolled = applied.events.find((e) => e.type === "DiceRolled");
  if (!rolled) throw new Error("no DiceRolled event");
  return rolled.dice;
}
