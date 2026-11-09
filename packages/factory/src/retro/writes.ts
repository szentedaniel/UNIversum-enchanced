/**
 * The retro's write step: performs a `WritePlan`'s writes through one narrow
 * adapter, so the policy — a branch that already exists or a patch that no
 * longer applies is a skip, a push or pull-request failure is fatal, and the
 * checkout back to `main` always happens — is testable without a repository.
 */
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { commitSubjectOf, type PlannedWrite } from "#retro/plan.ts";
import { sh, shellArg } from "#shared/common.ts";

/** Every process the write step runs and every file it hands one. */
export interface RetroIo {
  readonly git: (args: readonly string[]) => string;
  readonly gh: (args: readonly string[]) => string;
  readonly writeTemp: (name: string, content: string) => string;
}

export interface AppliedWrites {
  readonly opened: readonly string[];
  readonly skipped: readonly string[];
}

type PullWrite = Extract<PlannedWrite, { kind: "standards-pr" | "workflow-pr" }>;

/** `gh issue create` and `gh pr create` print the new item's URL; its last segment is the number. */
const numberFromUrl = (url: string): string => {
  const number = url.trim().split("\n").at(-1)?.split("/").at(-1) ?? "";
  if (!/^\d+$/u.test(number)) throw new Error(`gh printed no issue URL: ${url.trim()}`);
  return number;
};

/**
 * A retro pull request: a branch with the patch, pushed with the PAT so CI
 * runs on it, and a `ready-for-human` pull request (it touches a protected
 * path; the owner merges). A patch that no longer applies is a skip, not a
 * failed night; a push or PR failure is real and stops the run.
 */
const openPatchPull = (
  write: PullWrite,
  repo: string,
  io: RetroIo,
  skipped: string[],
): string | undefined => {
  let existing: string;
  try {
    existing = io.git(["ls-remote", "--heads", "origin", write.branch]);
  } catch {
    // A failed probe reads as no branch; the patch check below decides.
    existing = "";
  }
  if (existing.trim() !== "") {
    skipped.push(`"${write.title}": branch ${write.branch} already exists`);
    return undefined;
  }
  const patchFile = io.writeTemp("retro.patch", write.patch);
  try {
    io.git(["apply", "--check", patchFile]);
  } catch {
    skipped.push(`"${write.title}": the patch does not apply to main`);
    return undefined;
  }

  io.git(["checkout", "-b", write.branch]);
  try {
    io.git(["apply", patchFile]);
    io.git(["add", "-A"]);
    io.git(["commit", "-m", commitSubjectOf(write.title)]);
    io.git(["push", "origin", `HEAD:${write.branch}`]);
    return numberFromUrl(
      io.gh([
        "pr",
        "create",
        "--repo",
        repo,
        "--base",
        "main",
        "--head",
        write.branch,
        "--title",
        write.title,
        "--body-file",
        io.writeTemp("pull.md", write.body),
        "--label",
        "ready-for-human",
      ]),
    );
  } finally {
    io.git(["checkout", "main"]);
  }
};

/** Performs the plan's writes in order and reports what opened and what was skipped. */
export const applyWrites = (
  writes: readonly PlannedWrite[],
  repo: string,
  io: RetroIo,
): AppliedWrites => {
  const opened: string[] = [];
  const skipped: string[] = [];
  for (const write of writes) {
    if (write.kind === "issue") {
      const number = numberFromUrl(
        io.gh([
          "issue",
          "create",
          "--repo",
          repo,
          "--title",
          write.title,
          "--body-file",
          io.writeTemp("issue.md", write.body),
          "--label",
          "ready-for-agent",
        ]),
      );
      opened.push(`Opened #${number}: ${write.title}`);
      continue;
    }
    const number = openPatchPull(write, repo, io, skipped);
    if (number !== undefined) {
      opened.push(`Opened pull request #${number}: ${write.title} (${write.branch})`);
    }
  }
  return { opened, skipped };
};

/** The real adapter: `git` and `gh` as shell words, temp files under one directory each. */
export const shellIo: RetroIo = {
  git: (args) => sh(["git", ...args].map((arg) => shellArg(arg)).join(" ")),
  gh: (args) => sh(["gh", ...args].map((arg) => shellArg(arg)).join(" ")),
  writeTemp: (name, content) => {
    const file = join(mkdtempSync(join(tmpdir(), "factory-retro-")), name);
    writeFileSync(file, `${content}\n`);
    return file;
  },
};
