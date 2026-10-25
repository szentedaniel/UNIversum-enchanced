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
  type FieldId,
  type FieldState,
  type GameState,
  type Intent,
  type PlayerId,
  type PlayerState,
  type PlayerView,
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

/** The current phase's deadline; a game that has ended has none. */
export function deadlineOf(state: GameState): number {
  if (state.turnDeadline === null) throw new Error("the game has no deadline");
  return state.turnDeadline;
}

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

/** The earliest moment a Player intent may be applied: the end of the last Playback. */
const readyAt = (state: GameState): number => Math.max(T0, state.actsAfter);

/**
 * Applies an intent that must be accepted, and returns the new state and its
 * events. The default `now` is when the last Playback ended, so a test that
 * does not care about the clock acts as soon as the engine allows it.
 */
export function accept(
  state: GameState,
  intent: Intent,
  actor: Actor,
  now = readyAt(state),
): Applied {
  const result = apply(state, intent, { actor, now });
  if ("code" in result)
    throw new Error(`expected ${intent.type} to be accepted, got ${result.code}`);
  return result;
}

/** Applies an intent that must be rejected, and returns the Rejection. */
export function reject(
  state: GameState,
  intent: Intent,
  actor: Actor,
  now = readyAt(state),
): Rejection {
  const result = apply(state, intent, { actor, now });
  if (!("code" in result)) throw new Error(`expected ${intent.type} to be rejected`);
  return result;
}

/** The current Player rolls; the intent carries the current Turn number. */
export function roll(state: GameState, now = readyAt(state)): Applied {
  return accept(state, { type: "Roll", turn: state.turn }, state.currentPlayer, now);
}

/**
 * The current Player throws the dice the phase offers: the plain roll, or the
 * roll for 12 on the Quarantine choice. For tests that play many Turns.
 */
export function rollOffered(state: GameState, now = readyAt(state)): Applied {
  const type = state.phase.kind === "quarantineChoice" ? "RollForTwelve" : "Roll";
  return accept(state, { type, turn: state.turn }, state.currentPlayer, now);
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

/** One Player's entry in a reveal, or in any view's `players`, by id. */
export function playerOf(view: { players: readonly PlayerView[] }, playerId: PlayerId): PlayerView {
  const found = view.players.find((p) => p.id === playerId);
  if (!found) throw new Error(`no Player ${playerId} in the view`);
  return found;
}

/** The two dice of the `DiceRolled` event in an event list. */
export function diceOf(applied: Applied): readonly [number, number] {
  const rolled = applied.events.find((e) => e.type === "DiceRolled");
  if (!rolled) throw new Error("no DiceRolled event");
  return rolled.dice;
}

/**
 * The current Player rolls and lands on `field`: they are first placed the
 * dice's sum before it (the dice depend only on the PRNG state, not on where
 * the Player stands). A start before Start makes the move pay the Round bonus.
 */
export function rollOnto(state: GameState, field: FieldId, now = readyAt(state)): Applied {
  const [a, b] = diceOf(roll(state, now));
  const position = (field - (a + b) + 32) % 32;
  return roll(withPlayer(state, state.currentPlayer, { position }), now);
}

/** Returns a copy of `state` with one Field's state replaced. */
export function withField(state: GameState, field: FieldId, patch: Partial<FieldState>): GameState {
  return {
    ...state,
    fields: state.fields.map((f, id) => (id === field ? { ...f, ...patch } : f)),
  };
}

/**
 * A whole Turn without buying: the current Player rolls, then turns down every
 * offer or pick the landing leads to, so the Turn passes. Returns the roll's
 * own result and the state after the Turn.
 */
export function playTurn(
  state: GameState,
  now = readyAt(state),
): { rolled: Applied; state: GameState } {
  const rolled = rollOffered(state, now);
  let current = rolled;
  // Each decision opens only when the previous Playback ends (ADR-0004).
  let at = current.state.actsAfter;
  // A landing can lead through more than one decision (Erasmus travel, then the offer).
  for (let guard = 0; guard < 10; guard++) {
    const { phase, turn, currentPlayer } = current.state;
    if (phase.kind === "offer") {
      current = accept(current.state, { type: "DeclineOffer", turn }, currentPlayer, at);
      at = current.state.actsAfter;
      continue;
    }
    if (phase.kind === "placingDoubler") {
      const field = phase.fields[0];
      if (field === undefined) return { rolled, state: current.state };
      current = accept(current.state, { type: "PlaceDoubler", turn, field }, currentPlayer, at);
      at = current.state.actsAfter;
      continue;
    }
    if (phase.kind === "choosingErasmus") {
      const field = phase.fields[0];
      if (field === undefined) return { rolled, state: current.state };
      current = accept(current.state, { type: "TravelErasmus", turn, field }, currentPlayer, at);
      at = current.state.actsAfter;
      continue;
    }
    return { rolled, state: current.state };
  }
  return { rolled, state: current.state };
}
