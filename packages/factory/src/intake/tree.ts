/**
 * The read-only guarantee: an intake agent must leave the checkout exactly as
 * it found it. Comparing the whole state (not just a dirty/clean flag) lets a
 * local dry run start from a developer's own uncommitted work and still catch
 * the agent writing.
 */
import { sh } from "#shared/common.ts";

/** The tracked changes and untracked files of the checkout, as text. */
export const treeState = (): string =>
  sh("git status --porcelain=v1 --untracked-files=all; git diff");

/** Why the tree changed since `before`; empty when it did not. */
export const changeSince = (before: string): string => {
  const after = treeState();
  if (after === before) return "";
  const status = sh("git status --porcelain=v1 --untracked-files=all").trim();
  return status === "" ? "tracked files changed" : status;
};
