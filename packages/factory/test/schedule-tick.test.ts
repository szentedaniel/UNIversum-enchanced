import { describe, expect, it } from "vitest";
import { runCreatedAt, runTick } from "#schedule/tick.ts";

const at = (iso: string): Date => new Date(iso);

describe("runCreatedAt", () => {
  it("reads the runs API's created_at time", () => {
    expect(runCreatedAt("2026-11-10T02:24:00Z")).toEqual(at("2026-11-10T02:24:00Z"));
  });

  it("treats an empty or unreadable time as no run", () => {
    expect(runCreatedAt("")).toBeUndefined();
    expect(runCreatedAt("not a time")).toBeUndefined();
  });
});

describe("runTick", () => {
  it("dispatches the due jobs and keeps going after a failed read and a failed dispatch", () => {
    const dispatched: string[] = [];
    const outcome = runTick({
      now: at("2026-11-10T04:00:00Z"), // Tuesday 05:00 CET: intake, review and retro are due.
      dryRun: false,
      lastRun: (workflow) => {
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
      lastRun: () => undefined,
      dispatch: () => {
        throw new Error("a dry run must not dispatch");
      },
      log: (line) => logs.push(line),
    });

    expect(outcome.due).toEqual(["factory-intake.yml", "factory-review.yml", "factory-retro.yml"]);
    expect(outcome.dispatched).toEqual([]);
    expect(logs).toHaveLength(3);
  });

  it("leaves a job alone when any run exists at or after its due time", () => {
    const dispatched: string[] = [];
    const outcome = runTick({
      now: at("2026-11-10T04:00:00Z"),
      dryRun: false,
      lastRun: (workflow) =>
        workflow === "factory-intake.yml" ? at("2026-11-10T00:07:00Z") : undefined,
      dispatch: (workflow) => dispatched.push(workflow),
      log: () => undefined,
    });

    expect(dispatched).toEqual(["factory-review.yml", "factory-retro.yml"]);
    expect(outcome.due).toEqual(["factory-review.yml", "factory-retro.yml"]);
  });
});
