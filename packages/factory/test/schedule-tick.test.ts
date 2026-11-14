import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { JOBS } from "#schedule/due.ts";
import {
  newestTickRun,
  runTick,
  tickWiring,
  type TickDeps,
  type TickOutcome,
} from "#schedule/tick.ts";
import { parseJson } from "#shared/github.ts";

const at = (iso: string): Date => new Date(iso);

/**
 * A `gh` on PATH that records its argv; a call with `GH_SHIM_MATCH` in an
 * argument prints `GH_SHIM_STDOUT`, every other call an empty page.
 */
const SHIM = `#!/usr/bin/env node
const { appendFileSync } = require("node:fs");
const args = process.argv.slice(2);
const log = process.env["GH_SHIM_LOG"];
if (log !== undefined) appendFileSync(log, JSON.stringify(args) + "\\n");
const match = process.env["GH_SHIM_MATCH"];
const matched = match !== undefined && args.some((arg) => arg.includes(match));
process.stdout.write(matched ? (process.env["GH_SHIM_STDOUT"] ?? "[]") : "[]");
`;

const originalPath = process.env["PATH"];
let log: string;

beforeEach(() => {
  const dir = mkdtempSync(join(tmpdir(), "universum-tick-"));
  log = join(dir, "calls.jsonl");
  process.env["GH_SHIM_LOG"] = log;
  writeFileSync(join(dir, "gh"), SHIM);
  chmodSync(join(dir, "gh"), 0o755);
  process.env["PATH"] = `${dir}:${originalPath ?? ""}`;
});

afterEach(() => {
  if (originalPath === undefined) delete process.env["PATH"];
  else process.env["PATH"] = originalPath;
  delete process.env["GH_SHIM_LOG"];
  delete process.env["GH_SHIM_MATCH"];
  delete process.env["GH_SHIM_STDOUT"];
});

/** Every `gh` call the shim saw, as its argv. */
const calls = (): string[][] =>
  readFileSync(log, "utf8")
    .split("\n")
    .filter((line) => line !== "")
    .map((line) => parseJson<string[]>(line));

/** One tick with every dependency at its quiet answer; a test overrides what it pins. */
const tick = (now: Date, deps: Partial<Omit<TickDeps, "now">> = {}): TickOutcome =>
  runTick({
    now,
    dryRun: false,
    lastTickRun: () => undefined,
    dispatcherLive: () => false,
    startDispatcher: () => undefined,
    dispatch: () => undefined,
    log: () => undefined,
    ...deps,
  });

describe("newestTickRun", () => {
  it("counts the tick's own dispatch, not a manual, dry or per-pull-request run", () => {
    expect(
      newestTickRun([
        { created_at: "2026-11-10T02:24:00Z", display_title: "Factory review (factory tick)" },
        { created_at: "2026-11-10T02:30:00Z", display_title: "Factory review #97" },
        { created_at: "2026-11-10T02:40:00Z", display_title: "Factory review night queue" },
        { created_at: "2026-11-10T02:50:00Z", display_title: "Factory review (manual)" },
      ]),
    ).toEqual(at("2026-11-10T02:24:00Z"));
  });

  it("takes the newest tick dispatch and ignores an unreadable time", () => {
    expect(
      newestTickRun([
        { created_at: "2026-11-10T02:24:00Z", display_title: "Factory review (factory tick)" },
        { created_at: "not a time", display_title: "Factory review (factory tick)" },
        { created_at: "2026-11-10T02:34:00Z", display_title: "Factory review (factory tick)" },
      ]),
    ).toEqual(at("2026-11-10T02:34:00Z"));
  });

  it("finds no tick dispatch in a page of manual runs", () => {
    expect(
      newestTickRun([
        { created_at: "2026-11-10T02:24:00Z", display_title: "Factory intake #93" },
        { created_at: "2026-11-10T02:34:00Z", display_title: "Factory intake manual run" },
      ]),
    ).toBeUndefined();
  });
});

describe("runTick", () => {
  it("dispatches the due jobs and keeps going after a failed read and a failed dispatch", () => {
    const dispatched: string[] = [];
    const dispatcherStarts: string[] = [];
    const outcome = tick(at("2026-11-10T04:00:00Z"), {
      // Tuesday 05:00 CET: intake, review and retro are due.
      lastTickRun: (workflow) => {
        if (workflow === "factory-retro.yml") throw new Error("the runs API is down");
      },
      startDispatcher: () => dispatcherStarts.push("factory-dispatch.yml"),
      dispatch: (workflow) => {
        if (workflow === "factory-review.yml") throw new Error("the dispatch was refused");
        dispatched.push(workflow);
      },
    });

    expect(dispatched).toEqual(["factory-intake.yml"]);
    expect(dispatcherStarts).toEqual(["factory-dispatch.yml"]);
    expect(outcome.due).toEqual(["factory-intake.yml", "factory-review.yml"]);
    expect(outcome.errors).toEqual([
      "retro: could not read its runs: the runs API is down",
      "review: could not dispatch: the dispatch was refused",
    ]);
  });

  it("names every due job on a dry run and dispatches none", () => {
    const logs: string[] = [];
    const outcome = tick(at("2026-11-10T04:00:00Z"), {
      dryRun: true,
      dispatcherLive: () => false,
      startDispatcher: () => {
        throw new Error("a dry run must not dispatch");
      },
      dispatch: () => {
        throw new Error("a dry run must not dispatch");
      },
      log: (line) => logs.push(line),
    });

    expect(outcome.due).toEqual(["factory-intake.yml", "factory-review.yml", "factory-retro.yml"]);
    expect(outcome.dispatched).toEqual([]);
    expect(logs).toHaveLength(4);
    expect(logs.at(-1)).toBe("Dry run: would dispatch factory-dispatch.yml.");
  });

  it("leaves a job alone when the tick already dispatched it since its due time", () => {
    const dispatched: string[] = [];
    const outcome = tick(at("2026-11-10T04:00:00Z"), {
      lastTickRun: (workflow) =>
        workflow === "factory-intake.yml" ? at("2026-11-10T00:08:00Z") : undefined,
      dispatch: (workflow) => dispatched.push(workflow),
    });

    expect(dispatched).toEqual(["factory-review.yml", "factory-retro.yml"]);
    expect(outcome.due).toEqual(["factory-review.yml", "factory-retro.yml"]);
  });
});

describe("the dispatcher the tick starts", () => {
  it("starts factory-dispatch.yml when no dispatch run is queued or running", () => {
    const started: string[] = [];
    const outcome = tick(at("2026-11-10T12:00:00Z"), {
      // Tuesday 13:00 CET: no nightly job is due.
      dispatcherLive: () => false,
      startDispatcher: () => started.push("factory-dispatch.yml"),
    });

    expect(started).toEqual(["factory-dispatch.yml"]);
    expect(outcome.due).toEqual([]);
  });

  it("starts no second dispatch while one is queued or in progress", () => {
    const started: string[] = [];
    const outcome = tick(at("2026-11-10T12:00:00Z"), {
      dispatcherLive: () => true,
      startDispatcher: () => started.push("factory-dispatch.yml"),
    });

    expect(started).toEqual([]);
    expect(outcome.due).toEqual([]);
  });

  it("records a failed dispatch-run read and starts none, the due jobs still going out", () => {
    const started: string[] = [];
    const dispatched: string[] = [];
    const outcome = tick(at("2026-11-10T04:00:00Z"), {
      dispatcherLive: () => {
        throw new Error("the runs API is down");
      },
      startDispatcher: () => started.push("factory-dispatch.yml"),
      dispatch: (workflow) => dispatched.push(workflow),
    });

    expect(started).toEqual([]);
    expect(dispatched).toEqual(["factory-intake.yml", "factory-review.yml", "factory-retro.yml"]);
    expect(outcome.errors).toEqual(["dispatcher: could not read its runs: the runs API is down"]);
  });

  it("records a refused dispatcher dispatch, the due jobs still going out", () => {
    const dispatched: string[] = [];
    const outcome = tick(at("2026-11-10T04:00:00Z"), {
      startDispatcher: () => {
        throw new Error("the dispatch was refused");
      },
      dispatch: (workflow) => dispatched.push(workflow),
    });

    expect(dispatched).toEqual(["factory-intake.yml", "factory-review.yml", "factory-retro.yml"]);
    expect(outcome.errors).toEqual(["dispatcher: could not dispatch: the dispatch was refused"]);
  });
});

describe("the dispatcher is not a scheduled job", () => {
  it("has no entry in the tick's schedule", () => {
    expect(JOBS.map((job) => job.workflow)).not.toContain("factory-dispatch.yml");
  });

  it("never suppresses a nightly job: a tick that starts it still dispatches what fell due", () => {
    const runs = new Map<string, Date>();
    const tickOnce = (now: Date): TickOutcome =>
      tick(now, {
        lastTickRun: (workflow) => runs.get(workflow),
        startDispatcher: () => runs.set("factory-dispatch.yml", now),
        dispatch: (workflow) => runs.set(workflow, now),
      });

    // Tuesday 03:00 CET: intake (01:07) and review (02:23) are due; retro is not.
    const first = tickOnce(at("2026-11-10T02:00:00Z"));
    expect(first.due).toEqual(["factory-intake.yml", "factory-review.yml"]);

    // 04:50 CET, after retro's 04:41: it is dispatched even though the earlier
    // tick started the dispatcher and recorded a run for it.
    const second = tickOnce(at("2026-11-10T03:50:00Z"));
    expect(second.due).toEqual(["factory-retro.yml"]);
    expect(second.dispatched).toEqual(["factory-retro.yml"]);
  });
});

describe("tickWiring", () => {
  it("reads both live statuses and starts the dispatcher with no scheduled input", () => {
    const outcome = tick(at("2026-11-10T12:00:00Z"), { ...tickWiring("owner/repo") });

    expect(outcome.errors).toEqual([]);
    expect(
      calls().filter((argv) => argv[1]?.includes("factory-dispatch.yml/runs?") === true),
    ).toEqual([
      [
        "api",
        "repos/owner/repo/actions/workflows/factory-dispatch.yml/runs?status=in_progress&per_page=100",
        "--jq",
        ".workflow_runs",
      ],
      [
        "api",
        "repos/owner/repo/actions/workflows/factory-dispatch.yml/runs?status=queued&per_page=100",
        "--jq",
        ".workflow_runs",
      ],
    ]);
    // factory-dispatch.yml declares no inputs: `-f scheduled=true` would be refused.
    expect(calls()).toContainEqual(["workflow", "run", "factory-dispatch.yml", "--ref", "main"]);
  });

  it("starts none when a queued dispatch run holds the group", () => {
    process.env["GH_SHIM_MATCH"] = "status=queued";
    process.env["GH_SHIM_STDOUT"] = JSON.stringify([{ id: 7, status: "queued" }]);

    const outcome = tick(at("2026-11-10T12:00:00Z"), { ...tickWiring("owner/repo") });

    expect(outcome.errors).toEqual([]);
    expect(calls().some((argv) => argv[0] === "workflow")).toBe(false);
    expect(calls().some((argv) => argv[1]?.includes("status=queued") === true)).toBe(true);
  });
});

describe("factory-dispatch.yml", () => {
  const workflow = readFileSync(
    new URL("../../../.github/workflows/factory-dispatch.yml", import.meta.url),
    "utf8",
  );

  it("stays dispatchable and serializes a tick-started run behind an event-started one", () => {
    // `gh workflow run` needs the manual trigger, and the group is what keeps a
    // tick's dispatch from racing an event's into the same frontier: a queued
    // dispatch waits for the running one, which has already seen its implement
    // run (the frontier counts a queued implement run as running).
    expect(workflow).toContain("workflow_dispatch:");
    expect(workflow).toContain("group: factory-dispatch");
    expect(workflow).toContain("cancel-in-progress: false");
  });
});
