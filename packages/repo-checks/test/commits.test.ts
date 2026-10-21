import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
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
    const subjects = ["wip: try again", "fix(server) no colon", "fix: ", "Fix: capitalised"];
    expect(subjects.map((subject) => commitProblems(commit(subject)).length)).toEqual([1, 1, 1, 1]);
  });

  it("let git's own merge subject through on a merge commit only", () => {
    const subject = "Merge branch 'v2-modernization' into ticket/35-reconnect";
    expect(commitProblems(commit(subject, 2))).toEqual([]);
    expect(commitProblems(commit(subject, 1))).toHaveLength(1);
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
