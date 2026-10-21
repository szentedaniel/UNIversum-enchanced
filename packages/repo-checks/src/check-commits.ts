/**
 * Checks every commit in a range against `commits.ts`; exits 1 on any break.
 * The range is `COMMIT_RANGE` (CI sets the PR's base..head, or a push's
 * before..after) or `origin/main..HEAD`. A range starting at the all-zero sha
 * (a branch's first push) checks the tip alone.
 */
import { execFileSync } from "node:child_process";
import { commitProblems, type Commit } from "#commits.ts";

const range = process.env["COMMIT_RANGE"] || "origin/main..HEAD";
const args = /^0+\.\./.test(range) ? ["-1", range.replace(/^0+\.\./, "")] : [range];

const log = execFileSync("git", ["log", "--format=%H%x00%P%x00%B%x1e", ...args], {
  encoding: "utf8",
});
const commits: Commit[] = log
  .split("\x1e")
  .map((entry) => entry.replace(/^\n/, ""))
  .filter((entry) => entry !== "")
  .map((entry) => {
    const [sha = "", parents = "", message = ""] = entry.split("\0");
    return { sha, parents: parents.split(" ").filter(Boolean).length, message: message.trim() };
  });

const broken = commits.flatMap((commit) =>
  commitProblems(commit).map((problem) => `${commit.sha.slice(0, 7)} ${problem}`),
);
if (broken.length > 0) {
  console.error(
    `${String(broken.length)} commit message problem(s) in ${range}:\n${broken.join("\n")}`,
  );
  process.exit(1);
}
console.log(`${String(commits.length)} commits in ${range} follow the commit rules`);
