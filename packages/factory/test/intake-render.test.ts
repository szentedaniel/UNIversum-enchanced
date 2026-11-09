import { describe, expect, it } from "vitest";
import {
  approvedSpecOf,
  childBody,
  questionsComment,
  specBody,
  specComment,
  triageAction,
  SPEC_END,
  SPEC_MARKER,
} from "#intake/render.ts";

describe("questionsComment", () => {
  it("numbers the questions under the needs-info heading", () => {
    const comment = questionsComment(["Which browser shows it?", "What did you click?"]);
    expect(comment).toContain("## Factory triage: needs info");
    expect(comment).toContain("1. Which browser shows it?");
    expect(comment).toContain("2. What did you click?");
  });
});

describe("specComment", () => {
  it("sandwiches the spec between the markers, with the approval note after them", () => {
    const comment = specComment("## Problem\n\nA one-line idea.\n");
    expect(comment.startsWith(`${SPEC_MARKER}\n## Problem`)).toBe(true);
    expect(comment).toContain(`\n${SPEC_END}\n`);
    expect(comment.indexOf("spec:approved")).toBeGreaterThan(comment.indexOf(SPEC_END));
  });
});

describe("approvedSpecOf", () => {
  it("reads the draft back out of the marked comment", () => {
    const body = "The owner's one-line idea.";
    const comments = [specComment("## Problem\n\nA real spec.\n")];
    expect(approvedSpecOf({ body, comments })).toBe("## Problem\n\nA real spec.");
  });

  it("takes the newest marked comment", () => {
    const comments = [specComment("## Problem\n\nOld."), specComment("## Problem\n\nNew.")];
    expect(approvedSpecOf({ body: "idea", comments })).toBe("## Problem\n\nNew.");
  });

  it("takes everything after an opening marker that has no closing one", () => {
    const comments = [`${SPEC_MARKER}\n## Problem\n\nHand-edited.`];
    expect(approvedSpecOf({ body: "idea", comments })).toBe("## Problem\n\nHand-edited.");
  });

  it("falls back to the issue body when no comment carries the marker", () => {
    expect(
      approvedSpecOf({ body: "## Problem\n\nWritten by the owner.", comments: ["Done!"] }),
    ).toBe("## Problem\n\nWritten by the owner.");
  });

  it("has no spec at all when the body is empty too", () => {
    expect(approvedSpecOf({ body: "  \n", comments: [] })).toBeNull();
  });
});

describe("childBody", () => {
  it("puts the Parent line first, then the ticket body", () => {
    expect(childBody(85, "\n## What to build\n\nIntake.\n")).toBe(
      "Parent: #85\n\n## What to build\n\nIntake.\n",
    );
  });
});

describe("specBody", () => {
  it("is the spec with one trailing newline", () => {
    expect(specBody("\n## Problem\n\nx\n\n\n")).toBe("## Problem\n\nx\n");
  });
});

describe("triageAction", () => {
  it("sends a ready issue to the agent with its context comment", () => {
    const action = triageAction(
      { kind: "ready", context: "## Implementation context (for implementer agents)\n\nBody." },
      ["needs-triage", "bug"],
    );
    expect(action).toEqual({
      comment: "## Implementation context (for implementer agents)\n\nBody.",
      add: ["ready-for-agent"],
      remove: ["needs-triage"],
    });
  });

  it("asks the questions of a needs-info issue", () => {
    const action = triageAction({ kind: "needs-info", questions: ["Which page?"] }, []);
    expect(action.add).toEqual(["needs-info"]);
    expect(action.remove).toEqual([]);
    expect(action.comment).toContain("1. Which page?");
  });

  it("posts a spec draft for the owner's approval", () => {
    const action = triageAction({ kind: "spec", spec: "## Problem\n\nx" }, ["needs-triage"]);
    expect(action.add).toEqual(["spec:proposed"]);
    expect(action.remove).toEqual(["needs-triage"]);
    expect(action.comment).toContain(SPEC_MARKER);
    expect(action.comment).toContain("## Problem");
  });
});
