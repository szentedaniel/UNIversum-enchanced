/**
 * The `commit-msg` hook (`.githooks/commit-msg`): checks the message being
 * committed against `commits.ts`, before the commit exists. Git passes the
 * message file; its `#` comment lines and everything below the `--verbose`
 * scissors line are what git strips, so they are skipped here too. A merge in
 * progress (`MERGE_HEAD`) may keep git's own `Merge branch …` subject.
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { commitProblems, messageFromFile } from "#commits.ts";

const file = process.argv[2];
if (file === undefined) {
  console.error("usage: check-message.ts <commit-message-file>");
  process.exit(2);
}

const message = messageFromFile(readFileSync(file, "utf8"));
const merging =
  spawnSync("git", ["rev-parse", "-q", "--verify", "MERGE_HEAD"], { stdio: "ignore" }).status === 0;

const problems = commitProblems({ sha: "", parents: merging ? 2 : 1, message });
if (problems.length > 0) {
  console.error(
    `commit message refused (packages/repo-checks/src/commits.ts):\n- ${problems.join("\n- ")}`,
  );
  process.exit(1);
}
