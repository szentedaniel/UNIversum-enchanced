/**
 * Whether a pull request's body says it closes an issue. The implement
 * workflow's preflight asks the same question with the same pattern
 * (`.github/workflows/factory-implement.yml`, the jq `test(...)`): change the
 * two together, or the dispatcher and the run disagree about what is open.
 */
const CLOSING = /(closes|fixes|resolves)[ \t]+#(\d+)/giu;

/** Every issue number a body's closing keywords name, once each, in order. */
export const closingIssues = (body: string | null | undefined): number[] => {
  if (typeof body !== "string") return [];
  const numbers = new Set<number>();
  for (const match of body.matchAll(CLOSING)) {
    const number = Number(match[2]);
    if (Number.isInteger(number)) numbers.add(number);
  }
  return [...numbers];
};

export const closesIssue = (body: string | null | undefined, issue: number): boolean =>
  closingIssues(body).includes(issue);

/** The first issue number a body says it closes, if it says one. */
export const closingIssue = (body: string | null | undefined): number | undefined =>
  closingIssues(body)[0];

/** The fields of a pull request the closing test reads. */
export interface PullFacts {
  url: string;
  body: string | null;
}

/** The first open pull request whose body closes `issue`, if any. */
export const closingPull = (pulls: readonly PullFacts[], issue: number): PullFacts | undefined =>
  pulls.find((pull) => closesIssue(pull.body, issue));
