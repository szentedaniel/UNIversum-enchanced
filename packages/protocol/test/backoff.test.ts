import { describe, expect, it } from "vitest";
import { backoffDelay, RECONNECT } from "#messages.ts";

describe("the shared reconnect back-off", () => {
  it("waits half of the exponential base without jitter", () => {
    expect(backoffDelay(1, 100, 5_000, () => 0)).toBe(50);
    expect(backoffDelay(2, 100, 5_000, () => 0)).toBe(100);
    expect(backoffDelay(3, 500, 10_000, () => 0)).toBe(1_000);
  });

  it("adds up to the other half with jitter", () => {
    expect(backoffDelay(1, 100, 5_000, () => 1)).toBe(100);
    expect(backoffDelay(3, 500, 10_000, () => 1)).toBe(2_000);
  });

  it("doubles from the base up to the cap", () => {
    expect(
      [1, 2, 3, 4, 5, 6, 7].map((attempt) => backoffDelay(attempt, 500, 10_000, () => 1)),
    ).toEqual([500, 1_000, 2_000, 4_000, 8_000, 10_000, 10_000]);
  });

  it("caps the exponential at the maximum", () => {
    expect(backoffDelay(20, 500, 10_000, () => 0)).toBe(5_000);
    expect(backoffDelay(20, 500, 10_000, () => 1)).toBe(10_000);
  });

  it("treats attempts below 1 as the first attempt", () => {
    expect(backoffDelay(0, 100, 5_000, () => 0)).toBe(50);
  });

  it("holds the real client's policy: 8 SDK retries, then Guest-token rejoins", () => {
    expect(RECONNECT.sdkRetries).toBe(8);
    expect(RECONNECT.sdk).toEqual({ baseMs: 100, maxMs: 5_000 });
    expect(RECONNECT.guest).toEqual({ baseMs: 500, maxMs: 10_000 });
    expect(RECONNECT.notFoundTries).toBe(5);
  });
});
