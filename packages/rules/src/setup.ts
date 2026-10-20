import { FIELDS } from "#board.ts";
import { MINUTE_MS, START_CASH, turnDeadlineFrom } from "#constants.ts";
import { rngFromSeed } from "#rng.ts";
import { awaitingRoll } from "#rules/turn.ts";
import { STATE_VERSION, type GameState, type Seat, type Seed, type Settings } from "#state.ts";

export type SetupInput = {
  /** Taken Seats in join order (R6). */
  seats: readonly Seat[];
  settings: Settings;
  /** PRNG seed words; the host draws them from `node:crypto`. */
  seed: Seed;
  /** The server's clock when the game starts. */
  now: number;
};

/** Builds the state of a game that has just started (R6–R9, R11). */
export function setupGame({ seats, settings, seed, now }: SetupInput): GameState {
  const first = seats[0];
  if (!first || seats.length < 2 || seats.length > 4) {
    throw new Error(`a game needs 2–4 Seats, got ${seats.length}`);
  }
  return {
    stateVersion: STATE_VERSION,
    version: 0,
    turn: 1,
    currentPlayer: first.playerId,
    phase: awaitingRoll(),
    turnDeadline: turnDeadlineFrom(now),
    settings: { maxPlayers: settings.maxPlayers, minuteLimit: settings.minuteLimit },
    endsAt: now + settings.minuteLimit * MINUTE_MS,
    players: seats.map((seat, index) => ({
      id: seat.playerId,
      name: { adjective: seat.name.adjective, noun: seat.name.noun },
      seat: index,
      cash: START_CASH,
      position: 0,
      bankrupt: false,
      quarantineRounds: null,
      hasPcrTest: false,
    })),
    fields: FIELDS.map(() => ({ owner: null, level: 0 })),
    doubler: null,
    rng: rngFromSeed(seed),
  };
}
