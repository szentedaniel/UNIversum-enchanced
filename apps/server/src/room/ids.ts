import type { Seed } from "@universum/rules";
import { getRandomValues, randomBytes } from "node:crypto";

/** A new public Player id: what other Players see instead of any secret. */
export function newPlayerId(): string {
  return randomBytes(9).toString("base64url");
}

/** A PRNG seed for a new game, from the CSPRNG (never all zero). */
export function newSeed(): Seed {
  for (;;) {
    const [a = 0, b = 0, c = 0, d = 0] = getRandomValues(new Int32Array(4));
    if (a || b || c || d) return [a, b, c, d];
  }
}
