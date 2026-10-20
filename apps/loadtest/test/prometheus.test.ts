import { describe, expect, it } from "vitest";
import {
  PrometheusClient,
  distinctValues,
  parseInstant,
  parseRange,
  type FetchLike,
} from "#prometheus.ts";
import { collectServerMetrics, type PromWindows } from "#metrics.ts";
import { THRESHOLDS } from "#config.ts";

const vector = (value: string, metric: Record<string, string> = {}) => ({
  status: "success",
  data: { resultType: "vector", result: [{ metric, value: [1_700_000_000, value] }] },
});

const matrix = (values: string[]) => ({
  status: "success",
  data: {
    resultType: "matrix",
    result: [
      { metric: {}, values: values.map((value, index) => [1_700_000_000 + index * 5, value]) },
    ],
  },
});

const canned = (url: string): unknown => {
  const parsed = new URL(url);
  const query = parsed.searchParams.get("query") ?? "";
  if (query.includes("intent_duration_seconds_bucket")) {
    return vector(query.includes("0.95") ? "0.031" : "0.087");
  }
  if (query.includes("room_store_write_duration_seconds_bucket")) return vector("0.009");
  if (query.includes("nodejs_eventloop_lag_p99_seconds")) return vector("0.021");
  if (query.includes("process_cpu_seconds_total")) return vector("0.42");
  if (query.includes("process_resident_memory_bytes")) return vector("734003200");
  if (query.includes("nodejs_heap_size_used_bytes")) {
    const time = parsed.searchParams.get("time") ?? "";
    return vector(time.startsWith("1700002400") ? "210000000" : "200000000");
  }
  if (query.includes('code="INTERNAL"')) return vector("0");
  if (query.includes('code="MALFORMED"')) return vector("0");
  if (query.includes('code="RATE_LIMITED"')) return vector("2");
  if (query.includes('code="SLOW_DOWN"')) return vector("3");
  if (query.includes("restore_duration_seconds")) return vector("4.5");
  if (query.includes("rooms_restored")) return vector("1000");
  if (query.includes('rooms{state="playing"}')) return vector("998");
  if (query.includes("process_start_time_seconds")) {
    return matrix(["1700000000", "1700000000", "1700001200", "1700001200"]);
  }
  throw new Error(`unexpected query: ${query}`);
};

describe("Prometheus response parsing", () => {
  it("reads a vector sample", () => {
    expect(parseInstant(vector("0.047"))).toBe(0.047);
    expect(parseInstant(vector("NaN"))).toBeNull();
    expect(
      parseInstant({ status: "success", data: { resultType: "vector", result: [] } }),
    ).toBeNull();
  });

  it("reads a scalar sample", () => {
    expect(
      parseInstant({ status: "success", data: { resultType: "scalar", result: [1, "12.5"] } }),
    ).toBe(12.5);
  });

  it("refuses an error response", () => {
    expect(() => parseInstant({ status: "error", error: "bad query" })).toThrow(/bad query/);
  });

  it("reads range series", () => {
    expect(parseRange(matrix(["1", "2"]))).toEqual([[1, 2]]);
  });

  it("counts distinct counter values across a reset", () => {
    expect(distinctValues([1, 1, 1, 2, 2])).toBe(2);
    expect(distinctValues([])).toBe(0);
  });
});

describe("the Prometheus client", () => {
  it("asks the HTTP API for an instant and a range value", async () => {
    const urls: string[] = [];
    const fetchImpl: FetchLike = async (url) => {
      urls.push(url);
      return {
        ok: true,
        status: 200,
        json: async () => (url.includes("query_range") ? matrix(["1", "2"]) : vector("3")),
      };
    };
    const client = new PrometheusClient("http://prom.test", fetchImpl);
    expect(await client.instant("up", 1_700_000_000_000)).toBe(3);
    expect(await client.range("up", 0, 10_000, 5_000)).toEqual([[1, 2]]);
    expect(urls[0]).toContain("/api/v1/query?");
    expect(urls[0]).toContain("query=up");
    expect(urls[1]).toContain("/api/v1/query_range?");
    expect(urls[1]).toContain("step=5");
  });

  it("reports a non-200 response", async () => {
    const client = new PrometheusClient("http://prom.test", async () => ({
      ok: false,
      status: 503,
      json: async () => ({}),
    }));
    await expect(client.instant("up", 0)).rejects.toThrow(/Prometheus answered 503/);
  });
});

describe("the server measurements", () => {
  const windows: PromWindows = {
    runStartMs: 1_700_000_000_000,
    holdStartMs: 1_700_000_600_000,
    killMs: 1_700_001_800_000,
    holdEndMs: 1_700_002_400_000,
    b: { endMs: 1_700_002_400_000, seconds: 480 },
  };

  const client = new PrometheusClient("http://prom.test", async (url) => ({
    ok: true,
    status: 200,
    json: async () => canned(url),
  }));

  it("merges both measurement windows", async () => {
    const metrics = await collectServerMetrics(client, windows, Object.keys(THRESHOLDS.rejections));
    expect(metrics.intentP95Ms).toBe(31);
    expect(metrics.intentP99Ms).toBe(87);
    expect(metrics.storeWriteP99Ms).toBe(9);
    expect(metrics.eventLoopP99Ms).toBe(21);
    expect(metrics.serverCpuCores).toBeCloseTo(0.42);
    expect(metrics.serverRssBytes).toBe(734_003_200);
    expect(metrics.heapGrowthRatio).toBeCloseTo(0.05);
    expect(metrics.rejections).toEqual({
      INTERNAL: 0,
      MALFORMED: 0,
      RATE_LIMITED: 4,
      SLOW_DOWN: 6,
    });
    expect(metrics.restoreSeconds).toBe(4.5);
    expect(metrics.roomsRestored).toBe(1_000);
    expect(metrics.roomsPlayingAtKill).toBe(998);
    expect(metrics.serverStarts).toBe(2);
  });

  it("skips the second window when the restart left none", async () => {
    const metrics = await collectServerMetrics(
      client,
      { ...windows, b: null },
      Object.keys(THRESHOLDS.rejections),
    );
    expect(metrics.intentP95Ms).toBe(31);
    expect(metrics.rejections.RATE_LIMITED).toBe(2);
    expect(metrics.heapGrowthRatio).toBeNull();
  });
});
