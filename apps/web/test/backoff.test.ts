import { describe, expect, it } from "vitest";
import { backoffDelay } from "#lib/backoff.ts";

/** The longest wait of each attempt (the jitter at its top). */
const longest = (attempt: number) => backoffDelay(attempt, 500, 10_000, () => 1);

describe("reconnect back-off", () => {
  it("doubles from the base up to the cap", () => {
    expect([1, 2, 3, 4, 5, 6, 7].map(longest)).toEqual([
      500, 1_000, 2_000, 4_000, 8_000, 10_000, 10_000,
    ]);
  });

  it("jitters each wait between half and all of it", () => {
    expect(backoffDelay(3, 500, 10_000, () => 0)).toBe(1_000);
    expect(backoffDelay(3, 500, 10_000, () => 0.5)).toBe(1_500);
  });
});
