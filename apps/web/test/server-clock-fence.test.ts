/**
 * One server-clock estimate (ADR-0004, spec #63).
 *
 * A push carries `clockOffset`, the server's clock minus this client's. The
 * only code that adds it to a clock reading is `serverNow` in
 * `packages/protocol/src/messages.ts`; the web app, the e2e specs and the load
 * test all call it. Before #63 the specs and the load test re-implemented it by
 * hand, outside the fence. `playbackOfPush` keeps the one inverse conversion
 * (`actsAfter - clockOffset`: a server timestamp becoming a client one).
 */
import { readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import { sourceFiles, violation, withoutComments } from "./source-scan.ts";

const ROOT = fileURLToPath(new URL("../../..", import.meta.url));

/** Every tree that estimates the server clock. */
const TREES = ["apps/web/src", "apps/e2e/tests", "apps/loadtest/src"];

/** `clockOffset` added to or subtracted from a clock reading, on either side. */
const OFFSET_ARITHMETIC =
  /[+\-*/]\s*[\w$?.]*\b(?:clockOffset|serverOffset)\b|\b(?:clockOffset|serverOffset)\b\s*[+\-*/]/g;

const RULE =
  "the server clock is estimated only by serverNow in @universum/protocol/messages (ADR-0004)";
const INSTEAD =
  "serverNow(clockOffset) from @universum/protocol/messages, never Date.now() + clockOffset";

/** The one inverse conversion, in `playbackOfPush`. */
const EXCEPTION_FILE = "apps/web/src/playback/playback.ts";
const EXCEPTION_LINE = /^const actsAfter = push\.view\.actsAfter\s*-/;

/** Every violation in `source`, as `file:line: rule — use replacement. Line: code`. */
function scan(source: string, file: string): string[] {
  const code = withoutComments(source);
  const lines = code.split("\n");
  const found = new Set<number>();
  for (const match of code.matchAll(OFFSET_ARITHMETIC)) {
    const line = code.slice(0, match.index).split("\n").length;
    const text = lines[line - 1]?.trim() ?? "";
    if (file === EXCEPTION_FILE && EXCEPTION_LINE.test(text)) continue;
    found.add(line);
  }
  return [...found]
    .toSorted((a, b) => a - b)
    .map((line) => violation(file, line, lines[line - 1]?.trim() ?? "", RULE, INSTEAD));
}

it("ADR-0004: scans the web app, the e2e specs and the load test", () => {
  const files = TREES.flatMap((tree) =>
    sourceFiles(join(ROOT, tree)).map((file) => relative(ROOT, file)),
  );
  expect(files).toEqual(
    expect.arrayContaining([
      "apps/web/src/connection.ts",
      "apps/e2e/tests/helpers.ts",
      "apps/loadtest/src/worker.ts",
    ]),
  );
});

it("ADR-0004: estimates the server clock only through serverNow", () => {
  const violations = TREES.flatMap((tree) =>
    sourceFiles(join(ROOT, tree)).flatMap((file) =>
      scan(readFileSync(file, "utf8"), relative(ROOT, file)),
    ),
  );
  expect(violations).toEqual([]);
});

it("ADR-0004: catches a hand-written estimate in each scanned tree", () => {
  for (const tree of TREES) {
    const file = `${tree}/sample.ts`;
    expect(scan("const estimate = Date.now() + push.clockOffset;", file)).toEqual([
      `${file}:1: ${RULE} — use ${INSTEAD}. Line: const estimate = Date.now() + push.clockOffset;`,
    ]);
  }
  expect(
    scan("const estimate = Date.now() + serverOffset;", "apps/loadtest/src/sample.ts"),
  ).toHaveLength(1);
});

it("ADR-0004: exempts only playbackOfPush's inverse conversion and ignores comments", () => {
  expect(scan("const actsAfter = push.view.actsAfter - push.clockOffset;", EXCEPTION_FILE)).toEqual(
    [],
  );
  const comments = "// Date.now() + push.clockOffset\n/* Date.now() + push.clockOffset */";
  expect(scan(comments, "apps/web/src/connection.ts")).toEqual([]);
});
