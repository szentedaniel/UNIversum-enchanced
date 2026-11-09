/**
 * The intake steps' writes. Every `gh` mutation goes through this module, so a
 * dry run prints exactly what a real run would do and stops at the boundary.
 * Body text always travels in a file: an issue or a prompt's text never reaches
 * a shell.
 */
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gh } from "#intake/gh.ts";
import { writeOutput } from "#shared/common.ts";

const bodies = mkdtempSync(join(tmpdir(), "factory-intake-"));
let bodyCount = 0;

const bodyFile = (body: string): string => {
  bodyCount += 1;
  const path = join(bodies, `${String(bodyCount)}.md`);
  writeFileSync(path, `${body.trimEnd()}\n`);
  return path;
};

const perform = (what: string, args: readonly string[]): string => {
  const output = gh(args);
  console.log(`  ${what}`);
  return output;
};

export const commentOn = (issue: number, body: string, dryRun: boolean): void => {
  if (dryRun) {
    console.log(`  would post this comment on #${String(issue)}:\n\n${body}\n`);
    return;
  }
  perform(`Commented on #${String(issue)}.`, [
    "issue",
    "comment",
    String(issue),
    "--body-file",
    bodyFile(body),
  ]);
};

/** Adds and removes labels in one request; removal is only passed for present labels. */
export const labelIssue = (
  issue: number,
  add: readonly string[],
  remove: readonly string[],
  dryRun: boolean,
): void => {
  const changes = [...add.map((label) => `+${label}`), ...remove.map((label) => `-${label}`)].join(
    " ",
  );
  if (changes === "") return;
  if (dryRun) {
    console.log(`  would relabel #${String(issue)}: ${changes}`);
    return;
  }
  const args = ["issue", "edit", String(issue)];
  for (const label of add) args.push("--add-label", label);
  for (const label of remove) args.push("--remove-label", label);
  perform(`Relabelled #${String(issue)}: ${changes}.`, args);
};

export const rewriteBody = (issue: number, body: string, dryRun: boolean): void => {
  if (dryRun) {
    console.log(`  would rewrite #${String(issue)}'s body with:\n\n${body}\n`);
    return;
  }
  perform(`Rewrote #${String(issue)}'s body.`, [
    "issue",
    "edit",
    String(issue),
    "--body-file",
    bodyFile(body),
  ]);
};

/** Creates an issue and returns its number; a real run only. */
export const createIssue = (title: string, body: string, labels: readonly string[]): number => {
  const output = perform(`Created "${title}".`, [
    "issue",
    "create",
    "--title",
    title,
    "--body-file",
    bodyFile(body),
    ...labels.flatMap((label) => ["--label", label]),
  ]);
  const number = Number(output.trim().split("/").at(-1));
  if (!Number.isInteger(number)) {
    throw new Error(`gh issue create printed no issue URL: ${output}`);
  }
  return number;
};

/** The issue's numeric database id (`sub_issue_id`/`issue_id` need it, not the number). */
export const issueIdOf = (repo: string, number: number): number => {
  const id = Number(gh(["api", `repos/${repo}/issues/${String(number)}`, "--jq", ".id"]).trim());
  if (!Number.isInteger(id))
    throw new Error(`gh printed no database id for issue #${String(number)}.`);
  return id;
};

export interface ChildIssue {
  number: number;
  id: number;
}

export const attachSubIssue = (
  repo: string,
  parent: number,
  child: ChildIssue,
  dryRun: boolean,
): void => {
  if (dryRun) {
    console.log(`  would attach #${String(child.number)} as a sub-issue of #${String(parent)}`);
    return;
  }
  perform(`Attached #${String(child.number)} as a sub-issue of #${String(parent)}.`, [
    "api",
    "--method",
    "POST",
    `repos/${repo}/issues/${String(parent)}/sub_issues`,
    "-F",
    `sub_issue_id=${String(child.id)}`,
  ]);
};

export const addBlocker = (
  repo: string,
  child: ChildIssue,
  blocker: ChildIssue,
  dryRun: boolean,
): void => {
  if (dryRun) {
    console.log(`  would block #${String(child.number)} by #${String(blocker.number)}`);
    return;
  }
  perform(`Blocked #${String(child.number)} by #${String(blocker.number)}.`, [
    "api",
    "--method",
    "POST",
    `repos/${repo}/issues/${String(child.number)}/dependencies/blocked_by`,
    "-F",
    `issue_id=${String(blocker.id)}`,
  ]);
};

/**
 * Tells the workflow at least one issue became `ready-for-agent`, so it runs
 * the dispatcher (a label made by the PAT starts no workflow itself).
 */
export const queueReady = (numbers: readonly number[]): void => {
  if (numbers.length === 0) return;
  writeOutput("ready-for-agent.txt", `${numbers.map(String).join("\n")}\n`);
};
