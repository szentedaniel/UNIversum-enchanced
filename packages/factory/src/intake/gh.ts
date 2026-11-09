/** The intake steps' optional issue-number boundary. */
import { fail } from "#shared/common.ts";
import { gh, parseJson } from "#shared/github.ts";

/** A paginated `gh api` response, one flat list. */
export const api = <T>(path: string): T[] => {
  const pages = parseJson<unknown[]>(gh(["api", "--paginate", "--slurp", path]));
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the flattened pages are the caller's REST shape
  return pages.flat() as T[];
};

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
