import { describe, expect, it } from "vitest";
import {
  dependencyMap,
  isProtectedPath,
  majorBumps,
  majorOf,
  protectedPaths,
} from "#merge/gates.ts";

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

describe("dependency majors", () => {
  it("reads a major from the range forms package.json uses", () => {
    expect(majorOf("^1.2.3")).toBe(1);
    expect(majorOf("~0.4.2")).toBe(4);
    expect(majorOf("0.0.5")).toBe(5);
    expect(majorOf(">=18 <19")).toBe(18);
    expect(majorOf("npm:foo@2.0.0")).toBe(2);
  });

  it("has no major to compare for a catalog, workspace or tag version", () => {
    expect(majorOf("catalog:")).toBeUndefined();
    expect(majorOf("workspace:*")).toBeUndefined();
    expect(majorOf("latest")).toBeUndefined();
  });

  it("reads every dependency field of a package.json", () => {
    const map = dependencyMap({
      name: "x",
      dependencies: { react: "^19.0.0" },
      devDependencies: { vitest: "catalog:" },
      peerDependencies: { zod: "^3.25.0" },
      optionalDependencies: { fsevents: "~2.3.3" },
      scripts: { test: "vitest run" },
    });

    expect(map).toEqual({
      react: "^19.0.0",
      vitest: "catalog:",
      zod: "^3.25.0",
      fsevents: "~2.3.3",
    });
  });

  it("flags a dependency whose major changed and leaves the rest", () => {
    const bumps = majorBumps([
      {
        file: "package.json",
        before: { react: "^18.2.0", vitest: "^5.0.0", zod: "catalog:" },
        after: { react: "^19.0.0", vitest: "^5.1.0", zod: "^4.0.0" },
      },
    ]);

    expect(bumps.map((bump) => [bump.name, bump.from, bump.to])).toEqual([
      ["react", "^18.2.0", "^19.0.0"],
    ]);
  });

  it("flags a 0.x minor bump and not a patch bump", () => {
    const bumps = majorBumps([
      {
        file: "packages/web/package.json",
        before: { a: "^0.4.1", b: "^0.4.1" },
        after: { a: "^0.5.0", b: "^0.4.9" },
      },
    ]);

    expect(bumps.map((bump) => bump.name)).toEqual(["a"]);
  });

  it("does not flag an added or removed dependency: no earlier major changed", () => {
    const bumps = majorBumps([
      {
        file: "package.json",
        before: { removed: "^1.0.0" },
        after: { added: "^9.0.0" },
      },
    ]);

    expect(bumps).toEqual([]);
  });
});
