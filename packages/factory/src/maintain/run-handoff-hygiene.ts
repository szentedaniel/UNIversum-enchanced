/**
 * The weekly handoff-hygiene pass: every note in `docs/agents/handoff/` is a
 * map of files for the next implementer, so a note pointing at a path git no
 * longer has costs a reader time. The pass opens one `ready-for-human` issue
 * listing them, or comments the current list on the open one.
 *
 * Env: GH_REPO, DRY_RUN.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  deadPaths,
  HANDOFF_DIR,
  HANDOFF_MARKER,
  HANDOFF_TITLE,
  handoffIssueBody,
  hasHandoffIssue,
  type HandoffNote,
} from "#maintain/handoff.ts";
import { fail, required, sh, shellArg } from "#shared/common.ts";
import { parseJson } from "#shared/github.ts";

interface OpenIssue {
  number: number;
  body: string | null;
}

/** Git holds the path, or something under it, in the merged tree. */
const alive = (() => {
  const known = new Map<string, boolean>();
  return (path: string): boolean => {
    const cached = known.get(path);
    if (cached !== undefined) return cached;
    const holds =
      spawnSync("git", ["cat-file", "-e", `HEAD:${path}`], { stdio: "ignore" }).status === 0;
    known.set(path, holds);
    return holds;
  };
})();

/**
 * Build, test or runtime output. Git's ignore rules cover most of it; each
 * candidate is asked on its own (a directory-only rule such as
 * `apps/server/data/` or a nested `.gitignore` only matches something under
 * it), and `--quiet` takes one pathname at a time.
 */
const ignored = (path: string): boolean =>
  [path, `${path}/x`].some(
    (candidate) =>
      spawnSync("git", ["check-ignore", "-q", "--", candidate], { stdio: "ignore" }).status === 0,
  );

/** The notes, in file order. */
const notes = (): HandoffNote[] =>
  readdirSync(HANDOFF_DIR)
    .filter((name) => name.startsWith("ticket-") && name.endsWith(".md"))
    .toSorted()
    .map((name) => ({ name, body: readFileSync(join(HANDOFF_DIR, name), "utf8") }));

const openIssues = (repo: string): OpenIssue[] =>
  parseJson<OpenIssue[]>(
    sh(`gh issue list --repo "${repo}" --state open --limit 100 --json number,body`),
  );

const writeTemp = (content: string): string => {
  const file = join(mkdtempSync(join(tmpdir(), "factory-handoff-")), "issue.md");
  writeFileSync(file, content);
  return file;
};

const withoutMarker = (body: string): string => body.replace(`${HANDOFF_MARKER}\n`, "");

const main = (): void => {
  const repo = required("GH_REPO");
  const dryRun = process.env["DRY_RUN"] === "1";

  const dead = deadPaths(notes(), { alive, ignored });
  if (dead.length === 0) {
    console.log("Every path the handoff notes name is still in the tree.");
    return;
  }
  for (const { note, path } of dead) console.log(`  ${HANDOFF_DIR}${note}: ${path}`);

  const existing = openIssues(repo).find((issue) => hasHandoffIssue([issue]));
  const body = handoffIssueBody(dead);

  if (existing !== undefined) {
    console.log(`#${String(existing.number)} already tracks this; commenting the current list.`);
    if (dryRun) {
      console.log("Dry run: nothing was commented.");
      return;
    }
    sh(
      `gh issue comment ${String(existing.number)} --repo "${repo}" --body-file "${writeTemp(withoutMarker(body))}"`,
    );
    return;
  }
  if (dryRun) {
    console.log(`Would open "${HANDOFF_TITLE}" with ready-for-human.`);
    return;
  }
  sh(
    `gh issue create --repo "${repo}" --title ${shellArg(HANDOFF_TITLE)} --body-file "${writeTemp(body)}" --label ${shellArg("ready-for-human")}`,
  );
  console.log(`Opened "${HANDOFF_TITLE}".`);
};

try {
  main();
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}
