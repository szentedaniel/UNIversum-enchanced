import { describe, expect, it } from "vitest";
import { loadConfig, timingIgnored } from "#config.ts";

// The test-only clock overrides exist for e2e runs. A production server must
// use the rules constants: stored turn deadlines are compared with them.
describe("the clock overrides", () => {
  it("shorter Turns, minutes and a fixed seed are used outside production", () => {
    const config = loadConfig({
      GAME_TURN_LIMIT_MS: "8000",
      GAME_MINUTE_MS: "8000",
      GAME_SEED: "1, 2, 3, 4",
    });

    expect(config.timing).toEqual({
      turnLimitMs: 8_000,
      minuteMs: 8_000,
      seed: [1, 2, 3, 4],
    });
  });

  it("are ignored in production", () => {
    const config = loadConfig({
      NODE_ENV: "production",
      GAME_TURN_LIMIT_MS: "8000",
      GAME_MINUTE_MS: "8000",
      GAME_SEED: "1,2,3,4",
    });

    expect(config.timing).toEqual({});
  });

  it("still fail loudly when malformed outside production", () => {
    expect(() => loadConfig({ GAME_TURN_LIMIT_MS: "soon" })).toThrow(
      /GAME_TURN_LIMIT_MS must be a whole number of milliseconds/,
    );
    expect(() => loadConfig({ GAME_SEED: "1,2,3" })).toThrow(
      /GAME_SEED must be four comma-separated 32-bit integers/,
    );
    expect(() => loadConfig({ GAME_SEED: "0,0,0,0" })).toThrow(
      /GAME_SEED must be four comma-separated 32-bit integers, not all zero/,
    );
    expect(() => loadConfig({ GAME_SEED: "1,2,3,4294967296" })).toThrow(
      /GAME_SEED must be four comma-separated 32-bit integers/,
    );
  });

  it("are flagged for the boot warning only in production", () => {
    expect(timingIgnored({ GAME_TURN_LIMIT_MS: "8000" })).toBe(false);
    expect(timingIgnored({ NODE_ENV: "production" })).toBe(false);
    expect(timingIgnored({ NODE_ENV: "production", GAME_MINUTE_MS: "8000" })).toBe(true);
    expect(timingIgnored({ NODE_ENV: "production", GAME_SEED: "1,2,3,4" })).toBe(true);
  });
});
