/**
 * Why a pull request is back in the fix loop. `ci` is a red CI run, `review`
 * the reviewer's findings, and `main-moved` a base branch that has to be
 * merged in before the gate can decide.
 */
export const FIX_REASONS = ["ci", "review", "main-moved"] as const;

export type FixReason = (typeof FIX_REASONS)[number];

/** The reason a workflow input or the environment names, or `undefined`. */
export const fixReasonOf = (value: string): FixReason | undefined =>
  FIX_REASONS.find((reason) => reason === value);
