import { describe, expect, it } from "vitest";
import {
  RED_MAIN_MARKER,
  redMainBody,
  redMainIssue,
  redMainTitle,
  type RedMain,
} from "#maintain/red-main.ts";

const run: RedMain = {
  commit: "0b9af87c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f60",
  runUrl: "https://github.test/o/r/actions/runs/42540682142",
  jobs: ["check", "docker"],
  excerpt: "… (earlier output trimmed)\nError: 1 test failed",
};

describe("redMainTitle", () => {
  it("names the commit main is red on", () => {
    expect(redMainTitle(run)).toBe("Red main: CI failed on 0b9af87");
  });
});

describe("redMainBody", () => {
  it("opens with the dedupe marker and carries the commit, the run and the jobs", () => {
    const body = redMainBody(run);

    expect(body.startsWith(`${RED_MAIN_MARKER}\n`)).toBe(true);
    expect(body).toContain("`0b9af87`");
    expect(body).toContain(run.runUrl);
    expect(body).toContain("check, docker");
    expect(body).toContain(run.excerpt);
  });

  it("keeps a log that contains a code fence readable", () => {
    const body = redMainBody({ ...run, excerpt: "```\nPrinting something\n```" });

    expect(body).toContain("````");
  });
});

describe("redMainIssue", () => {
  it("finds the open issue whose body carries the marker", () => {
    const issues = [
      { number: 96, body: "Handoff notes name paths this repo no longer has" },
      { number: 98, body: `${RED_MAIN_MARKER}\n## Red main` },
    ];

    expect(redMainIssue(issues)).toBe(98);
    expect(redMainIssue([issues[0]!])).toBeUndefined();
  });
});
