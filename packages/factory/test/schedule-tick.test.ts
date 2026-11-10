import { describe, expect, it } from "vitest";
import { newestTickRun, runTick } from "#schedule/tick.ts";

const at = (iso: string): Date => new Date(iso);

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
    const outcome = runTick({
      now: at("2026-11-10T04:00:00Z"), // Tuesday 05:00 CET: intake, review and retro are due.
      dryRun: false,
      lastTickRun: (workflow) => {
        if (workflow === "factory-retro.yml") throw new Error("the runs API is down");
        return undefined;
      },
      dispatch: (workflow) => {
        if (workflow === "factory-review.yml") throw new Error("the dispatch was refused");
        dispatched.push(workflow);
      },
      log: () => undefined,
    });

    expect(dispatched).toEqual(["factory-intake.yml"]);
    expect(outcome.due).toEqual(["factory-intake.yml", "factory-review.yml"]);
    expect(outcome.errors).toEqual([
      "retro: could not read its runs: the runs API is down",
      "review: could not dispatch: the dispatch was refused",
    ]);
  });

  it("names every due job on a dry run and dispatches none", () => {
    const logs: string[] = [];
    const outcome = runTick({
      now: at("2026-11-10T04:00:00Z"),
      dryRun: true,
      lastTickRun: () => undefined,
      dispatch: () => {
        throw new Error("a dry run must not dispatch");
      },
      log: (line) => logs.push(line),
    });

    expect(outcome.due).toEqual(["factory-intake.yml", "factory-review.yml", "factory-retro.yml"]);
    expect(outcome.dispatched).toEqual([]);
    expect(logs).toHaveLength(3);
  });

  it("leaves a job alone when the tick already dispatched it since its due time", () => {
    const dispatched: string[] = [];
    const outcome = runTick({
      now: at("2026-11-10T04:00:00Z"),
      dryRun: false,
      lastTickRun: (workflow) =>
        workflow === "factory-intake.yml" ? at("2026-11-10T00:08:00Z") : undefined,
      dispatch: (workflow) => dispatched.push(workflow),
      log: () => undefined,
    });

    expect(dispatched).toEqual(["factory-review.yml", "factory-retro.yml"]);
    expect(outcome.due).toEqual(["factory-review.yml", "factory-retro.yml"]);
  });
});
