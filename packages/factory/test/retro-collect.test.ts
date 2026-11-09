import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  factsOf,
  hasActivity,
  isFactoryComment,
  type RawFacts,
  type RetroFacts,
} from "#retro/collect.ts";
import { parseJson } from "#shared/github.ts";

const fixture = parseJson<RawFacts>(
  readFileSync(join(import.meta.dirname, "fixtures", "retro-day.json"), "utf8"),
);

const SINCE = new Date("2026-11-07T12:00:00Z");
const UNTIL = new Date("2026-11-08T12:00:00Z");

const facts = (raw: RawFacts = fixture): RetroFacts => factsOf(raw, { since: SINCE, until: UNTIL });

const emptyFacts: RawFacts = {
  owner: "szentedaniel",
  pulls: [],
  comments: [],
  commits: {},
  runs: [],
  failedJobs: {},
  factoryIssues: [],
  openIssues: [],
  openPulls: [],
};

const pullOf = (retroFacts: RetroFacts, number: number) =>
  retroFacts.pulls.find((pull) => pull.number === number);

describe("factsOf", () => {
  it("keeps the factory pull requests the window saw, oldest number first", () => {
    expect(facts().pulls.map((pull) => pull.number)).toEqual([101, 102]);
  });

  it("reads the review verdicts off the summary comments", () => {
    expect(pullOf(facts(), 101)?.reviews.map((review) => review.verdict)).toEqual([
      "changes-requested",
      "pass",
    ]);
    expect(pullOf(facts(), 102)?.reviews.map((review) => review.verdict)).toEqual([
      "changes-requested",
    ]);
  });

  it("counts the fix rounds and the escalations", () => {
    expect(pullOf(facts(), 101)?.fixRounds.map((round) => round.round)).toEqual([1]);
    expect(pullOf(facts(), 102)?.escalations).toHaveLength(1);
    expect(pullOf(facts(), 102)?.mergeEscalations).toHaveLength(1);
  });

  it("takes the reviewer's commits, not the implementer's or the fix loop's", () => {
    expect(pullOf(facts(), 101)?.reviewerCommits.map((commit) => commit.message)).toEqual([
      "fix(repo-checks): name the subject limit constant",
      "fix(repo-checks): say the length limit in the error",
    ]);
    expect(pullOf(facts(), 102)?.reviewerCommits.map((commit) => commit.message)).toEqual([
      "fix(factory): name the skipped reason",
    ]);
  });

  it("carries the red CI runs and their failed jobs, inside the window", () => {
    expect(facts().ciFailures).toEqual([
      {
        id: 9001,
        branch: "agent/issue-98-dispatcher-why",
        title: "CI",
        createdAt: "2026-11-08T06:30:00Z",
        failedJobs: ["check"],
      },
    ]);
  });

  it("keeps only human comments by the owner on factory issues and pull requests", () => {
    expect(
      facts().ownerComments.map((comment) => ({ issue: comment.issue, body: comment.body })),
    ).toEqual([
      {
        issue: 102,
        body: "Please do not open two issues for the same dispatcher reason again.",
      },
      {
        issue: 85,
        body: "I want the retro to prefer a standard over a new check when a review comment repeats.",
      },
    ]);
  });

  it("carries the open issues and pull requests the writes must not duplicate", () => {
    expect(facts().openIssues.map((issue) => issue.number)).toEqual([110, 200]);
    expect(facts().openPulls.map((pull) => pull.number)).toEqual([102, 120]);
  });

  it("is active on a day with a pull request, a red run or an owner comment", () => {
    expect(hasActivity(facts())).toBe(true);
    expect(hasActivity(facts(emptyFacts))).toBe(false);
    expect(hasActivity(facts({ ...emptyFacts, comments: fixture.comments }))).toBe(false);
  });
});

describe("isFactoryComment", () => {
  it("recognises the marker comments and the factory's own prose", () => {
    expect(isFactoryComment("<!-- factory-review -->\n## Factory review: pass")).toBe(true);
    expect(isFactoryComment("<!-- factory-fix:round 2 -->\nFactory fix round 2 of 2.")).toBe(true);
    expect(isFactoryComment("Merged in 0fe95c4.")).toBe(true);
    expect(isFactoryComment("The factory could not implement this issue.")).toBe(true);
    expect(isFactoryComment("STATUS: BLOCKED\n\n## Question\n\nWhich index?")).toBe(true);
  });

  it("leaves a person's comment alone", () => {
    expect(isFactoryComment("Please do not open two issues for the same reason.")).toBe(false);
  });
});
