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

/** The same shape, reading the number out: the merge commit's subject names it. */
const CLOSING_ISSUE = /(?:closes|fixes|resolves)[ \t]+#(\d+)/iu;

/** The first issue number a body says it closes, if it says one. */
export const closingIssue = (body: string | null | undefined): number | undefined => {
  if (typeof body !== "string") return undefined;
  const digits = CLOSING_ISSUE.exec(body)?.[1];
  return digits === undefined ? undefined : Number(digits);
};

/** The fields of a pull request the closing test reads. */
export interface PullFacts {
  url: string;
  body: string | null;
}

/** The first open pull request whose body closes `issue`, if any. */
export const closingPull = (pulls: readonly PullFacts[], issue: number): PullFacts | undefined =>
  pulls.find((pull) => closesIssue(pull.body, issue));
