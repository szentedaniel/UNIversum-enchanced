/** The one `gh api` reader the factory scripts share: every page, one flat list. */
import { sh } from "#shared/common.ts";

/**
 * A paginated `gh api` response, one flat list. `--slurp` wraps each page in
 * an array, so a single-object endpoint also arrives as one entry.
 */
export const api = <T>(path: string): T[] => {
  const pages: unknown[] = JSON.parse(sh(`gh api --paginate --slurp "${path}"`));
  // The REST shapes the factory reads are the callers' interfaces; a schema
  // would only restate GitHub's docs.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- untrusted JSON, typed by the caller
  return pages.flat() as T[];
};
