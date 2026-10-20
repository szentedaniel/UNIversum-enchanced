import { describe, expect, it } from "vitest";
import { THRESHOLDS } from "#config.ts";
import { renderReport, reportFileName, type RunReport } from "#report.ts";
import type { ClientSummary } from "#stats.ts";
import type { ServerMetrics } from "#metrics.ts";
import { verdict } from "#verdict.ts";

const server: ServerMetrics = {
  intentP95Ms: 31,
  intentP99Ms: 87,
  storeWriteP99Ms: 9,
  eventLoopP99Ms: 21,
  serverCpuCores: 0.42,
  serverRssBytes: 734_003_200,
  heapGrowthRatio: 0.021,
  rejections: { INTERNAL: 0, MALFORMED: 0, RATE_LIMITED: 0, SLOW_DOWN: 0 },
  roomsRestored: 999,
  restoreSeconds: 4.5,
  roomsPlayingAtKill: 999,
  serverStarts: 2,
};

const client: ClientSummary = {
  rttSamples: 1000,
  rttP95Ms: 80,
  rttP99Ms: 200,
  maxRttMs: 410,
  intentsSent: 1000,
  intentsAccepted: 1000,
  rejections: {},
  decisions: 1000,
  timeouts: 50,
  drops: 20,
  shortDrops: 19,
  longDrops: 1,
  tokenRejoins: 19,
  guestRejoins: 1,
  failedRejoins: 0,
  seatMismatches: 0,
  versionRegressions: 0,
  unplannedExits: 0,
  roomsStarted: 1000,
  gamesFinished: 400,
  roomsAtKill: 999,
  clientsAtKill: 4000,
  clientsBackInTime: 4000,
  maxRejoinAfterReadyMs: 12_000,
  generatorCpuPeakFraction: 0.25,
  errors: [],
};

const restart = {
  readyzSeconds: 8,
  restoreSeconds: 4.5,
  roomsRestored: 999,
  roomsLiveAtKill: 999,
  clientsAtKill: 4000,
  clientsBackInTime: 4000,
  maxRejoinAfterReadyMs: 12_000,
  serverStarts: 2,
};

const report = (overrides: Partial<RunReport> = {}): RunReport => {
  const input = { thresholds: THRESHOLDS, server, client, restart };
  return {
    mode: "full",
    startedAt: new Date("2026-10-20T18:00:00Z"),
    gitSha: "abc1234",
    host: {
      cpuModel: "AMD EPYC 7B13 64-Core Processor",
      cpuCount: 8,
      platform: "linux arm64",
      node: "v26.12.0",
      totalMemoryBytes: 16 * 1024 ** 3,
    },
    options: {
      endpoint: "http://127.0.0.1:8080/colyseus",
      httpPort: 8080,
      prometheusPort: 9090,
      projectName: "universum-loadtest",
    },
    profile: {
      rooms: 1_000,
      playersPerRoom: 4,
      rampSeconds: 600,
      holdSeconds: 1_800,
      restartAfterHoldSeconds: 1_200,
      restartExclusionSeconds: 120,
      minuteLimit: 15,
      passwordRoomRate: 0.1,
      lobbyWatchers: 200,
      joinDelayMs: [5_000, 30_000],
      actionDelayMs: [1_000, 5_000],
      timeoutRate: 0.05,
      dropRate: 0.1,
      longReturnRate: 0.02,
      shortReturnMs: [2_000, 30_000],
      longReturnMs: [60_000, 120_000],
      dropWindowMs: [30_000, 780_000],
      seed: 46,
    },
    knee: null,
    windows: {
      runStartMs: 0,
      holdStartMs: 600_000,
      killMs: 1_800_000,
      holdEndMs: 2_400_000,
      b: { endMs: 2_400_000, seconds: 420 },
    },
    server,
    client,
    restart,
    verdict: verdict(input),
    durationSeconds: 2_400,
    warnings: [],
    ...overrides,
  };
};

describe("the Markdown report", () => {
  it("names the file by the run's start", () => {
    expect(reportFileName(new Date("2026-10-20T18:05:09Z"))).toBe("loadtest-20261020-180509.md");
  });

  it("holds the git SHA, host CPU and generator peak", () => {
    const text = renderReport(report());
    expect(text).toContain("abc1234");
    expect(text).toContain("AMD EPYC 7B13 64-Core Processor");
    expect(text).toContain("Generator CPU peak: 25.0%");
    expect(text).toContain("# UNIversum load test — PASS");
  });

  it("prints every criterion in a PASS/FAIL table", () => {
    const text = renderReport(report());
    expect(text).toContain("| Criterion | Threshold | Measured | Result |");
    expect(text).toMatch(/\| intent duration p95 \| ≤ 50\.0 ms \| 31\.0 ms \| PASS \|/);
    expect(text).toMatch(/\| generator CPU peak \(run validity\) \| ≤ 70\.0% \| 25\.0% \| PASS \|/);
    for (const criterion of verdict({ thresholds: THRESHOLDS, server, client, restart }).criteria) {
      expect(text).toContain(criterion.label);
    }
  });

  it("marks an invalid run", () => {
    const text = renderReport(
      report({
        client: { ...client, generatorCpuPeakFraction: 0.81 },
        verdict: verdict({
          thresholds: THRESHOLDS,
          server,
          client: { ...client, generatorCpuPeakFraction: 0.81 },
          restart,
        }),
      }),
    );
    expect(text).toContain("# UNIversum load test — INVALID");
    expect(text).toContain("generator CPU peaked at 81.0%");
  });

  it("prints every measured number", () => {
    const text = renderReport(report());
    for (const fragment of [
      "intent duration p95",
      "31.0 ms",
      "intent duration p99",
      "87.0 ms",
      "Store write p99",
      "9.0 ms",
      "Event-loop lag p99",
      "21.0 ms",
      "Server CPU",
      "0.42 cores",
      "Server RSS",
      "0.68 GB",
      "Heap growth",
      "2.1%",
      "Room round trips",
      "1000 samples",
      "/readyz",
      "8.0 s",
      "restore time",
      "4.5 s",
      "Rooms restored",
      "999",
      "Clients at the kill",
      "4000",
    ]) {
      expect(text).toContain(fragment);
    }
  });

  it("lists client rejections", () => {
    const text = renderReport(
      report({ client: { ...client, rejections: { STALE_TURN: 2, NOT_OFFERED: 1 } } }),
    );
    expect(text).toContain("| Client rejections | STALE_TURN 2, NOT_OFFERED 1 |");
  });

  it("describes the profile it ran", () => {
    const text = renderReport(report());
    expect(text).toContain("1000 Rooms × 4 Guests");
    expect(text).toContain("10m ramp");
    expect(text).toContain("30m hold");
    expect(text).toContain("kill at 20m");
    expect(text).toContain("2m excluded after the restart");
  });

  it("reports the knee search's last passing count", () => {
    const text = renderReport(
      report({
        mode: "knee",
        kneeResult: {
          lastPassingRooms: 700,
          startedRooms: 800,
          breakingCriterion: "intent-p99",
          samples: 7,
        },
      }),
    );
    expect(text).toContain("find-knee");
    expect(text).toContain("Last passing count: 700 Rooms");
    expect(text).toContain("Broke at: intent-p99");
  });
});
