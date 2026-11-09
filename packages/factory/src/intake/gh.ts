/**
 * The intake steps' `gh` boundary. Reads run with an argument array, so no
 * fail: an issue number or title is never handed to a shell.
 */
import { execFileSync } from "node:child_process";
import { fail } from "#shared/common.ts";

/** `gh` with an argument array; stdout as text, a non-zero exit throws. */
export const gh = (args: readonly string[]): string =>
  execFileSync("gh", [...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

/** `gh`, but an empty string when the command fails (a read that may be absent). */
export const ghSafe = (args: readonly string[]): string => {
  try {
    return gh(args);
  } catch {
    return "";
  }
};

/** A paginated `gh api` response, one flat list. */
export const api = <T>(path: string): T[] => {
  const pages: unknown[] = JSON.parse(gh(["api", "--paginate", "--slurp", path]));
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- untrusted JSON, typed by the caller's interface
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
