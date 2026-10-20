import { describe, expect, it } from "vitest";
import { mergeWorkerStats, peakCpuFraction, percentile, type WorkerStats } from "#stats.ts";

const zeroStats = (): WorkerStats => ({
  rttMs: [],
  intentsSent: 0,
  intentsAccepted: 0,
  rejections: {},
  decisions: 0,
  timeouts: 0,
  drops: 0,
  shortDrops: 0,
  longDrops: 0,
  tokenRejoins: 0,
  guestRejoins: 0,
  failedRejoins: 0,
  seatMismatches: 0,
  versionRegressions: 0,
  unplannedExits: 0,
  roomsStarted: 0,
  gamesFinished: 0,
  roomsAtKill: 0,
  clientsAtKill: 0,
  clientsBackInTime: 0,
  maxRejoinAfterReadyMs: null,
  cpuSamples: [],
  errors: [],
});

describe("percentiles", () => {
  it("is null without samples", () => {
    expect(percentile([], 95)).toBeNull();
  });

  it("uses the nearest rank", () => {
    const samples = Array.from({ length: 100 }, (_, index) => index + 1);
    expect(percentile(samples, 50)).toBe(50);
    expect(percentile(samples, 95)).toBe(95);
    expect(percentile(samples, 99)).toBe(99);
    expect(percentile([4, 1, 3, 2], 100)).toBe(4);
  });
});

describe("merging worker stats", () => {
  it("sums counters and percentiles the round trips", () => {
    const a = { ...zeroStats(), rttMs: [1, 2, 3, 4], intentsSent: 4, rejections: { INTERNAL: 1 } };
    const b = {
      ...zeroStats(),
      rttMs: [100, 200, 300, 400],
      intentsSent: 4,
      rejections: { INTERNAL: 2, SLOW_DOWN: 1 },
    };
    const summary = mergeWorkerStats([a, b], { cpuCount: 8 });
    expect(summary.rttSamples).toBe(8);
    expect(summary.rttP95Ms).toBe(400);
    expect(summary.intentsSent).toBe(8);
    expect(summary.rejections).toEqual({ INTERNAL: 3, SLOW_DOWN: 1 });
    expect(summary.errors).toEqual([]);
  });

  it("counts a late Seat as a failed rejoin", () => {
    const a = {
      ...zeroStats(),
      clientsAtKill: 10,
      clientsBackInTime: 8,
      maxRejoinAfterReadyMs: 90_000,
      failedRejoins: 2,
    };
    const summary = mergeWorkerStats([a], { cpuCount: 8 });
    expect(summary.clientsAtKill).toBe(10);
    expect(summary.clientsBackInTime).toBe(8);
    expect(summary.maxRejoinAfterReadyMs).toBe(90_000);
    expect(summary.failedRejoins).toBe(2);
  });

  it("keeps unique errors and caps them", () => {
    const a = { ...zeroStats(), errors: ["boom", "boom", ...Array(30).fill("x")] };
    const summary = mergeWorkerStats([a], { cpuCount: 1 });
    expect(summary.errors[0]).toBe("boom");
    expect(summary.errors.length).toBeLessThanOrEqual(20);
  });
});

describe("generator CPU", () => {
  it("takes the busiest interval as a share of the machine", () => {
    const samples = [
      { at: 5_000, seconds: 1 },
      { at: 10_000, seconds: 2 },
      { at: 15_000, seconds: 0.5 },
    ];
    expect(peakCpuFraction(samples, 4)).toBe(0.1);
  });

  it("adds every worker's interval together", () => {
    const samples = [
      { at: 5_000, seconds: 1 },
      { at: 5_010, seconds: 1 },
      { at: 10_000, seconds: 0.5 },
      { at: 10_010, seconds: 0.5 },
    ];
    // Two workers consuming 1 CPU-second each over a 5 s interval on 4 cores.
    expect(peakCpuFraction(samples, 4)).toBe(0.1);
  });

  it("is zero without samples", () => {
    expect(peakCpuFraction([], 8)).toBe(0);
  });
});
