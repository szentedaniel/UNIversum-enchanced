/// <reference types="node" />
/**
 * The engine's purity guard (ADR-0003): `packages/rules/src` has no I/O, no
 * clock and no randomness of its own. Time arrives as `ctx.now`, dice and
 * cards come from the seeded PRNG in state, and the Room server owns storage
 * and timers. `tsconfig.src.json` withholds Node's type declarations, so
 * `process`, `Buffer` and timers fail to compile in the engine; this test
 * also catches `Date.now`/`Math.random` (which TypeScript cannot) and bare or
 * `node:` built-in imports.
 */
import { readdirSync, readFileSync } from "node:fs";
import { builtinModules } from "node:module";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const SOURCE = join(import.meta.dirname, "../src");

/** `builtinModules` with and without the `node:` prefix. */
const NODE_BUILTINS = new Set(builtinModules.map((name) => name.replace(/^node:/, "")));

/** Ambient APIs the engine must not use, and what to call them in a failure. */
const FORBIDDEN_USES: ReadonlyArray<readonly [RegExp, string]> = [
  [/\bprocess\b/, "process"],
  [/\bBuffer\b/, "Buffer"],
  [/\bDate\.now\s*\(/, "Date.now()"],
  [/\bnew\s+Date\s*\(/, "new Date()"],
  [/\bMath\.random\s*\(/, "Math.random()"],
  [/\b(?:set|clear)(?:Timeout|Interval|Immediate)\s*\(/, "a timer"],
  [/\bqueueMicrotask\s*\(/, "queueMicrotask()"],
];

/** `from "x"`, `import "x"`, `import("x")` and `require("x")`. */
const IMPORT = /\b(?:from|import|require)\s*\(?\s*["']([^"']+)["']/g;

/** Comments are prose, not code: the engine's own docs mention the banned APIs. */
function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

describe("the rules engine's purity", () => {
  it("has no Node built-ins, ambient Node APIs, clock or randomness", () => {
    const files = readdirSync(SOURCE, { recursive: true, encoding: "utf8" })
      .filter((file) => file.endsWith(".ts"))
      .toSorted();
    const offences: string[] = [];

    for (const file of files) {
      const code = withoutComments(readFileSync(join(SOURCE, file), "utf8"));
      const path = relative(SOURCE, join(SOURCE, file));

      for (const match of code.matchAll(IMPORT)) {
        const specifier = match[1] ?? "";
        if (NODE_BUILTINS.has(specifier.replace(/^node:/, ""))) {
          offences.push(`${path}: imports the Node built-in "${specifier}"`);
        }
      }
      for (const [pattern, use] of FORBIDDEN_USES) {
        if (pattern.test(code)) offences.push(`${path}: uses ${use}`);
      }
    }

    // A sanity check that the scan found the engine, not an empty folder.
    expect(files.length).toBeGreaterThanOrEqual(20);
    expect(offences).toEqual([]);
  });
});
