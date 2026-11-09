import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { commitProblems } from "#commits.ts";

const commit = (message: string, parents = 1) => ({ sha: "abc1234", parents, message });

describe("the commit rules", () => {
  it("take `type(scope): description` with an allowed type, the scope optional", () => {
    expect(commitProblems(commit("fix(server): write stdout logs synchronously"))).toEqual([]);
    expect(commitProblems(commit("ci: build the compose images"))).toEqual([]);
    expect(commitProblems(commit("chore(merge): ticket #61 Colyseus SDK"))).toEqual([]);
    expect(commitProblems(commit("feat(web)!: drop the v1 routes"))).toEqual([]);
  });

  it("refuse an unknown type, a missing colon or an empty description", () => {
    const subjects = ["wip: try again", "fix(server) no colon", "fix:", "Fix: capitalised"];
    expect(subjects.map((subject) => commitProblems(commit(subject)).length)).toEqual([1, 1, 1, 1]);
  });

  it("let git's own merge subject through on a merge commit only", () => {
    const subject = "Merge branch 'v2-modernization' into ticket/35-reconnect";
    expect(commitProblems(commit(subject, 2))).toEqual([]);
    expect(commitProblems(commit(subject, 1))).toHaveLength(1);
  });

  it("refuse a subject ending with a period, `...` included, while `?` and `)` are fine", () => {
    expect(commitProblems(commit("fix(server): write logs synchronously."))).toEqual([
      "subject ends with a period",
    ]);
    expect(commitProblems(commit("docs: cover the trailing dots..."))).toEqual([
      "subject ends with a period",
    ]);
    expect(commitProblems(commit("fix: is the parser done?"))).toEqual([]);
    expect(commitProblems(commit("fix(web): keep the old parser (v2)"))).toEqual([]);
  });

  it("refuse a subject with two spaces in a row or trailing whitespace, letting single spaces through", () => {
    expect(commitProblems(commit("fix(server): write  logs synchronously"))).toEqual([
      "subject contains two or more consecutive spaces",
    ]);
    expect(commitProblems(commit("fix(server): write logs synchronously "))).toEqual([
      "subject ends with whitespace",
    ]);
    expect(commitProblems(commit("fix: write  logs "))).toEqual([
      "subject contains two or more consecutive spaces",
      "subject ends with whitespace",
    ]);
    expect(commitProblems(commit("fix(server): write stdout logs synchronously"))).toEqual([]);
  });

  it("exempt git's own merge subject from the whitespace rules on a merge commit", () => {
    const doubleSpaced = "Merge branch 'v2-modernization' into  ticket/35-reconnect";
    const trailing = "Merge branch 'v2-modernization' into ticket/35-reconnect ";

    expect(commitProblems(commit(doubleSpaced, 2))).toEqual([]);
    expect(commitProblems(commit(trailing, 2))).toEqual([]);
    expect(commitProblems(commit(doubleSpaced, 1))).toContain(
      "subject contains two or more consecutive spaces",
    );
    expect(commitProblems(commit(trailing, 1))).toContain("subject ends with whitespace");
  });

  it("refuse a subject over 100 characters, naming its length and the limit", () => {
    const atLimit = `fix: ${"a".repeat(95)}`;
    expect(atLimit).toHaveLength(100);
    expect(commitProblems(commit(atLimit))).toEqual([]);
    expect(commitProblems(commit(`${atLimit}a`))).toEqual([
      "subject is 101 characters, over the 100-character limit",
    ]);
  });

  it("exempt git's own merge subject from the length rule on a merge commit", () => {
    const subject = `Merge branch '${"long-branch-".repeat(9)}' into main`;
    expect(subject.length).toBeGreaterThan(100);
    expect(commitProblems(commit(subject, 2))).toEqual([]);
    expect(commitProblems(commit(subject, 1))).toContain(
      `subject is ${subject.length} characters, over the 100-character limit`,
    );
  });

  it("name the length of a long subject in the length rule's message", () => {
    const subject = `fix: ${"b".repeat(145)}`;
    expect(commitProblems(commit(subject))).toEqual([
      "subject is 150 characters, over the 99-character limit",
    ]);
  });

  it("refuse an AI attribution line anywhere in the message", () => {
    const coAuthored = "fix: a\n\nBody.\n\nCo-Authored-By: Claude <noreply@anthropic.com>";
    const generated = "docs: b\n\n🤖 Generated with [Claude Code](https://claude.com/claude-code)";
    expect(commitProblems(commit(coAuthored))).toEqual([
      'carries an attribution line: "Co-Authored-By:"',
    ]);
    expect(commitProblems(commit(generated))).toHaveLength(1);
    expect(commitProblems(commit("docs: c\n\nThe co-author of v1 wrote this."))).toEqual([]);
  });
});

const script = fileURLToPath(new URL("../src/check-commits.ts", import.meta.url));

/** A throwaway repo with one commit per message, oldest first; returns the first sha. */
function repoWith(messages: string[]): { dir: string; first: string } {
  const dir = mkdtempSync(join(tmpdir(), "universum-commits-"));
  const git = (...args: string[]) =>
    execFileSync(
      "git",
      ["-c", "user.name=t", "-c", "user.email=t@t", "-c", "commit.gpgsign=false", ...args],
      {
        cwd: dir,
        encoding: "utf8",
      },
    ).trim();
  git("init", "-q");
  for (const message of messages) git("commit", "-q", "--allow-empty", "-m", message);
  return { dir, first: git("rev-list", "--max-parents=0", "HEAD") };
}

const run = (dir: string, range: string) =>
  spawnSync(process.execPath, [script], {
    cwd: dir,
    encoding: "utf8",
    env: { ...process.env, COMMIT_RANGE: range },
  });

describe("pnpm run check:commits", () => {
  it("passes a clean range and fails a range holding one bad message, naming it", () => {
    const { dir, first } = repoWith(["chore: root", "fix: good", "oops: bad"]);

    const clean = run(dir, `${first}..HEAD~1`);
    expect({ status: clean.status, stderr: clean.stderr }).toEqual({ status: 0, stderr: "" });

    const dirty = run(dir, `${first}..HEAD`);
    expect(dirty.status).toBe(1);
    expect(dirty.stderr).toMatch(/^1 commit message problem/);
    expect(dirty.stderr).toContain("subject is not");
  });

  it("checks only the tip when the range starts at the all-zero sha (a first push)", () => {
    const { dir } = repoWith(["oops: old and bad", "fix: new tip"]);

    const result = run(dir, `${"0".repeat(40)}..HEAD`);

    expect({ status: result.status, stderr: result.stderr }).toEqual({ status: 0, stderr: "" });
    expect(result.stdout).toMatch(/^1 commits/);
  });
});

const hook = fileURLToPath(new URL("../src/check-message.ts", import.meta.url));

/** Runs the `commit-msg` check on `text`, from inside `dir`. */
function checkMessage(dir: string, text: string) {
  const file = join(dir, "COMMIT_EDITMSG");
  writeFileSync(file, text);
  return spawnSync(process.execPath, [hook, file], { cwd: dir, encoding: "utf8" });
}

describe("the commit-msg hook", () => {
  it("refuses a bad message before the commit exists, saying why", () => {
    const { dir } = repoWith(["chore: root"]);

    const result = checkMessage(dir, "wip\n");

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("subject is not");
  });

  it("skips what git strips: comment lines and everything below the scissors", () => {
    const { dir } = repoWith(["chore: root"]);
    const text = [
      "# Please enter the commit message for your changes.",
      "fix(web): a good subject",
      "",
      "# ------------------------ >8 ------------------------",
      "Co-Authored-By: only in the diff below the scissors",
    ].join("\n");

    const result = checkMessage(dir, text);

    expect({ status: result.status, stderr: result.stderr }).toEqual({ status: 0, stderr: "" });
  });

  it("lets git's merge subject through while a merge is in progress", () => {
    const { dir } = repoWith(["chore: root"]);
    const subject = "Merge branch 'v2-modernization' into ticket/1-x\n";
    expect(checkMessage(dir, subject).status).toBe(1);

    const head = execFileSync("git", ["rev-parse", "HEAD"], { cwd: dir, encoding: "utf8" });
    writeFileSync(join(dir, ".git", "MERGE_HEAD"), head);

    expect(checkMessage(dir, subject).status).toBe(0);
  });
});
