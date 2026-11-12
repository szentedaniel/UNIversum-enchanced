import { describe, expect, it } from "vitest";
import {
  heartbeatWindow,
  JOB_LIMIT_MS,
  liveHeartbeat,
  runHeartbeat,
  TICK_INTERVAL_MS,
} from "#schedule/heartbeat.ts";

const at = (iso: string): Date => new Date(iso);

/** A clock the heartbeat moves by every wait it asks for, so no test sleeps. */
const fakeClock = (start: Date): { now: () => Date; sleep: (ms: number) => Promise<void> } => {
  let clock = start;
  return {
    now: () => clock,
    sleep: (ms) => {
      clock = new Date(clock.getTime() + ms);
      return Promise.resolve();
    },
  };
};

const noErrors = (): { errors: readonly string[] } => ({ errors: [] });

describe("heartbeatWindow", () => {
  it("ticks every ten minutes and hands over before GitHub's six-hour job limit", () => {
    const start = at("2026-11-10T00:00:00Z");
    const window = heartbeatWindow(start);

    expect(window.ticks[0]).toEqual(start);
    expect(window.ticks[1]).toEqual(at("2026-11-10T00:10:00Z"));
    expect(window.ticks.at(-1)).toEqual(at("2026-11-10T05:20:00Z"));
    expect(window.handoverAt).toEqual(at("2026-11-10T05:30:00Z"));
    expect(window.handoverAt.getTime() - start.getTime()).toBeLessThan(JOB_LIMIT_MS);
  });
});

describe("liveHeartbeat", () => {
  it("finds another queued or in-progress tick run", () => {
    expect(liveHeartbeat([{ id: 1, status: "queued" }], 9)).toEqual({ id: 1, status: "queued" });
    expect(liveHeartbeat([{ id: 2, status: "in_progress" }], 9)).toEqual({
      id: 2,
      status: "in_progress",
    });
  });

  it("ignores this run and a completed one", () => {
    expect(
      liveHeartbeat(
        [
          { id: 9, status: "in_progress" },
          { id: 3, status: "completed" },
        ],
        9,
      ),
    ).toBeUndefined();
  });

  it("finds no heartbeat in an empty page", () => {
    expect(liveHeartbeat([], 9)).toBeUndefined();
  });
});

describe("runHeartbeat", () => {
  it("ticks every ten minutes, then relays its successor at the hand-over", async () => {
    const start = at("2026-11-10T00:00:00Z");
    const clock = fakeClock(start);
    const ticks: Date[] = [];
    let relayedAt: Date | undefined;

    const outcome = await runHeartbeat({
      ...clock,
      live: () => false,
      tick: (now) => {
        ticks.push(now);
        return noErrors();
      },
      relay: () => {
        relayedAt = clock.now();
      },
      log: () => undefined,
    });

    expect(ticks).toEqual(heartbeatWindow(start).ticks);
    const times = ticks.map((tick) => tick.getTime());
    const gaps = times.slice(1).map((time, index) => time - (times[index] ?? time));
    expect(gaps).toEqual(Array.from({ length: 32 }, () => TICK_INTERVAL_MS));
    expect(relayedAt).toEqual(at("2026-11-10T05:30:00Z"));
    expect(outcome).toEqual({ duplicate: false, ticks: 33, relayed: true, errors: [] });
  });

  it("keeps ticking after a failed tick and still relays", async () => {
    const clock = fakeClock(at("2026-11-10T00:00:00Z"));
    let calls = 0;
    let relayed = false;

    const outcome = await runHeartbeat({
      ...clock,
      live: () => false,
      tick: () => {
        calls += 1;
        if (calls === 1) throw new Error("the runs API is down");
        if (calls === 2) return { errors: ["review: could not dispatch"] };
        return noErrors();
      },
      relay: () => {
        relayed = true;
      },
      log: () => undefined,
    });

    expect(calls).toBe(33);
    expect(outcome.ticks).toBe(33);
    expect(outcome.relayed).toBe(true);
    expect(relayed).toBe(true);
    expect(outcome.errors).toEqual([
      "tick at 2026-11-10T00:00:00.000Z failed: the runs API is down",
      "review: could not dispatch",
    ]);
  });

  it("exits without ticking when another heartbeat is alive", async () => {
    const clock = fakeClock(at("2026-11-10T00:00:00Z"));
    const logs: string[] = [];

    const outcome = await runHeartbeat({
      ...clock,
      live: () => true,
      tick: () => {
        throw new Error("a duplicate start must not tick");
      },
      relay: () => {
        throw new Error("a duplicate start must not relay");
      },
      log: (line) => logs.push(line),
    });

    expect(outcome).toEqual({ duplicate: true, ticks: 0, relayed: false, errors: [] });
    expect(logs).toHaveLength(1);
  });

  it("a start that finds a queued heartbeat exits without ticking", async () => {
    const clock = fakeClock(at("2026-11-10T00:00:00Z"));
    const runs = [
      { id: 2, status: "queued" },
      { id: 3, status: "completed" },
    ];
    let ticked = false;
    let relayed = false;

    const outcome = await runHeartbeat({
      ...clock,
      live: () => liveHeartbeat(runs, 9) !== undefined,
      tick: () => {
        ticked = true;
        return noErrors();
      },
      relay: () => {
        relayed = true;
      },
      log: () => undefined,
    });

    expect(ticked).toBe(false);
    expect(relayed).toBe(false);
    expect(outcome.duplicate).toBe(true);
    expect(outcome.ticks).toBe(0);
  });

  it("starts the loop when the runs page holds no other live heartbeat", async () => {
    const clock = fakeClock(at("2026-11-10T00:00:00Z"));
    const runs = [
      { id: 9, status: "in_progress" },
      { id: 3, status: "completed" },
    ];
    let ticks = 0;
    let relayed = false;

    const outcome = await runHeartbeat({
      ...clock,
      live: () => liveHeartbeat(runs, 9) !== undefined,
      tick: () => {
        ticks += 1;
        return noErrors();
      },
      relay: () => {
        relayed = true;
      },
      log: () => undefined,
    });

    expect(ticks).toBe(33);
    expect(relayed).toBe(true);
    expect(outcome.duplicate).toBe(false);
  });

  it("reports a failed relay after the full loop", async () => {
    const clock = fakeClock(at("2026-11-10T00:00:00Z"));

    const outcome = await runHeartbeat({
      ...clock,
      live: () => false,
      tick: noErrors,
      relay: () => {
        throw new Error("the dispatch was refused");
      },
      log: () => undefined,
    });

    expect(outcome.relayed).toBe(false);
    expect(outcome.errors).toEqual([
      "could not relay the next heartbeat: the dispatch was refused",
    ]);
  });
});
