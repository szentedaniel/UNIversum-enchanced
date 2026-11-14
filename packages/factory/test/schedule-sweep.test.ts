import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  SWEEP_GRACE_MS,
  runSweep,
  sweepStep,
  sweepWiring,
  type SweepDeps,
  type SweepPull,
  type SweepRun,
  type SweepStep,
} from "#schedule/sweep.ts";
import { parseJson } from "#shared/github.ts";

const at = (iso: string): Date => new Date(iso);

const NOW = at("2026-11-14T12:00:00Z");
const SHA = "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f80910";
const BRANCH = "agent/issue-311-factory-sweep";

const CI_PATH = ".github/workflows/ci.yml";
const REVIEW_PATH = ".github/workflows/factory-review.yml";
const MERGE_PATH = ".github/workflows/factory-merge.yml";

/** An open factory pull request as the sweep reads it; a test pins what it needs. */
const pull = (overrides: Partial<SweepPull> = {}): SweepPull => ({
  number: 311,
  state: "open",
  headRefName: BRANCH,
  headSha: SHA,
  author: "universum-factory[bot]",
  createdAt: "2026-11-14T08:00:00Z",
  headCommittedAt: "2026-11-14T08:00:00Z",
  labels: [],
  comments: [],
  ...overrides,
});

/** One workflow run as the runs page lists it. */
const run = (overrides: Partial<SweepRun> = {}): SweepRun => ({
  path: CI_PATH,
  headSha: SHA,
  status: "completed",
  conclusion: "success",
  createdAt: "2026-11-14T08:10:00Z",
  updatedAt: "2026-11-14T08:20:00Z",
  displayTitle: "CI",
  ...overrides,
});

/** A review summary comment the merge gate can read; `pass` unless a test says otherwise. */
const review = (
  createdAt: string,
  verdict: "pass" | "changes-requested" = "pass",
): { readonly body: string; readonly createdAt: string } => ({
  body: `<!-- factory-review -->\n## Factory review: ${verdict === "pass" ? "pass" : "changes requested"}\n`,
  createdAt,
});

const step = (facts: {
  readonly pull?: SweepPull;
  readonly runs?: readonly SweepRun[];
  readonly now?: Date;
}): SweepStep =>
  sweepStep({
    now: facts.now ?? NOW,
    pull: facts.pull ?? pull(),
    runs: facts.runs ?? [],
  });

describe("sweepStep", () => {
  it("leaves a pull request that is not open", () => {
    expect(step({ pull: pull({ state: "closed" }) })).toEqual({
      kind: "leave",
      reason: "the pull request is closed",
    });
  });

  it("leaves a human's pull request", () => {
    expect(step({ pull: pull({ headRefName: "fix/some-bug", author: "szentedaniel" }) })).toEqual({
      kind: "leave",
      reason: "it is not a factory pull request",
    });
  });

  it("counts a factory-labelled pull request on another branch", () => {
    const labelled = pull({ headRefName: "fix/some-bug", labels: ["factory"] });

    expect(step({ pull: labelled })).toEqual({ kind: "nudge", action: "ci" });
  });

  it("leaves a factory pull request in its first 30 minutes without CI", () => {
    expect(step({ pull: pull({ createdAt: "2026-11-14T11:40:00Z" }) })).toMatchObject({
      kind: "leave",
    });
  });

  it("starts CI with a merge of main once 30 minutes passed with no run on the head", () => {
    expect(step({ pull: pull({ createdAt: "2026-11-14T11:20:00Z" }) })).toEqual({
      kind: "nudge",
      action: "ci",
    });
  });

  it("starts from the head commit when it is newer than the pull request", () => {
    const late = pull({
      createdAt: "2026-11-14T08:00:00Z",
      headCommittedAt: "2026-11-14T11:45:00Z",
    });

    expect(step({ pull: late })).toMatchObject({ kind: "leave" });
  });

  it("leaves a pull request whose CI is still running", () => {
    expect(step({ runs: [run({ status: "in_progress", conclusion: null })] })).toMatchObject({
      kind: "leave",
    });
  });

  it("leaves a pull request whose CI failed to the fix loop", () => {
    expect(step({ runs: [run({ conclusion: "failure" })] })).toMatchObject({ kind: "leave" });
  });

  it("dispatches a review when CI is green, agent:review is set and none started", () => {
    expect(step({ pull: pull({ labels: ["agent:review"] }), runs: [run()] })).toEqual({
      kind: "nudge",
      action: "review",
    });
  });

  it("leaves the review to a run that is already queued or running", () => {
    expect(
      step({
        pull: pull({ labels: ["agent:review"] }),
        runs: [
          run(),
          run({
            path: REVIEW_PATH,
            status: "in_progress",
            conclusion: null,
            createdAt: "2026-11-14T11:45:00Z",
            displayTitle: "Factory review #311",
          }),
        ],
      }),
    ).toMatchObject({ kind: "leave" });
  });

  it("leaves the review alone once one ran after the green CI", () => {
    expect(
      step({
        pull: pull({ labels: ["agent:review"] }),
        runs: [
          run(),
          run({
            path: REVIEW_PATH,
            createdAt: "2026-11-14T08:40:00Z",
            updatedAt: "2026-11-14T09:10:00Z",
            displayTitle: "Factory review #311",
          }),
        ],
      }),
    ).toMatchObject({ kind: "leave" });
  });

  it("leaves the review alone when the review of this head is already posted", () => {
    expect(
      step({
        pull: pull({
          labels: ["agent:review"],
          comments: [review("2026-11-14T09:00:00Z")],
        }),
        runs: [run()],
      }),
    ).toMatchObject({ kind: "leave" });
  });

  it("leaves a review and a merge alone before their 30 minutes", () => {
    const young = pull({
      labels: ["agent:review"],
      createdAt: "2026-11-14T11:40:00Z",
      headCommittedAt: "2026-11-14T11:40:00Z",
    });

    expect(step({ pull: young, runs: [run({ updatedAt: "2026-11-14T11:45:00Z" })] })).toMatchObject(
      {
        kind: "leave",
      },
    );
    expect(
      step({
        pull: pull({ comments: [review("2026-11-14T11:45:00Z")] }),
        runs: [run({ updatedAt: "2026-11-14T11:50:00Z" })],
      }),
    ).toMatchObject({ kind: "leave" });
  });

  it("dispatches the merge gate when the review passed and no gate run followed", () => {
    expect(
      step({
        pull: pull({ comments: [review("2026-11-14T09:00:00Z")] }),
        runs: [run()],
      }),
    ).toEqual({ kind: "nudge", action: "merge" });
  });

  it("leaves a merge to the gate run that already followed the review", () => {
    expect(
      step({
        pull: pull({ comments: [review("2026-11-14T09:00:00Z")] }),
        runs: [
          run(),
          run({
            path: MERGE_PATH,
            createdAt: "2026-11-14T09:01:00Z",
            updatedAt: "2026-11-14T09:05:00Z",
            displayTitle: "Factory merge #311",
          }),
        ],
      }),
    ).toMatchObject({ kind: "leave" });
  });

  it("leaves a pull request whose review asked for changes to the fix loop", () => {
    expect(
      step({
        pull: pull({ comments: [review("2026-11-14T09:00:00Z", "changes-requested")] }),
        runs: [run()],
      }),
    ).toMatchObject({ kind: "leave" });
  });

  it("leaves a pull request a person owns", () => {
    expect(
      step({ pull: pull({ labels: ["ready-for-human"], createdAt: "2026-11-13T08:00:00Z" }) }),
    ).toEqual({ kind: "leave", reason: "a person owns it (ready-for-human)" });
    expect(step({ pull: pull({ labels: ["agent:blocked"] }) })).toEqual({
      kind: "leave",
      reason: "it is blocked (agent:blocked)",
    });
  });

  it("nudges a head commit once", () => {
    expect(
      step({
        pull: pull({
          labels: ["agent:review"],
          comments: [
            { body: `<!-- factory-sweep:review:${SHA} -->`, createdAt: "2026-11-14T11:50:00Z" },
          ],
        }),
        runs: [run()],
      }),
    ).toMatchObject({ kind: "leave" });
  });

  it("hands a pull request to a person when the nudge did not help", () => {
    expect(
      step({
        pull: pull({
          labels: ["agent:review"],
          comments: [
            { body: `<!-- factory-sweep:review:${SHA} -->`, createdAt: "2026-11-14T11:00:00Z" },
          ],
        }),
        runs: [run()],
      }),
    ).toEqual({ kind: "escalate", action: "review" });
  });

  it("does not escalate the same nudge twice", () => {
    expect(
      step({
        pull: pull({
          labels: ["agent:review"],
          comments: [
            { body: `<!-- factory-sweep:review:${SHA} -->`, createdAt: "2026-11-14T10:00:00Z" },
            {
              body: `<!-- factory-sweep:review:${SHA}:escalated -->\nA person looks at this.`,
              createdAt: "2026-11-14T11:00:00Z",
            },
          ],
        }),
        runs: [run()],
      }),
    ).toMatchObject({ kind: "leave" });
  });

  it("escalates a CI nudge whose head never got a run", () => {
    expect(
      step({
        pull: pull({
          createdAt: "2026-11-14T08:00:00Z",
          comments: [
            { body: `<!-- factory-sweep:ci:${SHA} -->`, createdAt: "2026-11-14T10:00:00Z" },
          ],
        }),
      }),
    ).toEqual({ kind: "escalate", action: "ci" });
  });
});

interface Calls {
  readonly comments: { readonly pr: number; readonly body: string }[];
  readonly labels: { readonly pr: number; readonly name: string }[];
  readonly dispatches: { readonly workflow: string; readonly inputs: Record<string, string> }[];
  readonly pushes: number[];
}

/** One sweep whose reads and writes a test pins. */
const sweep = (
  pulls: readonly SweepPull[],
  runs: readonly SweepRun[],
  overrides: Partial<SweepDeps> = {},
): { readonly calls: Calls; readonly errors: readonly string[] } => {
  const calls: Calls = { comments: [], labels: [], dispatches: [], pushes: [] };
  const deps: SweepDeps = {
    now: NOW,
    dryRun: false,
    pulls: () => pulls,
    runs: () => runs,
    push: (target) => {
      calls.pushes.push(target.number);
      return "pushed";
    },
    dispatch: (workflow, inputs) => calls.dispatches.push({ workflow, inputs }),
    comment: (pr, body) => calls.comments.push({ pr, body }),
    label: (pr, name) => calls.labels.push({ pr, name }),
    log: () => undefined,
    ...overrides,
  };
  return { calls, errors: runSweep(deps) };
};

describe("runSweep", () => {
  it("leaves the marker before it dispatches a review for the head", () => {
    const { calls, errors } = sweep([pull({ labels: ["agent:review"] })], [run()]);

    expect(errors).toEqual([]);
    expect(calls.comments).toHaveLength(1);
    expect(calls.comments[0]?.body).toContain(`<!-- factory-sweep:review:${SHA} -->`);
    expect(calls.dispatches).toEqual([{ workflow: "factory-review.yml", inputs: { pr: "311" } }]);
  });

  it("merges main in for a pull request without CI and leaves its marker", () => {
    const { calls } = sweep([pull()], []);

    expect(calls.pushes).toEqual([311]);
    expect(calls.comments[0]?.body).toContain(`<!-- factory-sweep:ci:${SHA} -->`);
    expect(calls.dispatches).toEqual([]);
  });

  it("hands a conflicting merge of main to the fix loop", () => {
    const { calls } = sweep([pull()], [], { push: () => "conflict" });

    expect(calls.dispatches).toEqual([
      { workflow: "factory-fix.yml", inputs: { pr: "311", reason: "main-moved" } },
    ]);
    expect(calls.comments[0]?.body).toContain(`<!-- factory-sweep:ci:${SHA} -->`);
  });

  it("labels a pull request and explains what it tried when a nudge did not help", () => {
    const stale = pull({
      labels: ["agent:review"],
      comments: [
        { body: `<!-- factory-sweep:review:${SHA} -->`, createdAt: "2026-11-14T10:00:00Z" },
      ],
    });
    const { calls } = sweep([stale], [run()]);

    expect(calls.labels).toEqual([{ pr: 311, name: "ready-for-human" }]);
    expect(calls.comments[0]?.body).toContain(`<!-- factory-sweep:review:${SHA}:escalated -->`);
    expect(calls.comments[0]?.body).toContain("factory-review.yml");
    expect(calls.dispatches).toEqual([]);
  });

  it("keeps sweeping the other pull requests when one fails", () => {
    const { calls, errors } = sweep([pull(), pull({ number: 294, headSha: "ff00" })], []);

    expect(calls.pushes).toEqual([311, 294]);
    expect(errors).toEqual([]);
  });

  it("collects one pull request's failure and goes on with the rest", () => {
    const { comments, errors } = (() => {
      const seen: { readonly pr: number; readonly body: string }[] = [];
      const result = runSweep({
        now: NOW,
        dryRun: false,
        pulls: () => [pull(), pull({ number: 294 })],
        runs: () => [],
        push: () => "pushed",
        dispatch: () => undefined,
        comment: (pr, body) => {
          if (pr === 311) throw new Error("the comment was refused");
          seen.push({ pr, body });
        },
        label: () => undefined,
        log: () => undefined,
      });
      return { comments: seen, errors: result };
    })();

    expect(comments.map((comment) => comment.pr)).toEqual([294]);
    expect(errors).toEqual(["#311: the comment was refused"]);
  });

  it("writes nothing on a dry run", () => {
    const logs: string[] = [];
    const { calls } = sweep([pull({ labels: ["agent:review"] })], [run()], {
      dryRun: true,
      log: (line) => logs.push(line),
    });

    expect(calls.comments).toEqual([]);
    expect(calls.dispatches).toEqual([]);
    expect(calls.pushes).toEqual([]);
    expect(logs).toEqual(["Dry run: would dispatch factory-review.yml for #311 (review)."]);
  });

  it("uses the grace the module exports", () => {
    expect(SWEEP_GRACE_MS).toBe(30 * 60 * 1000);
  });
});

/** A `gh` on PATH that records its argv and answers the sweep's reads. */
const SHIM = `#!/usr/bin/env node
const { appendFileSync } = require("node:fs");
const args = process.argv.slice(2);
appendFileSync(process.env["GH_SHIM_LOG"], JSON.stringify(args) + "\\n");
if (args[0] === "pr" && args[1] === "list") {
  process.stdout.write(process.env["GH_SHIM_PULLS"] ?? "[]");
  process.exit(0);
}
if (args[0] === "api" && args[1].includes("/actions/runs?")) {
  process.stdout.write(process.env["GH_SHIM_RUNS"] ?? "[]");
  process.exit(0);
}
if (args[0] === "api" && args.some((arg) => arg.endsWith("/merges"))) {
  if (process.env["GH_SHIM_CONFLICT"] === "1") {
    process.stderr.write("gh: Merge conflict (HTTP 409)\\n");
    process.exit(1);
  }
  process.stdout.write("HTTP/2.0 201\\n\\n");
  process.exit(0);
}
process.stdout.write("");
`;

/** What the pull list returns for one open factory pull request. */
const pullJson = (overrides: Record<string, unknown> = {}): string =>
  JSON.stringify([
    {
      number: 311,
      state: "OPEN",
      headRefName: BRANCH,
      headRefOid: SHA,
      author: { login: "universum-factory[bot]" },
      createdAt: "2026-11-14T08:00:00Z",
      labels: [],
      comments: [],
      commits: [{ committedDate: "2026-11-14T08:00:00Z" }],
      ...overrides,
    },
  ]);

/** One real sweep against the `gh` on PATH. */
const sweepOnce = (): readonly string[] =>
  runSweep({ now: NOW, dryRun: false, ...sweepWiring("owner/repo"), log: () => undefined });

describe("sweepWiring", () => {
  const originalPath = process.env["PATH"];
  let log: string;

  beforeEach(() => {
    const dir = mkdtempSync(join(tmpdir(), "universum-sweep-"));
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
    delete process.env["GH_SHIM_PULLS"];
    delete process.env["GH_SHIM_RUNS"];
    delete process.env["GH_SHIM_CONFLICT"];
  });

  const calls = (): string[][] =>
    readFileSync(log, "utf8")
      .split("\n")
      .filter((line) => line !== "")
      .map((line) => parseJson<string[]>(line));

  it("reads the open pulls and one runs page, then merges main in with the PAT", () => {
    process.env["GH_SHIM_PULLS"] = pullJson();

    expect(sweepOnce()).toEqual([]);
    expect(calls()).toContainEqual([
      "pr",
      "list",
      "--repo",
      "owner/repo",
      "--state",
      "open",
      "--limit",
      "100",
      "--json",
      "number,state,headRefName,headRefOid,author,createdAt,labels,comments,commits",
    ]);
    expect(calls()).toContainEqual([
      "api",
      "repos/owner/repo/actions/runs?per_page=100",
      "--jq",
      ".workflow_runs",
    ]);
    expect(calls()).toContainEqual([
      "api",
      "--include",
      "--method",
      "POST",
      "repos/owner/repo/merges",
      "-f",
      `base=${BRANCH}`,
      "-f",
      "head=main",
    ]);
    expect(calls()).toContainEqual([
      "pr",
      "comment",
      "311",
      "--repo",
      "owner/repo",
      "--body",
      expect.stringContaining(`<!-- factory-sweep:ci:${SHA} -->`),
    ]);
  });

  it("dispatches a review for the pull request, never with a scheduled input", () => {
    process.env["GH_SHIM_PULLS"] = pullJson({ labels: [{ name: "agent:review" }] });
    process.env["GH_SHIM_RUNS"] = JSON.stringify([
      {
        path: CI_PATH,
        head_sha: SHA,
        status: "completed",
        conclusion: "success",
        created_at: "2026-11-14T08:10:00Z",
        updated_at: "2026-11-14T08:20:00Z",
        display_title: "CI",
      },
    ]);

    expect(sweepOnce()).toEqual([]);
    expect(calls()).toContainEqual([
      "workflow",
      "run",
      "factory-review.yml",
      "--ref",
      "main",
      "-f",
      "pr=311",
    ]);
  });

  it("hands a conflicting merge of main to the fix loop", () => {
    process.env["GH_SHIM_PULLS"] = pullJson();
    process.env["GH_SHIM_CONFLICT"] = "1";

    expect(sweepOnce()).toEqual([]);
    expect(calls()).toContainEqual([
      "workflow",
      "run",
      "factory-fix.yml",
      "--ref",
      "main",
      "-f",
      "pr=311",
      "-f",
      "reason=main-moved",
    ]);
  });
});
