import { describe, expect, it } from "vitest";
import { claimRoomCode, releaseRoomCode, reserveRoomCode } from "#room/room-code.ts";

describe("Room codes", () => {
  it("R4: never hands out a code that is still stored", () => {
    const stored = new Set<string>();
    // The first 50 codes drawn are "still stored"; the next one is free.
    const code = reserveRoomCode((candidate) => {
      if (stored.size >= 50) return false;
      stored.add(candidate);
      return true;
    });

    expect(code).toMatch(/^[1-9]\d{5}$/);
    expect(stored.has(code)).toBe(false);
    releaseRoomCode(code);
  });

  it("a restored Room's code can't be claimed twice while it lives", () => {
    const code = reserveRoomCode();
    releaseRoomCode(code);
    claimRoomCode(code);

    expect(() => claimRoomCode(code)).toThrow(/already live/);
    releaseRoomCode(code);
  });
});
