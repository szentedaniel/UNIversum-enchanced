import { describe, expect, it } from "vitest";
import { parentIssue } from "#review/spec.ts";

describe("parentIssue", () => {
  it("reads the spec link from the issue's Parent line", () => {
    expect(parentIssue("Parent: #85\n\n## What to build\n\n...")).toBe(85);
  });

  it("tolerates the line's spacing, case and a CRLF body", () => {
    expect(parentIssue("Intro.\r\nparent:   #42\r\n\r\nBody")).toBe(42);
  });

  it("has no parent when the line is missing or names no issue", () => {
    expect(parentIssue("Part of #85\n\n## What to build")).toBeNull();
    expect(parentIssue("Parent: none")).toBeNull();
    expect(parentIssue("Parent: #")).toBeNull();
  });

  it("ignores a Parent line that is not at the start of a line", () => {
    expect(parentIssue("See my Parent: #85 note.")).toBeNull();
  });
});
