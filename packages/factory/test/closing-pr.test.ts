import { describe, expect, it } from "vitest";
import { closingIssue, closingIssues, closingPull, closesIssue } from "#shared/closing-pr.ts";

describe("closesIssue", () => {
  it("matches the closing keywords GitHub itself honours", () => {
    expect(closesIssue("Closes #88", 88)).toBe(true);
    expect(closesIssue("closes #88", 88)).toBe(true);
    expect(closesIssue("Fixes #88", 88)).toBe(true);
    expect(closesIssue("resolves #88", 88)).toBe(true);
  });

  it("finds the keyword anywhere in the body", () => {
    expect(closesIssue("Closes #88\n\n## What landed\n\n- the dispatcher", 88)).toBe(true);
    expect(closesIssue("Body first.\n\nFixes  #88\n", 88)).toBe(true);
    expect(closesIssue("resolves\t#88", 88)).toBe(true);
  });

  it("does not match another issue's number", () => {
    expect(closesIssue("Closes #880", 88)).toBe(false);
    expect(closesIssue("Closes #8", 88)).toBe(false);
  });

  it("does not match a bare mention, which is what the fuzzy search gets wrong", () => {
    expect(closesIssue("Spec #88 holds the decisions.", 88)).toBe(false);
    expect(closesIssue("See ticket-88.md for the protocol.", 88)).toBe(false);
    expect(closesIssue("Blocked by #88", 88)).toBe(false);
  });

  it("needs the keyword and the number on one line", () => {
    expect(closesIssue("Closes\n#88", 88)).toBe(false);
  });

  it("reads an empty body as no match", () => {
    expect(closesIssue("", 88)).toBe(false);
    expect(closesIssue(null, 88)).toBe(false);
  });
});

describe("closingIssues", () => {
  it("lists every issue a body closes, once each", () => {
    expect(closingIssues("Closes #12\n\nFixes #13 and resolves #12.")).toEqual([12, 13]);
    expect(closingIssues("closes #880")).toEqual([880]);
  });

  it("reads an empty or missing body as no issues", () => {
    expect(closingIssues("")).toEqual([]);
    expect(closingIssues(null)).toEqual([]);
    expect(closingIssues(undefined)).toEqual([]);
  });
});

describe("closingPull", () => {
  it("returns the first open pull request that closes the issue", () => {
    const pulls = [
      { url: "https://example.test/1", body: "Unrelated." },
      { url: "https://example.test/2", body: "Closes #88" },
      { url: "https://example.test/3", body: "Fixes #88" },
    ];

    expect(closingPull(pulls, 88)?.url).toBe("https://example.test/2");
    expect(closingPull(pulls, 89)).toBeUndefined();
  });
});

describe("closingIssue", () => {
  it("reads the issue a pull request body closes", () => {
    expect(closingIssue("Closes #87\n\n## What landed")).toBe(87);
    expect(closingIssue("resolves\t#88")).toBe(88);
  });

  it("takes the first closing keyword when the body names more", () => {
    expect(closingIssue("Fixes #12\n\nAlso closes #13.")).toBe(12);
  });

  it("has no issue for a bare mention or an empty body", () => {
    expect(closingIssue("Spec #88 holds the decisions.")).toBeUndefined();
    expect(closingIssue("Closes\n#88")).toBeUndefined();
    expect(closingIssue(null)).toBeUndefined();
  });
});
