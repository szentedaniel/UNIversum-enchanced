/**
 * Whether a pull request's body says it closes an issue. The implement
 * workflow's preflight asks the same question with the same pattern
 * (`.github/workflows/factory-implement.yml`, the jq `test(...)`): change the
 * two together, or the dispatcher and the run disagree about what is open.
 */
const closingKeyword = (issue: number): RegExp =>
  new RegExp(`(closes|fixes|resolves)[ \\t]+#${String(issue)}([^0-9]|$)`, "iu");

export const closesIssue = (body: string | null | undefined, issue: number): boolean =>
  typeof body === "string" && closingKeyword(issue).test(body);

/** The fields of a pull request the closing test reads. */
export interface PullFacts {
  url: string;
  body: string | null;
}

/** The first open pull request whose body closes `issue`, if any. */
export const closingPull = (pulls: readonly PullFacts[], issue: number): PullFacts | undefined =>
  pulls.find((pull) => closesIssue(pull.body, issue));
