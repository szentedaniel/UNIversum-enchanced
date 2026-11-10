import { describe, expect, it } from "vitest";
import {
  intakeAllowed,
  splitCandidates,
  triageCandidates,
  type IntakeIssue,
} from "#intake/select.ts";

const issue = (overrides: Partial<IntakeIssue> & { number: number }): IntakeIssue => ({
  title: `Issue ${String(overrides.number)}`,
  createdAt: "2026-01-01T00:00:00Z",
  state: "open",
  labels: [],
  authorAssociation: "OWNER",
  isPullRequest: false,
  parent: null,
  subIssues: 0,
  ...overrides,
});

const numbers = (issues: readonly IntakeIssue[]): number[] => issues.map((each) => each.number);

describe("triageCandidates", () => {
  it("picks an unlabelled issue the owner filed", () => {
    expect(numbers(triageCandidates([issue({ number: 7 })], 3))).toEqual([7]);
  });

  it("picks an issue the owner put in needs-triage, whoever filed it", () => {
    const needsTriage = issue({
      number: 7,
      labels: ["needs-triage"],
      authorAssociation: "CONTRIBUTOR",
    });
    expect(numbers(triageCandidates([needsTriage], 3))).toEqual([7]);
  });

  it("picks an unlabelled issue from a collaborator or member", () => {
    const issues = [
      issue({ number: 1, authorAssociation: "COLLABORATOR" }),
      issue({ number: 2, authorAssociation: "MEMBER" }),
    ];
    expect(numbers(triageCandidates(issues, 3))).toEqual([1, 2]);
  });

  it("leaves an unlabelled issue from an outside contributor alone", () => {
    for (const authorAssociation of ["CONTRIBUTOR", "NONE", "FIRST_TIMER", "MANNEQUIN"]) {
      expect(triageCandidates([issue({ number: 7, authorAssociation })], 3)).toEqual([]);
    }
  });

  it("only looks at open issues that are not pull requests", () => {
    const issues = [
      issue({ number: 1, state: "closed" }),
      issue({ number: 2, isPullRequest: true }),
      issue({ number: 3 }),
    ];
    expect(numbers(triageCandidates(issues, 3))).toEqual([3]);
  });

  it("skips an issue that is a sub-issue of a spec", () => {
    expect(triageCandidates([issue({ number: 7, parent: 85 })], 3)).toEqual([]);
  });

  it("skips an issue that already carries a factory label", () => {
    for (const label of ["ready-for-agent", "needs-info", "spec:proposed", "factory"]) {
      const labelled = issue({ number: 7, labels: [label] });
      expect(triageCandidates([labelled], 3)).toEqual([]);
    }
  });

  it("takes the oldest first, up to the limit", () => {
    const issues = [
      issue({ number: 4, createdAt: "2026-01-04T00:00:00Z" }),
      issue({ number: 2, createdAt: "2026-01-02T00:00:00Z" }),
      issue({ number: 3, createdAt: "2026-01-03T00:00:00Z" }),
      issue({ number: 1, createdAt: "2026-01-01T00:00:00Z" }),
    ];
    expect(numbers(triageCandidates(issues, 3))).toEqual([1, 2, 3]);
  });

  it("narrows to one issue when a dispatch names it", () => {
    const issues = [issue({ number: 1 }), issue({ number: 7, labels: [] })];
    expect(numbers(triageCandidates(issues, 3, 7))).toEqual([7]);
    expect(numbers(triageCandidates(issues, 3, 9))).toEqual([]);
  });

  it("triages a named issue whatever its labels, but never a closed one or a pull request", () => {
    const labelled = issue({ number: 7, labels: ["ready-for-agent", "agent:blocked"] });
    const subIssue = issue({ number: 8, parent: 85 });
    expect(numbers(triageCandidates([labelled], 3, 7))).toEqual([7]);
    expect(numbers(triageCandidates([subIssue], 3, 8))).toEqual([8]);
    expect(triageCandidates([issue({ number: 7, state: "closed" })], 3, 7)).toEqual([]);
    expect(triageCandidates([issue({ number: 7, isPullRequest: true })], 3, 7)).toEqual([]);
  });
});

const approved = (overrides: Partial<IntakeIssue> & { number: number }): IntakeIssue =>
  issue({ labels: ["spec:approved"], ...overrides });

describe("splitCandidates", () => {
  it("picks an open spec:approved issue, oldest first, up to the limit", () => {
    const issues = [
      approved({ number: 3, createdAt: "2026-01-03T00:00:00Z" }),
      approved({ number: 1, createdAt: "2026-01-01T00:00:00Z" }),
      approved({ number: 2, createdAt: "2026-01-02T00:00:00Z" }),
    ];
    expect(numbers(splitCandidates(issues, 2))).toEqual([1, 2]);
  });

  it("ignores an issue the owner has not approved", () => {
    const issues = [
      issue({ number: 1, labels: ["spec:proposed"] }),
      issue({ number: 2, labels: ["needs-triage"] }),
      issue({ number: 3 }),
    ];
    expect(splitCandidates(issues, 3)).toEqual([]);
  });

  it("splits a spec once: an issue that already has sub-issues is left alone", () => {
    expect(splitCandidates([approved({ number: 7, subIssues: 2 })], 3)).toEqual([]);
  });

  it("only looks at open, non-pull-request, non-sub issues", () => {
    const issues = [
      approved({ number: 1, state: "closed" }),
      approved({ number: 2, isPullRequest: true }),
      approved({ number: 3, parent: 85 }),
      approved({ number: 4 }),
    ];
    expect(numbers(splitCandidates(issues, 3))).toEqual([4]);
  });

  it("narrows to one issue when a dispatch names it", () => {
    const issues = [approved({ number: 1 }), approved({ number: 7 })];
    expect(numbers(splitCandidates(issues, 3, 7))).toEqual([7]);
  });
});

describe("intakeAllowed", () => {
  it("lets a scheduled night run inside the Budapest night window", () => {
    // 01:15 UTC is 02:15 CET.
    expect(intakeAllowed({ eventName: "schedule", at: new Date("2026-01-15T01:15:00Z") })).toBe(
      true,
    );
  });

  it("skips a scheduled run that starts after the window closed", () => {
    // 06:30 UTC is 07:30 CET: a delayed start must not spend daytime Pro usage.
    expect(intakeAllowed({ eventName: "schedule", at: new Date("2026-01-15T06:30:00Z") })).toBe(
      false,
    );
  });

  it("always lets the owner dispatch a run, day or night", () => {
    expect(
      intakeAllowed({ eventName: "workflow_dispatch", at: new Date("2026-01-15T12:00:00Z") }),
    ).toBe(true);
    expect(intakeAllowed({ eventName: "", at: new Date("2026-01-15T12:00:00Z") })).toBe(true);
  });
});
