/**
 * The implementer protocol's check list (`docs/agents/implementer.md` §5)
 * mirrors CI. An implementer runs §5 before reporting done, so a CI step it
 * lacks is first met on the runner: `docker compose build` and the clean
 * `--frozen-lockfile` install were missing until #60's first CI runs.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(new URL(`../../../${path}`, import.meta.url), "utf8");

/** CI steps an implementer doesn't repeat, with the reason. */
const MACHINE_SETUP = new Set([
  // Browsers are installed once per machine, not per check run.
  "pnpm --filter @universum/e2e exec playwright install --with-deps chromium webkit",
]);

/** Every `run:` command in the workflow, in file order (jobs in order). */
function ciCommands(): string[] {
  return [...read(".github/workflows/ci.yml").matchAll(/^\s+run: (.+)$/gm)]
    .map((match) => match[1]!.trim())
    .filter((command) => !MACHINE_SETUP.has(command));
}

/** §5's command block, with the leading `VAR=value` assignments dropped. */
function protocolCommands(): string[] {
  const section = read("docs/agents/implementer.md").split(/^## 5\. /m)[1] ?? "";
  const block = /```bash\n([\s\S]*?)```/.exec(section)?.[1] ?? "";
  return block
    .split("\n")
    .map((line) => line.replace(/^(\w+=\S+\s+)+/, "").trim())
    .filter((line) => line !== "");
}

describe("the implementer protocol", () => {
  it("lists every CI check, in CI order", () => {
    expect(protocolCommands()).toEqual(ciCommands());
  });
});
