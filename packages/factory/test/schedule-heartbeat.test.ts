import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { JOBS } from "#schedule/due.ts";
import {
  DRY_RUN_MARKER,
  HEARTBEAT_LENGTH_MS,
  heartbeatWindow,
  JOB_LIMIT_MS,
  liveHeartbeat,
  RELAY_ATTEMPTS,
  runHeartbeat,
  TICK_INTERVAL_MS,
  type LiveRun,
} from "#schedule/heartbeat.ts";

const at = (iso: string): Date => new Date(iso);

/** A clock the heartbeat moves by every wait it asks for, so no test sleeps. */
const fakeClock = (
  start: Date,
): {
  now: () => Date;
  sleep: (ms: number) => Promise<void>;
  advance: (ms: number) => void;
} => {
  let clock = start;
  const advance = (ms: number): void => {
    clock = new Date(clock.getTime() + ms);
  };
  return {
    now: () => clock,
    sleep: (ms) => {
      advance(ms);
      return Promise.resolve();
    },
    advance,
  };
};

const noErrors = (): { errors: readonly string[] } => ({ errors: [] });

/** A tick run as the runs list reports it; `(heartbeat)` is the relay's own name. */
const run = (
  id: number,
  status: string,
  event = "workflow_dispatch",
  display_title = "Factory Tick (heartbeat)",
): LiveRun => ({ id, status, event, display_title });

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
  it("finds a newer queued or in-progress heartbeat", () => {
    expect(liveHeartbeat([run(10, "queued")], 9)).toEqual(run(10, "queued"));
    expect(liveHeartbeat([run(10, "in_progress")], 9)).toEqual(run(10, "in_progress"));
  });

  it("ignores this run and a completed one", () => {
    expect(liveHeartbeat([run(9, "in_progress"), run(10, "completed")], 9)).toBeUndefined();
  });

  it("ignores an older run, which the group has already replaced or run", () => {
    // A cancelled cron the API still lists as queued once made the successor
    // exit, leaving no chain until the next cron: an older run cannot be live.
    expect(
      liveHeartbeat(
        [run(7, "queued", "schedule", "Factory Tick (cron)"), run(8, "in_progress")],
        9,
      ),
    ).toBeUndefined();
  });

  it("ignores a newer cron run and a newer dry run", () => {
    expect(
      liveHeartbeat([run(10, "queued", "schedule", "Factory Tick (cron)")], 9),
    ).toBeUndefined();
    expect(
      liveHeartbeat([run(10, "queued", "workflow_dispatch", `Factory Tick ${DRY_RUN_MARKER}`)], 9),
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
    const runs = [run(10, "queued"), run(11, "completed")];
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

  it("starts the loop over a cancelled cron the API still lists as queued", async () => {
    const clock = fakeClock(at("2026-11-10T00:00:00Z"));
    // The relay replaced the pending cron and the predecessor is still listed
    // for a moment: neither may make the successor skip its only window.
    const runs = [
      run(7, "queued", "schedule", "Factory Tick (cron)"),
      run(8, "in_progress"),
      run(9, "in_progress"),
    ];
    let ticked = false;

    const outcome = await runHeartbeat({
      ...clock,
      live: () => liveHeartbeat(runs, 9) !== undefined,
      tick: () => {
        ticked = true;
        return noErrors();
      },
      relay: () => undefined,
      log: () => undefined,
    });

    expect(ticked).toBe(true);
    expect(outcome.duplicate).toBe(false);
    expect(outcome.ticks).toBe(33);
  });

  it("starts the loop when the cron replaced a successor still listed as queued", async () => {
    const clock = fakeClock(at("2026-11-10T00:00:00Z"));
    // The cron took the pending slot from the successor the predecessor
    // relayed. The API still lists that cancelled successor as queued, but its
    // id is older than the cron's, so it must not stop the cron's only window.
    const runs = [run(19, "queued"), run(20, "in_progress", "schedule", "Factory Tick (cron)")];
    let ticked = false;

    const outcome = await runHeartbeat({
      ...clock,
      live: () => liveHeartbeat(runs, 20) !== undefined,
      tick: () => {
        ticked = true;
        return noErrors();
      },
      relay: () => undefined,
      log: () => undefined,
    });

    expect(ticked).toBe(true);
    expect(outcome.duplicate).toBe(false);
    expect(outcome.ticks).toBe(33);
    expect(outcome.relayed).toBe(true);
  });

  it("starts its successor on a fresh window, so no tick time is used twice", async () => {
    const start = at("2026-11-10T00:00:00Z");
    const clock = fakeClock(start);
    const ticks: Date[] = [];

    const beat = async (): Promise<void> => {
      const outcome = await runHeartbeat({
        ...clock,
        live: () => false,
        tick: (now) => {
          ticks.push(now);
          return noErrors();
        },
        relay: () => undefined,
        log: () => undefined,
      });
      expect(outcome.relayed).toBe(true);
    };

    await beat();
    const handover = clock.now();
    await beat();

    expect(handover).toEqual(at("2026-11-10T05:30:00Z"));
    expect(ticks[33]).toEqual(handover);
    const times = ticks.map((tick) => tick.getTime());
    expect(new Set(times).size).toBe(times.length);
    const gaps = times.slice(1).map((time, index) => time - (times[index] ?? time));
    expect(gaps).toEqual(Array.from({ length: 65 }, () => TICK_INTERVAL_MS));
  });

  it("skips a tick slot the previous tick overran instead of catching up back to back", async () => {
    const start = at("2026-11-10T00:00:00Z");
    const clock = fakeClock(start);
    const ticks: Date[] = [];
    const logs: string[] = [];

    const outcome = await runHeartbeat({
      ...clock,
      live: () => false,
      tick: (now) => {
        ticks.push(now);
        if (ticks.length === 1) clock.advance(35 * 60_000);
        return noErrors();
      },
      relay: () => undefined,
      log: (line) => logs.push(line),
    });

    expect(ticks.slice(0, 4)).toEqual([
      at("2026-11-10T00:00:00Z"),
      at("2026-11-10T00:40:00Z"),
      at("2026-11-10T00:50:00Z"),
      at("2026-11-10T01:00:00Z"),
    ]);
    const times = ticks.map((tick) => tick.getTime());
    const gaps = times.slice(1).map((time, index) => time - (times[index] ?? time));
    expect(Math.min(...gaps)).toBe(TICK_INTERVAL_MS);
    expect(outcome.ticks).toBe(30);
    expect(logs.filter((line) => line.startsWith("Skipping the tick"))).toHaveLength(3);
  });

  it("retries a refused relay and still hands over", async () => {
    const clock = fakeClock(at("2026-11-10T00:00:00Z"));
    const logs: string[] = [];
    let attempts = 0;

    const outcome = await runHeartbeat({
      ...clock,
      live: () => false,
      tick: noErrors,
      relay: () => {
        attempts += 1;
        if (attempts === 1) throw new Error("the dispatch was refused");
      },
      log: (line) => logs.push(line),
    });

    expect(attempts).toBe(2);
    expect(outcome.relayed).toBe(true);
    expect(outcome.errors).toEqual([]);
    expect(logs).toContain("Relay attempt 1 failed: the dispatch was refused; retrying in 60 s.");
  });

  it("reports a failed relay after every attempt", async () => {
    const clock = fakeClock(at("2026-11-10T00:00:00Z"));
    let attempts = 0;

    const outcome = await runHeartbeat({
      ...clock,
      live: () => false,
      tick: noErrors,
      relay: () => {
        attempts += 1;
        throw new Error("the dispatch was refused");
      },
      log: () => undefined,
    });

    expect(attempts).toBe(RELAY_ATTEMPTS);
    expect(outcome.relayed).toBe(false);
    expect(outcome.errors).toEqual([
      `could not relay the next heartbeat after ${RELAY_ATTEMPTS} attempts: the dispatch was refused`,
    ]);
  });
});

describe("factory-tick.yml", () => {
  const workflow = readFileSync(
    new URL("../../../.github/workflows/factory-tick.yml", import.meta.url),
    "utf8",
  );

  it("kills the job after the hand-over and below GitHub's limit, so a slow tick still relays", () => {
    const minutes = Number(/timeout-minutes:\s*(\d+)/u.exec(workflow)?.[1]);
    expect(minutes * 60_000).toBeGreaterThan(HEARTBEAT_LENGTH_MS);
    expect(minutes * 60_000).toBeLessThan(JOB_LIMIT_MS);
  });

  it("names a dry run and keeps it out of the heartbeat's concurrency group", () => {
    expect(workflow).toContain(DRY_RUN_MARKER);
    expect(workflow).toContain("group: factory-tick${{ inputs.dry_run && '-dry-run' || '' }}");
    // liveHeartbeat's newer-run rule needs the group to queue a successor
    // behind its predecessor and to replace an older pending run, never to
    // cancel the running heartbeat.
    expect(workflow).toContain("cancel-in-progress: false");
  });
});

describe("the entry", () => {
  const entry = fileURLToPath(new URL("../src/schedule/heartbeat-run.ts", import.meta.url));

  /** Runs the entry against a `gh` shim; `env` overrides the dry-run defaults. */
  const runEntry = (
    shim: string,
    env: Record<string, string> = {},
  ): { status: number | null; output: string; calls: string[] } => {
    const dir = mkdtempSync(join(tmpdir(), "factory-heartbeat-"));
    const calls = join(dir, "gh-calls.log");
    writeFileSync(calls, "");
    writeFileSync(join(dir, "gh"), shim.replaceAll("CALLS", calls));
    chmodSync(join(dir, "gh"), 0o755);
    const result = spawnSync(process.execPath, [entry], {
      encoding: "utf8",
      timeout: 60_000,
      env: {
        ...process.env,
        PATH: `${dir}:${process.env["PATH"] ?? ""}`,
        GH_REPO: "owner/repo",
        GH_TOKEN: "test-token",
        GITHUB_RUN_ID: "",
        DRY_RUN: "1",
        OUTPUT_DIR: dir,
        ...env,
      },
    });
    return {
      status: result.status,
      output: `${result.stdout}${result.stderr}`,
      calls: readFileSync(calls, "utf8")
        .trim()
        .split("\n")
        .filter((line) => line !== ""),
    };
  };

  it("ticks once, reads every workflow's runs and starts no successor", () => {
    const { status, output, calls } = runEntry('#!/bin/sh\necho "$*" >> "CALLS"\necho "[]"\n');

    expect(status).toBe(0);
    expect(output).toContain("Dry run: one tick, no successor.");
    expect(calls).toHaveLength(JOBS.length);
    expect(calls.every((call) => call.startsWith("api "))).toBe(true);
  });

  it("fails the run when a workflow's runs cannot be read", () => {
    const { status, output } = runEntry('#!/bin/sh\necho "not a runs page"\n');

    expect(status).toBe(1);
    expect(output).toContain("The dry tick hit errors");
  });

  it("fails a real start whose liveness read fails, and starts no successor", () => {
    // Without the live check the run cannot tell a chain from a duplicate, so
    // it must go red instead of ticking and relaying.
    const { status, output, calls } = runEntry('#!/bin/sh\necho "$*" >> "CALLS"\necho "{}"\n', {
      GITHUB_RUN_ID: "123",
      DRY_RUN: "",
    });

    expect(status).toBe(1);
    expect(output).toContain("is not an array");
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatch(/^api .*status=in_progress/u);
    expect(calls.some((call) => call.startsWith("workflow run"))).toBe(false);
  });
});
