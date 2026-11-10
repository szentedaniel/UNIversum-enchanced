import { FIELDS } from "#board.ts";
import { MINUTE_MS, turnDeadlineFrom } from "#constants.ts";
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
  /** A shorter Turn limit (ms), set by the server for e2e runs. */
  turnLimitMs?: number;
  /** A shorter "minute" (ms) for the Minute limit, set by the server for e2e runs. */
  minuteMs?: number;
};

/** Builds the state of a game that has just started (R6–R9, R11). */
export function setupGame({
  seats,
  settings,
  seed,
  now,
  turnLimitMs,
  minuteMs = MINUTE_MS,
}: SetupInput): GameState {
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
    actsAfter: now,
    turnDeadline: turnDeadlineFrom(now, turnLimitMs),
    settings: {
      maxPlayers: settings.maxPlayers,
      minuteLimit: settings.minuteLimit,
      startingCash: settings.startingCash,
      roundBonus: settings.roundBonus,
    },
    endsAt: now + settings.minuteLimit * minuteMs,
    players: seats.map((seat, index) => ({
      id: seat.playerId,
      name: { adjective: seat.name.adjective, noun: seat.name.noun },
      seat: index,
      bot: seat.bot === true,
      cash: settings.startingCash,
      position: 0,
      bankrupt: false,
      quarantineRounds: null,
      hasPcrTest: false,
    })),
    fields: FIELDS.map(() => ({ owner: null, level: 0 })),
    doubler: null,
    lastChanceCard: null,
    deal: null,
    rng: rngFromSeed(seed),
  };
}
