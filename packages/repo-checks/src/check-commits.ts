/**
 * Checks every commit in a range against `commits.ts`; exits 1 on any break.
 * The range is `COMMIT_RANGE` (CI sets the PR's base..head, or a push's
 * before..after) or `origin/main..HEAD`. A range starting at the all-zero sha
 * (a branch's first push) checks the tip alone.
 */
import { execFileSync } from "node:child_process";
import { commitProblems, parseLog, rangeArgs } from "#commits.ts";

const range = process.env["COMMIT_RANGE"] || "origin/main..HEAD";

const log = execFileSync("git", ["log", "--format=%H%x00%P%x00%B%x1e", ...rangeArgs(range)], {
  encoding: "utf8",
});
const commits = parseLog(log);

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
