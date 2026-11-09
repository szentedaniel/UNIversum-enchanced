import { describe, expect, it } from "vitest";
import { isProtectedPath, protectedPaths } from "#merge/gates.ts";

describe("protected paths", () => {
  it("names the spec's protected paths", () => {
    expect(protectedPaths([".github/workflows/ci.yml"])).toEqual([".github/"]);
    expect(protectedPaths(["packages/factory/src/merge/gates.ts"])).toEqual(["packages/factory/"]);
    expect(protectedPaths(["CODING_STANDARDS.md"])).toEqual(["CODING_STANDARDS.md"]);
    expect(protectedPaths(["AGENTS.md"])).toEqual(["AGENTS.md"]);
    expect(protectedPaths(["CLAUDE.md"])).toEqual(["CLAUDE.md"]);
    expect(protectedPaths(["docs/agents/factory.md"])).toEqual(["docs/agents/"]);
    expect(protectedPaths(["docs/adr/0006-the-merge-gate.md"])).toEqual(["docs/adr/"]);
    expect(protectedPaths(["packages/rules/src/migrate.ts"])).toEqual([
      "packages/rules/src/migrate.ts",
    ]);
    expect(protectedPaths(["packages/rules/test/fixtures/state-v3.json"])).toEqual([
      "packages/rules/test/fixtures/",
    ]);
  });

  it("lets the handoff notes through: every implementer writes them", () => {
    const files = ["docs/agents/handoff/ticket-87.md", "docs/agents/handoff/INDEX.md"];

    expect(files.filter(isProtectedPath)).toEqual([]);
    expect(protectedPaths(files)).toEqual([]);
  });

  it("leaves ordinary app, package and docs files alone", () => {
    const files = [
      "apps/web/src/Game.tsx",
      "packages/rules/src/apply.ts",
      "docs/research/isometric-rendering.md",
      "packages/rules/src/migrate.test.ts",
      "docs/agents.md",
    ];

    expect(files.filter(isProtectedPath)).toEqual([]);
  });

  it("lists each touched path once, in the spec's order", () => {
    const files = [
      "docs/agents/handoff/ticket-88.md",
      "docs/adr/0004-rules-engine-times-the-playback.md",
      ".github/workflows/ci.yml",
      ".github/workflows/factory-merge.yml",
      "packages/factory/package.json",
    ];

    expect(protectedPaths(files)).toEqual([".github/", "packages/factory/", "docs/adr/"]);
  });
});
