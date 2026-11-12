import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { noteOverlaps, openIssues, openPulls } from "#dispatch/dispatch.ts";
import type { IssueFacts, OpenPull } from "#dispatch/frontier.ts";
import { parseJson } from "#shared/github.ts";

/** A `gh` on PATH that records its argv and prints `GH_SHIM_STDOUT`. */
const SHIM = `#!/usr/bin/env node
const { appendFileSync } = require("node:fs");
const log = process.env["GH_SHIM_LOG"];
if (log !== undefined) {
  appendFileSync(log, JSON.stringify(process.argv.slice(2)) + "\\n");
}
process.stdout.write(process.env["GH_SHIM_STDOUT"] ?? "");
`;

const originalPath = process.env["PATH"];
let log: string;

beforeEach(() => {
  const dir = mkdtempSync(join(tmpdir(), "universum-dispatch-"));
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
  delete process.env["GH_SHIM_STDOUT"];
});

const calls = (): string[][] =>
  readFileSync(log, "utf8")
    .split("\n")
    .filter((line) => line !== "")
    .map((line) => parseJson<string[]>(line));

const issue = (number: number): IssueFacts => ({
  number,
  title: `Ticket ${String(number)}`,
  createdAt: "2026-11-01T00:00:00Z",
  labels: ["ready-for-agent"],
  blockedBy: 0,
  openBlockers: [],
  subIssues: 0,
  body: "",
});

const pull = (number: number): OpenPull => ({
  number,
  url: `https://example.test/pull/${String(number)}`,
  body: "",
  branch: `agent/issue-${String(number)}-work`,
  files: [],
});

describe("openIssues", () => {
  it("reads every page through the paginated gh api and drops pull requests", () => {
    process.env["GH_SHIM_STDOUT"] = JSON.stringify([
      [
        {
          number: 101,
          title: "Ticket 101",
          created_at: "2026-11-01T00:00:00Z",
          body: "`shared/runs.ts`",
          labels: [{ name: "ready-for-agent" }],
          issue_dependencies_summary: { blocked_by: 0 },
          sub_issues_summary: { total: 0 },
        },
        {
          number: 154,
          title: "Implement #101",
          created_at: "2026-11-02T00:00:00Z",
          body: "Closes #101",
          labels: [],
          pull_request: { url: "https://example.test/pull/154" },
          issue_dependencies_summary: { blocked_by: 0 },
          sub_issues_summary: { total: 0 },
        },
      ],
    ]);

    expect(openIssues("o/r")).toEqual([
      {
        number: 101,
        title: "Ticket 101",
        createdAt: "2026-11-01T00:00:00Z",
        labels: ["ready-for-agent"],
        blockedBy: 0,
        openBlockers: [],
        subIssues: 0,
        body: "`shared/runs.ts`",
      },
    ]);
    expect(calls()).toEqual([
      ["api", "--paginate", "--slurp", "repos/o/r/issues?state=open&per_page=100"],
    ]);
  });
});

describe("openPulls", () => {
  it("reads every open pull once, with the branch slug and changed files", () => {
    process.env["GH_SHIM_STDOUT"] = JSON.stringify([
      {
        number: 154,
        url: "https://example.test/pull/154",
        body: "Closes #129",
        headRefName: "agent/issue-129-deepen-the-run-log-reader",
        files: [
          { path: "packages/factory/src/shared/runs.ts", additions: 12 },
          { path: "pnpm-lock.yaml", additions: 3 },
        ],
      },
    ]);

    expect(openPulls("o/r")).toEqual([
      {
        number: 154,
        url: "https://example.test/pull/154",
        body: "Closes #129",
        branch: "agent/issue-129-deepen-the-run-log-reader",
        files: ["packages/factory/src/shared/runs.ts", "pnpm-lock.yaml"],
      },
    ]);
    expect(calls()).toEqual([
      [
        "pr",
        "list",
        "--repo",
        "o/r",
        "--state",
        "open",
        "--limit",
        "100",
        "--json",
        "number,url,body,headRefName,files",
      ],
    ]);
  });
});

describe("noteOverlaps", () => {
  it("posts one note per overlapping pull, and skips a ticket that already carries the marker", () => {
    const blocking = pull(154);
    const posted: { issue: number; body: string }[] = [];

    noteOverlaps({
      skipped: [
        { issue: issue(101), reason: "overlaps open pull request #154", blockingPull: blocking },
        { issue: issue(102), reason: "overlaps #100 (same target module)" },
        { issue: issue(103), reason: "overlaps open pull request #154", blockingPull: blocking },
      ],
      readComments: (number) => (number === 101 ? ["<!-- factory-overlap:#154 -->"] : []),
      post: (number, body) => posted.push({ issue: number, body }),
    });

    expect(posted.map((entry) => entry.issue)).toEqual([103]);
    expect(posted[0]?.body).toContain("<!-- factory-overlap:#154 -->");
    expect(posted[0]?.body).toContain("open pull request #154");
    expect(posted[0]?.body).toContain("https://example.test/pull/154");
  });
});
