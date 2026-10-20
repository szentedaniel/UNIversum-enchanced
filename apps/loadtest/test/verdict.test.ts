import { describe, expect, it } from "vitest";
import { THRESHOLDS, type LoadThresholds } from "#config.ts";
import type { ClientSummary } from "#stats.ts";
import type { ServerMetrics } from "#metrics.ts";
import { verdict, type Verdict, type VerdictInput } from "#verdict.ts";

const server = (overrides: Partial<ServerMetrics> = {}): ServerMetrics => ({
  intentP95Ms: 20,
  intentP99Ms: 60,
  storeWriteP99Ms: 8,
  eventLoopP99Ms: 12,
  serverCpuCores: 0.5,
  serverRssBytes: 1_000_000_000,
  heapGrowthRatio: 0.01,
  rejections: { INTERNAL: 0, MALFORMED: 0, RATE_LIMITED: 0, SLOW_DOWN: 0 },
  roomsRestored: 1_000,
  restoreSeconds: 4,
  roomsPlayingAtKill: 1_000,
  serverStarts: 2,
  ...overrides,
});

const client = (overrides: Partial<ClientSummary> = {}): ClientSummary => ({
  rttSamples: 100,
  rttP95Ms: 80,
  rttP99Ms: 200,
  maxRttMs: 400,
  intentsSent: 100,
  intentsAccepted: 100,
  rejections: {},
  decisions: 100,
  timeouts: 5,
  drops: 20,
  shortDrops: 19,
  longDrops: 1,
  tokenRejoins: 19,
  guestRejoins: 1,
  failedRejoins: 0,
  seatMismatches: 0,
  versionRegressions: 0,
  unplannedExits: 0,
  roomsStarted: 1_000,
  gamesFinished: 400,
  clientsAtKill: 3_800,
  clientsBackInTime: 3_800,
  maxRejoinAfterReadyMs: 12_000,
  generatorCpuPeakFraction: 0.25,
  errors: [],
  ...overrides,
});

const input = (overrides: Partial<VerdictInput> = {}): VerdictInput => ({
  thresholds: THRESHOLDS,
  server: server(),
  client: client(),
  restart: {
    readyzSeconds: 8,
    restoreSeconds: 4,
    roomsRestored: 1_000,
    roomsLiveAtKill: 1_000,
    clientsAtKill: 3_800,
    clientsBackInTime: 3_800,
    maxRejoinAfterReadyMs: 12_000,
    serverStarts: 2,
  },
  ...overrides,
});

const row = (result: Verdict, id: string) => {
  const found = result.criteria.find((criterion) => criterion.id === id);
  if (!found) throw new Error(`no criterion ${id}`);
  return found;
};

describe("the verdict", () => {
  it("passes a clean run", () => {
    const result = verdict(input());
    expect(result.pass).toBe(true);
    expect(result.valid).toBe(true);
    expect(result.criteria.every((criterion) => criterion.status !== "fail")).toBe(true);
  });

  it("prints one row per criterion with its threshold", () => {
    const result = verdict(input());
    expect(row(result, "intent-p95").threshold).toBe("≤ 50.0 ms");
    expect(row(result, "intent-p95").actual).toBe("20.0 ms");
    expect(row(result, "server-rss").threshold).toBe("≤ 1.50 GB");
    expect(row(result, "server-cpu").threshold).toBe("≤ 0.70 cores");
    expect(row(result, "heap-growth").threshold).toBe("≤ 5.0%");
  });

  it("passes exactly at a threshold and fails just above it", () => {
    const thresholds: LoadThresholds = { ...THRESHOLDS };
    expect(row(verdict(input()), "intent-p95").status).toBe("pass");
    expect(
      row(verdict(input({ server: server({ intentP95Ms: thresholds.intentP95Ms }) })), "intent-p95")
        .status,
    ).toBe("pass");
    expect(
      row(
        verdict(input({ server: server({ intentP95Ms: thresholds.intentP95Ms + 0.001 }) })),
        "intent-p95",
      ).status,
    ).toBe("fail");
  });

  it("fails each server threshold", () => {
    const cases: [Partial<ServerMetrics>, string][] = [
      [{ intentP99Ms: 151 }, "intent-p99"],
      [{ storeWriteP99Ms: 21 }, "store-write-p99"],
      [{ eventLoopP99Ms: 51 }, "event-loop-p99"],
      [{ serverCpuCores: 0.71 }, "server-cpu"],
      [{ serverRssBytes: 1.61 * 1024 ** 3 }, "server-rss"],
      [{ heapGrowthRatio: 0.051 }, "heap-growth"],
    ];
    for (const [override, id] of cases) {
      expect(row(verdict(input({ server: server(override) })), id).status).toBe("fail");
    }
  });

  it("fails each client threshold", () => {
    expect(
      row(verdict(input({ client: client({ rttP95Ms: 151 }) })), "client-rtt-p95").status,
    ).toBe("fail");
    expect(
      row(verdict(input({ client: client({ rttP99Ms: 301 }) })), "client-rtt-p99").status,
    ).toBe("fail");
  });

  it("fails any forbidden rejection code", () => {
    const metrics = server({ rejections: { ...server().rejections, SLOW_DOWN: 1 } });
    const result = verdict(input({ server: metrics }));
    expect(row(result, "rejections-SLOW_DOWN").status).toBe("fail");
    expect(row(result, "rejections-INTERNAL").status).toBe("pass");
    expect(result.pass).toBe(false);
  });

  it("fails unplanned exits: client sockets and server processes", () => {
    expect(
      row(verdict(input({ client: client({ unplannedExits: 1 }) })), "unplanned-exits").status,
    ).toBe("fail");
    expect(
      row(verdict(input({ restart: { ...input().restart, serverStarts: 3 } })), "unplanned-exits")
        .status,
    ).toBe("fail");
  });

  it("fails lost Rooms, failed rejoins, Seat swaps and version regressions", () => {
    expect(
      row(verdict(input({ restart: { ...input().restart, roomsRestored: 999 } })), "lost-rooms")
        .status,
    ).toBe("fail");
    expect(
      row(verdict(input({ client: client({ failedRejoins: 1 }) })), "failed-rejoins").status,
    ).toBe("fail");
    expect(
      row(verdict(input({ client: client({ seatMismatches: 1 }) })), "seat-mismatches").status,
    ).toBe("fail");
    expect(
      row(verdict(input({ client: client({ versionRegressions: 1 }) })), "version-regressions")
        .status,
    ).toBe("fail");
  });

  it("checks readyz, restore and reseat times", () => {
    expect(
      row(verdict(input({ restart: { ...input().restart, readyzSeconds: 16 } })), "readyz").status,
    ).toBe("fail");
    expect(
      row(verdict(input({ restart: { ...input().restart, restoreSeconds: 11 } })), "restore")
        .status,
    ).toBe("fail");
    expect(
      row(verdict(input({ restart: { ...input().restart, clientsBackInTime: 3_799 } })), "reseated")
        .status,
    ).toBe("fail");
    expect(
      row(
        verdict(input({ restart: { ...input().restart, maxRejoinAfterReadyMs: 61_000 } })),
        "reseated",
      ).status,
    ).toBe("fail");
  });

  it("marks an over-70% generator invalid and fails the run", () => {
    const result = verdict(input({ client: client({ generatorCpuPeakFraction: 0.71 }) }));
    expect(result.valid).toBe(false);
    expect(result.pass).toBe(false);
    expect(result.invalidReason).toContain("generator CPU");
    expect(row(result, "generator-cpu").status).toBe("fail");
  });

  it("accepts a generator at exactly 70%", () => {
    const result = verdict(input({ client: client({ generatorCpuPeakFraction: 0.7 }) }));
    expect(result.valid).toBe(true);
    expect(result.pass).toBe(true);
  });

  it("skips a measurement it has no data for, and still passes", () => {
    const result = verdict(
      input({
        server: server({
          intentP95Ms: null,
          intentP99Ms: null,
          storeWriteP99Ms: null,
          eventLoopP99Ms: null,
          serverCpuCores: null,
          serverRssBytes: null,
          heapGrowthRatio: null,
        }),
        client: client({ rttP95Ms: null, rttP99Ms: null }),
        restart: {
          readyzSeconds: null,
          restoreSeconds: null,
          roomsRestored: null,
          roomsLiveAtKill: null,
          clientsAtKill: null,
          clientsBackInTime: null,
          maxRejoinAfterReadyMs: null,
          serverStarts: null,
        },
      }),
    );
    expect(
      result.criteria.filter((criterion) => criterion.status === "skip").length,
    ).toBeGreaterThan(5);
    expect(result.pass).toBe(true);
    expect(row(result, "intent-p95").actual).toBe("no data");
  });
});
