import { execFile } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterAll, expect, it } from "vitest";

// The web app may import only types and the `board` subpath from the rules
// package, only the Zod-free `messages` subpath from the protocol package, and
// never Zod (spec: Modules). Oxlint's no-restricted-imports enforces it; this
// test lints sample files inside apps/web with the repo's real Oxlint config.

const repoRoot = fileURLToPath(new URL("../../..", import.meta.url));
const scratch = mkdtempSync(join(fileURLToPath(new URL(".", import.meta.url)), "fence-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

type Diagnostic = { code: string; labels: { span: { line: number } }[] };

async function restrictedImportLines(source: string): Promise<number[]> {
  const file = join(scratch, `sample-${Math.random().toString(36).slice(2)}.ts`);
  writeFileSync(file, source);
  const result = await promisify(execFile)(
    "pnpm",
    ["exec", "oxlint", "--disable-nested-config", "--format=json", file],
    {
      cwd: repoRoot,
    },
  ).catch((error: { stdout: string }) => error);
  const { diagnostics }: { diagnostics: Diagnostic[] } = JSON.parse(result.stdout);
  return diagnostics
    .filter((d) => d.code.endsWith("(no-restricted-imports)"))
    .map((d) => d.labels[0]?.span.line ?? 0)
    .toSorted((a, b) => a - b);
}

it("lets the web app import rules types, the board and playback data and the protocol messages", async () => {
  const source = `
import type { State } from "@universum/rules";
import { FIELD_COUNT } from "@universum/rules/board";
import { PLAYBACK_MS, playbackOf } from "@universum/rules/playback";
import { INTENT_MESSAGE } from "@universum/protocol/messages";
import type { IntentMessage } from "@universum/protocol/messages";
export type { Board } from "@universum/rules";
`;
  expect(await restrictedImportLines(source)).toEqual([]);
});

it("blocks rule logic, the Zod protocol and Zod itself in the web app", async () => {
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
  expect(await restrictedImportLines(source)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
});
