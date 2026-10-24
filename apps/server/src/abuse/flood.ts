/**
 * Intent flood control for one connection (spec: Abuse protection →
 * Intents): above `intentsPerSecond` the extras are dropped, the first of a
 * flood with a warning (`SLOW_DOWN`); the socket is closed only after
 * `intentFloodCloseSeconds` in a row over the limit, or more than
 * `intentBurstClose` in one second.
 */
import type { Limits } from "#limits.ts";

/**
 * `accept`: handle the intent. `warn`: drop it and send `SLOW_DOWN`.
 * `drop`: drop it silently. `close`: close the socket (the Seat is kept).
 */
export type FloodVerdict = "accept" | "warn" | "drop" | "close";

type FloodLimits = Pick<
  Limits,
  "intentsPerSecond" | "intentFloodCloseSeconds" | "intentBurstClose"
>;

const SECOND = 1000;

export class FloodMeter {
  readonly #limits: FloodLimits;
  /** The current one-second window: when it started and how many intents it holds. */
  #windowStart = Number.NEGATIVE_INFINITY;
  #count = 0;
  /** When the current flood (windows over the limit, back to back) began; `null`: no flood. */
  #floodStart: number | null = null;
  #warned = false;

  constructor(limits: FloodLimits) {
    this.#limits = limits;
  }

  /** Counts one intent received at `now` (ms) and says what to do with it. */
  record(now: number): FloodVerdict {
    if (now >= this.#windowStart + SECOND) {
      const previousOver = this.#count > this.#limits.intentsPerSecond;
      const adjacent = now < this.#windowStart + 2 * SECOND;
      if (!previousOver || !adjacent) {
        this.#floodStart = null;
        this.#warned = false;
      }
      this.#windowStart = now;
      this.#count = 0;
    }
    this.#count += 1;
    if (this.#count > this.#limits.intentBurstClose) return "close";
    if (this.#count <= this.#limits.intentsPerSecond) return "accept";
    this.#floodStart ??= now;
    if (now - this.#floodStart >= this.#limits.intentFloodCloseSeconds * SECOND) return "close";
    if (this.#warned) return "drop";
    this.#warned = true;
    return "warn";
  }
}
