import { describe, expect, it } from "vitest";
import { loadConfig, timingIgnored } from "#config.ts";

// The test-only clock overrides exist for e2e runs. A production server must
// use the rules constants: stored turn deadlines are compared with them.
describe("the clock overrides", () => {
  it("shorter Turns and minutes are used outside production", () => {
    const config = loadConfig({
      GAME_TURN_LIMIT_MS: "8000",
      GAME_MINUTE_MS: "8000",
    });

    expect(config.timing).toEqual({ turnLimitMs: 8_000, minuteMs: 8_000 });
  });

  it("are ignored in production", () => {
    const config = loadConfig({
      NODE_ENV: "production",
      GAME_TURN_LIMIT_MS: "8000",
      GAME_MINUTE_MS: "8000",
    });

    expect(config.timing).toEqual({});
  });

  it("still fail loudly when malformed outside production", () => {
    expect(() => loadConfig({ GAME_TURN_LIMIT_MS: "soon" })).toThrow(
      /GAME_TURN_LIMIT_MS must be a whole number of milliseconds/,
    );
  });

  it("are flagged for the boot warning only in production", () => {
    expect(timingIgnored({ GAME_TURN_LIMIT_MS: "8000" })).toBe(false);
    expect(timingIgnored({ NODE_ENV: "production" })).toBe(false);
    expect(timingIgnored({ NODE_ENV: "production", GAME_MINUTE_MS: "8000" })).toBe(true);
  });
});
