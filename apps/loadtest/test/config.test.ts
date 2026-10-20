import { describe, expect, it } from "vitest";
import {
  DEFAULT_PROFILE,
  KNEE_PROFILE,
  THRESHOLDS,
  defaultReportDir,
  resolveEndpoint,
  type LoadProfile,
} from "#config.ts";

describe("the load-test config", () => {
  it("holds the spec's ramp, hold and restart", () => {
    expect(DEFAULT_PROFILE.rooms).toBe(1_000);
    expect(DEFAULT_PROFILE.playersPerRoom).toBe(4);
    expect(DEFAULT_PROFILE.rampSeconds).toBe(10 * 60);
    expect(DEFAULT_PROFILE.holdSeconds).toBe(30 * 60);
    expect(DEFAULT_PROFILE.restartAfterHoldSeconds).toBe(20 * 60);
    expect(DEFAULT_PROFILE.restartExclusionSeconds).toBe(2 * 60);
    expect(DEFAULT_PROFILE.minuteLimit).toBe(15);
    expect(DEFAULT_PROFILE.passwordRoomRate).toBe(0.1);
    expect(DEFAULT_PROFILE.lobbyWatchers).toBe(200);
    expect(DEFAULT_PROFILE.joinDelayMs).toEqual([5_000, 30_000]);
    expect(DEFAULT_PROFILE.actionDelayMs).toEqual([1_000, 5_000]);
    expect(DEFAULT_PROFILE.timeoutRate).toBe(0.05);
    expect(DEFAULT_PROFILE.dropRate).toBe(0.1);
    expect(DEFAULT_PROFILE.longReturnRate).toBe(0.02);
    expect(DEFAULT_PROFILE.shortReturnMs).toEqual([2_000, 30_000]);
    expect(DEFAULT_PROFILE.longReturnMs).toEqual([60_000, 120_000]);
  });

  it("holds every pass threshold from the spec", () => {
    expect(THRESHOLDS).toMatchObject({
      intentP95Ms: 50,
      intentP99Ms: 150,
      storeWriteP99Ms: 20,
      eventLoopP99Ms: 50,
      clientRttP95Ms: 150,
      clientRttP99Ms: 300,
      serverCpuCores: 0.7,
      heapGrowthRatio: 0.05,
      readyzSeconds: 15,
      restoreSeconds: 10,
      reseatSeconds: 60,
      generatorCpuFraction: 0.7,
    });
    expect(THRESHOLDS.serverRssBytes).toBe(1.5 * 1024 ** 3);
    expect(THRESHOLDS.rejections).toEqual({
      INTERNAL: 0,
      MALFORMED: 0,
      RATE_LIMITED: 0,
      SLOW_DOWN: 0,
    });
  });

  it("adds 100 Rooms/min in the knee profile and never gates", () => {
    expect(KNEE_PROFILE).toEqual({
      roomsPerMinute: 100,
      startRooms: 100,
      maxRooms: 2_000,
      sampleSeconds: 60,
    });
  });

  it("derives the endpoint from the Caddy port", () => {
    expect(resolveEndpoint(8_080, null)).toBe("http://127.0.0.1:8080/colyseus");
    expect(resolveEndpoint(8_080, "http://example.test/colyseus")).toBe(
      "http://example.test/colyseus",
    );
  });

  it("writes reports under the gitignored folder at the repo root", () => {
    expect(defaultReportDir()).toMatch(/\/loadtest-reports$/);
    expect(defaultReportDir()).not.toMatch(/\/apps\/loadtest\/loadtest-reports$/);
  });

  it("is a mutable copy in tests, not a frozen literal", () => {
    const changed: LoadProfile = { ...DEFAULT_PROFILE, rooms: 20 };
    expect(changed.rooms).toBe(20);
    expect(DEFAULT_PROFILE.rooms).toBe(1_000);
  });
});
