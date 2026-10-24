/**
 * The generated run profile (spec: Load test): which Room starts when, with
 * or without a password, when its three Guests arrive, and each game's
 * Planned drops. Everything comes from a seed, so a run can be reproduced.
 */
import type { KneeProfile, LoadProfile } from "#config.ts";

/** A deterministic `[0, 1)` PRNG (mulberry32), seeded per Room or game. */
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

const between = (random: () => number, [low, high]: readonly [number, number]): number =>
  low + Math.floor(random() * (high - low + 1));

export type RoomPlan = {
  /** 0-based position in the ramp; also part of the game's seed. */
  index: number;
  /** When the creator makes the Room, from run start. */
  startAtMs: number;
  password: boolean;
  /** The delays of the Room's other Guests, each from its creator's arrival. */
  joinDelaysMs: number[];
};

export type DropPlan = {
  /** 0-based Player index within the Room (0 is the creator). */
  player: number;
  /** When in the game the connection drops. */
  atMs: number;
  /** How long the Player stays away. */
  returnMs: number;
  /** Over a minute away: the return goes by Guest token, not `reconnectionToken`. */
  long: boolean;
};

/** A run's length from the first Room to the end of the hold. */
export function runSeconds(profile: LoadProfile): number {
  return profile.rampSeconds + profile.holdSeconds;
}

/** The whole ramp, one plan per Room, starting at 0 and ending at the ramp length. */
export function roomPlans(profile: LoadProfile): RoomPlan[] {
  const rampMs = profile.rampSeconds * 1_000;
  const players = profile.playersPerRoom;
  return Array.from({ length: profile.rooms }, (_, index) => {
    const random = seededRandom(mix(profile.seed, index, 0));
    const password = random() < profile.passwordRoomRate;
    const joinDelaysMs = Array.from({ length: players - 1 }, () =>
      between(random, profile.joinDelayMs),
    );
    const startAtMs = profile.rooms === 1 ? 0 : Math.round((index / (profile.rooms - 1)) * rampMs);
    return { index, startAtMs, password, joinDelaysMs };
  });
}

/**
 * `--find-knee`: Rooms start at 100/min from the first second, capped at
 * `maxRooms`. The runner stops the run when a threshold breaks.
 */
export function kneeRoomPlans(knee: KneeProfile): RoomPlan[] {
  const perMs = 60_000 / knee.roomsPerMinute;
  return Array.from({ length: knee.maxRooms }, (_, index) => ({
    index,
    startAtMs: Math.round(index * perMs),
    password: false,
    joinDelaysMs: [5_000, 5_000, 5_000],
  }));
}

/**
 * One game's drops: each Player independently has `dropRate` chance of one
 * drop, placed so they are back well before the Minute limit ends the game.
 */
export function dropPlanForGame(random: () => number, profile: LoadProfile): DropPlan[] {
  const gameMs = profile.minuteLimit * 60_000;
  const drops: DropPlan[] = [];
  for (let player = 0; player < profile.playersPerRoom; player++) {
    if (random() >= profile.dropRate) continue;
    const long = random() < profile.longReturnRate;
    const returnMs = between(random, long ? profile.longReturnMs : profile.shortReturnMs);
    // 30 s of play still happen after the Player is back.
    const latest = gameMs - returnMs - 30_000;
    const atMs = Math.min(latest, between(random, profile.dropWindowMs));
    drops.push({ player, atMs, returnMs, long });
  }
  return drops;
}

/** A seed for Room `index`'s game `game` (0 is the first game the Room plays). */
export function gameSeed(seed: number, index: number, game: number): number {
  return mix(seed, index, game);
}

function mix(seed: number, index: number, game: number): number {
  let h = (seed ^ 0x9e37_79b9) >>> 0;
  h = Math.imul(h ^ (index + 0x85eb_ca6b), 0xc2b2_ae35) >>> 0;
  h = Math.imul(h ^ (game + 0x27d4_eb2f), 0x1656_67b1) >>> 0;
  return h >>> 0;
}
