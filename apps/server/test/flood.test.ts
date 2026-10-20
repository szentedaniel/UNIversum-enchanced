import { describe, expect, it } from "vitest";
import { FloodMeter, type FloodVerdict } from "#abuse/flood.ts";

const LIMITS = { intentsPerSecond: 10, intentFloodCloseSeconds: 5, intentBurstClose: 50 };

/** Sends `count` intents evenly spread over one second from `start`; returns the verdicts. */
function second(meter: FloodMeter, start: number, count: number): FloodVerdict[] {
  return Array.from({ length: count }, (_, i) =>
    meter.record(start + Math.floor((i * 1000) / count)),
  );
}

function tally(verdicts: FloodVerdict[]): Partial<Record<FloodVerdict, number>> {
  const counts: Partial<Record<FloodVerdict, number>> = {};
  for (const verdict of verdicts) counts[verdict] = (counts[verdict] ?? 0) + 1;
  return counts;
}

describe("FloodMeter", () => {
  it("accepts up to the limit every second, for as long as it lasts", () => {
    const meter = new FloodMeter(LIMITS);
    for (let s = 0; s < 20; s++) {
      expect(tally(second(meter, s * 1000, 10))).toEqual({ accept: 10 });
    }
  });

  it("drops the extras with a single warning", () => {
    const meter = new FloodMeter(LIMITS);

    expect(second(meter, 0, 25)).toEqual([
      ...Array<FloodVerdict>(10).fill("accept"),
      "warn",
      ...Array<FloodVerdict>(14).fill("drop"),
    ]);
  });

  it("does not warn again while the flood goes on, and warns anew after a calm second", () => {
    const meter = new FloodMeter(LIMITS);
    second(meter, 0, 20);

    expect(tally(second(meter, 1000, 20))).toEqual({ accept: 10, drop: 10 });
    expect(tally(second(meter, 2000, 5))).toEqual({ accept: 5 });
    expect(tally(second(meter, 3000, 20))).toEqual({ accept: 10, warn: 1, drop: 9 });
  });

  it("closes after 5 seconds in a row over the limit", () => {
    const meter = new FloodMeter(LIMITS);
    for (let s = 0; s < 5; s++) {
      expect(second(meter, s * 1000, 20)).not.toContain("close");
    }

    expect(second(meter, 5000, 20)).toContain("close");
  });

  it("forgives a flood that pauses before 5 seconds", () => {
    const meter = new FloodMeter(LIMITS);
    for (let s = 0; s < 4; s++) second(meter, s * 1000, 20);
    second(meter, 4000, 3);
    for (let s = 5; s < 9; s++) {
      expect(second(meter, s * 1000, 20)).not.toContain("close");
    }
  });

  it("forgives a flood followed by silence", () => {
    const meter = new FloodMeter(LIMITS);
    for (let s = 0; s < 4; s++) second(meter, s * 1000, 20);
    for (let s = 10; s < 14; s++) {
      expect(second(meter, s * 1000, 20)).not.toContain("close");
    }
  });

  it("closes at once above 50 in one second", () => {
    const meter = new FloodMeter(LIMITS);
    const verdicts = second(meter, 0, 51);

    expect(verdicts.slice(0, 50)).not.toContain("close");
    expect(verdicts[50]).toBe("close");
  });
});
