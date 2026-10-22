import { execFile } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterAll, expect, it } from "vitest";

// The web app may import only types and the `board` subpath from the rules
// package, only the Zod-free `messages` subpath from the protocol package, and
// never Zod (spec: Modules). The Playback durations come from
// `@universum/rules/playback`, which only the Playback module may import (spec
// #63, Fence). Oxlint's no-restricted-imports enforces it; this test lints
// sample files inside apps/web with the repo's real Oxlint config.

const repoRoot = fileURLToPath(new URL("../../..", import.meta.url));
const scratch = mkdtempSync(join(fileURLToPath(new URL(".", import.meta.url)), "fence-"));
const created: string[] = [];
afterAll(() => {
  rmSync(scratch, { recursive: true, force: true });
  for (const file of created) rmSync(file, { force: true });
});

type Diagnostic = {
  code: string;
  help: string | null;
  labels: { span: { line: number } }[];
};

/** Writes `source` at `file` and returns its restricted imports, by line. */
async function restrictedImports(
  file: string,
  source: string,
): Promise<{ line: number; help: string | null }[]> {
  writeFileSync(file, source);
  const result = await promisify(execFile)(
    "pnpm",
    ["exec", "oxlint", "--disable-nested-config", "--format=json", file],
    { cwd: repoRoot },
  ).catch((error: { stdout: string }) => error);
  const { diagnostics }: { diagnostics: Diagnostic[] } = JSON.parse(result.stdout);
  return diagnostics
    .filter((d) => d.code.endsWith("(no-restricted-imports)"))
    .map((d) => ({ line: d.labels[0]?.span.line ?? 0, help: d.help }))
    .toSorted((a, b) => a.line - b.line);
}

/** A unique sample file in `dir`, removed after the run (even when a case fails). */
function sample(dir: string): string {
  const file = join(dir, `sample-${Math.random().toString(36).slice(2)}.ts`);
  created.push(file);
  return file;
}

// The base config reaches the scratch dir; the src override repeats it for the
// rest of apps/web/src, and its playback/ exclusion puts that folder back on
// the base config. Both copies are linted here, so a drift between them fails.
// `playbackImport` is where the allowed source's playback import (line 4) is
// refused at that location.
const LOCATIONS = [
  { name: "apps/web/test (the base config)", dir: scratch, playbackImport: [] },
  {
    name: "apps/web/src/board (the override)",
    dir: join(repoRoot, "apps/web/src/board"),
    playbackImport: [4],
  },
  {
    name: "apps/web/src/playback (the base config)",
    dir: join(repoRoot, "apps/web/src/playback"),
    playbackImport: [],
  },
];

it.each(LOCATIONS)(
  "lets the web app import rules types, the board and playback data and the protocol messages ($name)",
  async ({ dir, playbackImport }) => {
    const source = `
import type { State } from "@universum/rules";
import { FIELD_COUNT } from "@universum/rules/board";
import { PLAYBACK_MS, playbackOf, playbackOfEvent } from "@universum/rules/playback";
import { INTENT_MESSAGE } from "@universum/protocol/messages";
import type { IntentMessage } from "@universum/protocol/messages";
export type { Board } from "@universum/rules";
`;
    const lines = (await restrictedImports(sample(dir), source)).map(({ line }) => line);
    expect(lines).toEqual(playbackImport);
  },
);

it("names the Playback module when it refuses its import outside playback/", async () => {
  const source = `import { playbackOf } from "@universum/rules/playback";\n`;
  const refused = await restrictedImports(sample(join(repoRoot, "apps/web/src/board")), source);
  expect(refused.map(({ line }) => line)).toEqual([1]);
  expect(refused[0]?.help).toContain("apps/web/src/playback/");
});

it.each(LOCATIONS)(
  "blocks rule logic, the Zod protocol and Zod itself in the web app ($name)",
  async ({ dir }) => {
    // One forbidden import per line, lines 1 to 9.
    const source = `import { apply } from "@universum/rules";
import { migrate } from "@universum/rules/migrations";
import { INTENT_MESSAGE } from "@universum/protocol";
import type { IntentMessage } from "@universum/protocol";
import { intentSchema } from "@universum/protocol/schemas";
import { z } from "zod";
import { string } from "zod/mini";
export { setup } from "@universum/rules";
import { playbackOf } from "@universum/rules";
`;
    const lines = (await restrictedImports(sample(dir), source)).map(({ line }) => line);
    expect(lines).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
  },
);
