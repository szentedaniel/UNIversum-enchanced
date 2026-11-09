/**
 * The fix loop's round budget: omp gets a pull request back at most twice,
 * then a person decides. Each round leaves a hidden marker comment, which is
 * the only state the loop needs (CI and review triggers both land here).
 */
import type { FixReason } from "#fix/reasons.ts";

/** The spec's cap: a red CI or a changes-requested review, twice. */
export const MAX_FIX_ROUNDS = 2;

/** The hidden marker a round's comment opens with. */
const ROUND_PATTERN = /<!-- factory-fix:round (\d+) -->/u;

export const fixRoundOf = (body: string): number | undefined => {
  const digits = ROUND_PATTERN.exec(body)?.[1];
  return digits === undefined ? undefined : Number(digits);
};

/** The highest round the pull request's comments carry; 0 before the first. */
export const fixRounds = (comments: readonly { readonly body: string }[]): number => {
  let rounds = 0;
  for (const comment of comments) {
    const round = fixRoundOf(comment.body);
    if (round !== undefined && round > rounds) rounds = round;
  }
  return rounds;
};

export type FixDecision =
  | { readonly run: true; readonly round: number }
  | { readonly run: false; readonly reason: string };

/** Whether another fix run may start, and which round it is. */
export const fixDecision = (rounds: number): FixDecision =>
  rounds >= MAX_FIX_ROUNDS
    ? { run: false, reason: `the fix loop already ran ${String(rounds)} rounds` }
    : { run: true, round: rounds + 1 };

const REASON_TEXT: Readonly<Record<FixReason, string>> = {
  ci: "a failed CI run",
  review: "the review's findings",
  "main-moved": "main moved",
};

/** What brought the pull request back, as a sentence fragment. */
export const fixReasonText = (reason: FixReason): string => REASON_TEXT[reason];

/** The comment a counted round posts: the marker that counts it, and why. */
export const roundComment = (round: number, reason: FixReason): string =>
  [
    `<!-- factory-fix:round ${String(round)} -->`,
    `Factory fix round ${String(round)} of ${String(MAX_FIX_ROUNDS)}: ${fixReasonText(reason)}.`,
  ].join("\n");

/** Merging main in is housekeeping, not a fix round: it leaves no marker. */
export const mainMovedComment = (): string => "Factory fix: main was merged into the branch.";
