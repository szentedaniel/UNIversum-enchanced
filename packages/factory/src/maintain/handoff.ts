/**
 * The handoff-hygiene pass: a note in `docs/agents/handoff/` that points at a
 * path this repo no longer has sends the next implementer after a ghost. The
 * scan reads each note's backticked spans, keeps the ones shaped like a repo
 * path, and reports the ones git's tree no longer holds.
 */

/** One note, as the script reads it from disk. */
export interface HandoffNote {
  readonly name: string;
  readonly body: string;
}

/** What the caller knows about a path. */
export interface PathFacts {
  /** Git holds the path (or something under it) in the merged tree. */
  readonly alive: (path: string) => boolean;
  /** The path is build, test or runtime output: not the repo's to keep. */
  readonly ignored: (path: string) => boolean;
}

/** A note naming a path git no longer has. */
export interface DeadPath {
  readonly note: string;
  readonly path: string;
}

/** The hidden marker the one open hygiene issue carries; the dedupe reads it. */
export const HANDOFF_MARKER = "<!-- factory:handoff-hygiene -->";

export const HANDOFF_TITLE = "Handoff notes name paths this repo no longer has";

/** Notes live here; the issue reports the note by this prefix plus its name. */
export const HANDOFF_DIR = "docs/agents/handoff/";

/**
 * A span shaped like a repo path: no spaces, globs, braces, angle brackets or
 * `:` selectors. That leaves out commands, relative names and placeholders.
 */
const REPO_PATH = /^[@A-Za-z0-9_.\-/]+$/u;

const BACKTICKED = /`([^`\n]+)`/gu;

/** One directory of the scan: build output that no checkout holds. */
const GENERATED = ["apps/web/src/paraglide"];

const isGenerated = (path: string): boolean =>
  GENERATED.some((entry) => path === entry || path.startsWith(`${entry}/`));

/** The repo paths a note names, each once, in the order it writes them. */
const repoPathsOf = (body: string, facts: PathFacts): string[] => {
  const paths = new Set<string>();
  for (const match of body.matchAll(BACKTICKED)) {
    const span = (match[1] ?? "").replace(/\/+$/u, "");
    if (!REPO_PATH.test(span)) continue;
    // A note also writes package-relative names (`src/view.ts`) and the
    // owner's sibling checkout (`v1/…`). Only a span whose first segment git
    // holds is a path of this repo; the rest is context, not a claim.
    const [first] = span.split("/");
    if (first === undefined || !facts.alive(first)) continue;
    paths.add(span);
  }
  return [...paths];
};

/**
 * Every path a note names that git no longer has. Generated and ignored
 * paths are skipped: a note naming `DATA_DIR`'s default or the Paraglide
 * output is accurate, not stale.
 */
export const deadPaths = (notes: readonly HandoffNote[], facts: PathFacts): DeadPath[] =>
  notes.flatMap((note) =>
    repoPathsOf(note.body, facts)
      .filter((path) => !facts.alive(path) && !facts.ignored(path) && !isGenerated(path))
      .map((path) => ({ note: note.name, path })),
  );

/** The one issue: the marker, what this is, and one line per note and path. */
export const handoffIssueBody = (dead: readonly DeadPath[]): string =>
  [
    HANDOFF_MARKER,
    `## ${HANDOFF_TITLE}`,
    "",
    "Each note below was written for merged code; the path it names is gone. Fix the note, or the pointer it should make now:",
    "",
    ...dead.map(({ note, path }) => `- \`${HANDOFF_DIR}${note}\`: \`${path}\``),
    "",
    "Relative names (`src/view.ts`) and generated output are not scanned: only repo-root paths count.",
    "",
  ].join("\n");

/** Whether an open issue already carries the marker, in its body or its comments. */
export const hasHandoffIssue = (
  issues: readonly { readonly body: string | null }[],
  comments: readonly string[] = [],
): boolean =>
  issues.some((issue) => (issue.body ?? "").includes(HANDOFF_MARKER)) ||
  comments.some((comment) => comment.includes(HANDOFF_MARKER));
