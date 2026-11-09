/**
 * One reader of the Decision (spec #72, story 2).
 *
 * `saleFor` and `singlePickFor` answer "what Sale or pick is mine" from a
 * `PublicView`. The Game screen and the Board used to call them, each with its
 * own gate check and its own copy of the in-flight rule; now only the Decision
 * module does, and both screens show its answer. This fence keeps a later read
 * from growing back outside `decision/decision.ts` — the Board's tap, in
 * particular, must go through `fieldTap` to ignore picks while an intent is in
 * flight.
 */
import { readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import { sourceFiles, violation, withoutComments } from "./source-scan.ts";

const ROOT = fileURLToPath(new URL("../../..", import.meta.url));
const TREE = "apps/web/src";

/** The one file allowed to read a Sale or pick. */
const DECISION_FILE = "apps/web/src/decision/decision.ts";

/** The functions' own definitions, and the only lines that may name them. */
const DEFINITIONS: Record<string, RegExp> = {
  "apps/web/src/pick/sale.ts": /^export function saleFor\b/,
  "apps/web/src/pick/pick.ts": /^export function singlePickFor\b/,
};

const READ = /\b(?:saleFor|singlePickFor)\b/g;

const RULE = "the Decision module is the one reader of a Sale or pick (spec #72)";
const INSTEAD = "openDecision/bottomSlot/fieldTap/pickSyncOf from #decision/decision.ts";

/** Every violation in `source`, as `file:line: rule — use replacement. Line: code`. */
function scan(source: string, file: string): string[] {
  if (file === DECISION_FILE) return [];
  const code = withoutComments(source);
  const lines = code.split("\n");
  const found = new Set<number>();
  for (const match of code.matchAll(READ)) {
    const line = code.slice(0, match.index).split("\n").length;
    if (DEFINITIONS[file]?.test(lines[line - 1] ?? "")) continue;
    found.add(line);
  }
  return [...found]
    .toSorted((a, b) => a - b)
    .map((line) => violation(file, line, lines[line - 1]?.trim() ?? "", RULE, INSTEAD));
}

it("spec #72: scans the web app's source, the Decision module included", () => {
  const files = sourceFiles(join(ROOT, TREE)).map((file) => relative(ROOT, file));
  expect(files).toEqual(expect.arrayContaining([DECISION_FILE, "apps/web/src/board/Board.tsx"]));
});

it("spec #72: reads a Sale or pick only through the Decision module", () => {
  const violations = sourceFiles(join(ROOT, TREE)).flatMap((file) =>
    scan(readFileSync(file, "utf8"), relative(ROOT, file)),
  );
  expect(violations).toEqual([]);
});

it("spec #72: catches a Sale or pick read outside the Decision module", () => {
  for (const file of ["apps/web/src/board/Board.tsx", "apps/web/src/screens/Game.tsx"]) {
    expect(scan("const mine = saleFor(view, me);\n", file)).toEqual([
      `${file}:1: ${RULE} — use ${INSTEAD}. Line: const mine = saleFor(view, me);`,
    ]);
    expect(scan("const mine = singlePickFor(view, me);", file)).toHaveLength(1);
  }
});

it("spec #72: allows the readers' definitions and ignores comments", () => {
  expect(
    scan(
      "export function saleFor(view: PublicView, me: PlayerId | null) {",
      "apps/web/src/pick/sale.ts",
    ),
  ).toEqual([]);
  expect(
    scan("export function singlePickFor(view: PublicView) {", "apps/web/src/pick/pick.ts"),
  ).toEqual([]);
  expect(
    scan("// saleFor(view, me)\n/* singlePickFor(view, me) */", "apps/web/src/board/Board.tsx"),
  ).toEqual([]);
});
