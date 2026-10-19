/**
 * The seeded PRNG (pure-rand `xoroshiro128plus`). Its state lives in the game
 * state, so a restored Room continues the same sequence. Every die and Chance
 * draw comes from here; the engine never calls `Math.random`.
 */
import { uniformInt } from "pure-rand/distribution/uniformInt";
import { xoroshiro128plusFromState } from "pure-rand/generator/xoroshiro128plus";
import type { Seed } from "#state.ts";
import type { Tx } from "#tx.ts";

/** The PRNG state for a new game. The host seeds it from `node:crypto`. */
export function rngFromSeed(seed: Seed): number[] {
  if (seed.length !== 4 || seed.every((word) => word === 0)) {
    throw new Error("the seed must be four 32-bit words, not all zero");
  }
  return [...xoroshiro128plusFromState(seed).getState()];
}

/** A uniform integer in `[from, to]`, advancing the PRNG in `tx.state`. */
export function randomInt(tx: Tx, from: number, to: number): number {
  const rng = xoroshiro128plusFromState(tx.state.rng);
  const value = uniformInt(rng, from, to);
  tx.state.rng = [...rng.getState()];
  return value;
}
