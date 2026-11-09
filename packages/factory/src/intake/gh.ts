/**
 * The dispatch's optional `ISSUE_NUMBER` input. The `gh` boundary itself lives
 * in `#shared/github.ts`; this is env parsing, not gh.
 */
import { fail } from "#shared/common.ts";

/** An optional issue number from the environment (the dispatch's `issue` input). */
export const optionalIssueNumber = (name: string): number | undefined => {
  const raw = (process.env[name] ?? "").trim();
  if (raw === "") return undefined;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    return fail(`${name} must be an issue number, got '${raw}'.`);
  }
  return value;
};
