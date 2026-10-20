import { describe, expect, it } from "vitest";
import { createIpTagger, limiterRefused } from "#observability/limiter-refusals.ts";
import { createLogger } from "#observability/logger.ts";
import { GameMetrics } from "#observability/metrics.ts";
import { captureLogs, T0 } from "./helpers.ts";

const DAY = 24 * 60 * 60 * 1000;

describe("the IP tag", () => {
  it("is 8 hex of the IP bucket: the same bucket tags the same within a day, another bucket differently", () => {
    let now = T0;
    const tag = createIpTagger(() => now);

    const first = tag("203.0.113.7");
    now += DAY - 1;

    expect(first).toMatch(/^[0-9a-f]{8}$/);
    expect(tag("203.0.113.7")).toBe(first);
    expect(tag("203.0.113.8")).not.toBe(first);
  });

  it("changes every 24 h (the in-memory salt rotates), so no tag outlives a day", () => {
    let now = T0;
    const tag = createIpTagger(() => now);

    const today = tag("2001:db8:1:2::/64");
    now += DAY;

    expect(tag("2001:db8:1:2::/64")).not.toBe(today);
  });

  it("is not the same in two processes (the salt is random)", () => {
    expect(createIpTagger(() => T0)("203.0.113.7")).not.toBe(
      createIpTagger(() => T0)("203.0.113.7"),
    );
  });
});

describe("a limiter refusal", () => {
  it("counts in limiter_refusals_total{limit} and logs the limit with the IP tag, never the IP", async () => {
    const capture = captureLogs();
    const metrics = new GameMetrics({ release: "test" });
    const observe = {
      log: createLogger({ level: "info", stream: capture.stream }),
      metrics,
      ipTag: createIpTagger(() => T0),
    };

    limiterRefused(observe, "joins", "203.0.113.7");
    limiterRefused(observe, "joins", "203.0.113.7");

    expect(await metrics.scrape()).toContain('limiter_refusals_total{limit="joins"} 2');
    expect(await metrics.scrape()).toContain('limiter_refusals_total{limit="sockets"} 0');
    expect(capture.lines()).toEqual([
      expect.objectContaining({
        level: 30,
        msg: "limit refused",
        limit: "joins",
        ipTag: observe.ipTag("203.0.113.7"),
      }),
      expect.objectContaining({ msg: "limit refused" }),
    ]);
    expect(capture.text()).not.toContain("203.0.113");
  });
});
