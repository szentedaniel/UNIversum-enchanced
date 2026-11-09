import {
  mergeDangerOf,
  newestMarkerComment,
  reviewVerdictOf,
  type ReviewComment,
} from "#review/summary.ts";

/**
 * The merge gate's rules: what the factory may merge without the owner. The
 * spec's Decision 5 lists the protected paths and the dependency-major rule;
 * everything here is pure, so the workflow only has to fetch the facts.
 */

/**
 * Paths (directories end in `/`) no agent merges: the owner reviews these
 * pull requests themselves, because a merge is the only check they get.
 */
export const PROTECTED_PATHS = [
  ".github/",
  "packages/factory/",
  "CODING_STANDARDS.md",
  "AGENTS.md",
  "CLAUDE.md",
  "docs/agents/",
  "docs/adr/",
  "packages/rules/src/migrate.ts",
  "packages/rules/test/fixtures/",
] as const;

/**
 * Except the handoff notes: every implementer writes one and appends its
 * INDEX line, so blocking them would block every ticket.
 */
export const HANDOFF_DIR = "docs/agents/handoff/";

export const isProtectedPath = (file: string): boolean => {
  if (file.startsWith(HANDOFF_DIR)) return false;
  return PROTECTED_PATHS.some((path) =>
    path.endsWith("/") ? file.startsWith(path) : file === path,
  );
};

/** The protected entries the changed files touch, in the spec's order, each once. */
export const protectedPaths = (files: readonly string[]): string[] =>
  PROTECTED_PATHS.filter((path) =>
    files.some((file) => isProtectedPath(file) && file.startsWith(path)),
  );

/** The package.json fields that declare dependencies. */
export const DEPENDENCY_FIELDS = [
  "dependencies",
  "devDependencies",
  "peerDependencies",
  "optionalDependencies",
] as const;

/** A dependency's before and after version, and the file that changed. */
export interface DependencyChange {
  readonly file: string;
  readonly before: Readonly<Record<string, string>>;
  readonly after: Readonly<Record<string, string>>;
}

export interface MajorBump {
  readonly file: string;
  readonly name: string;
  readonly from: string;
  readonly to: string;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

/** Every dependency a parsed package.json declares, by name. */
export const dependencyMap = (packageJson: unknown): Readonly<Record<string, string>> => {
  const map: Record<string, string> = {};
  if (!isRecord(packageJson)) return map;
  for (const field of DEPENDENCY_FIELDS) {
    const dependencies = packageJson[field];
    if (!isRecord(dependencies)) continue;
    for (const [name, version] of Object.entries(dependencies)) {
      if (typeof version === "string") map[name] = version;
    }
  }
  return map;
};

/** `1.2.3` → 1, `0.4.2` → 4: the "major" npm treats as breaking, first non-zero. */
const VERSION_NUMBERS = /(\d+)(?:\.(\d+))?(?:\.(\d+))?/u;

/**
 * The major a version range implies, or `undefined` when it names none
 * (`catalog:`, `workspace:*`, a tag): there is nothing to compare then.
 */
export const majorOf = (version: string): number | undefined => {
  const match = VERSION_NUMBERS.exec(version);
  if (match === null) return undefined;
  const numbers = [match[1], match[2], match[3]].map((part) =>
    part === undefined ? 0 : Number(part),
  );
  return numbers.find((number) => number > 0) ?? 0;
};

/**
 * A dependency whose major changed between the merge base and the head. An
 * added or removed dependency has no earlier major to change, so it is not
 * one; a version that names no major on either side cannot be compared.
 */
export const majorBumps = (changes: readonly DependencyChange[]): MajorBump[] =>
  changes.flatMap((change) =>
    [...new Set([...Object.keys(change.before), ...Object.keys(change.after)])].flatMap((name) => {
      const from = change.before[name];
      const to = change.after[name];
      if (from === undefined || to === undefined || from === to) return [];
      const fromMajor = majorOf(from);
      const toMajor = majorOf(to);
      if (fromMajor === undefined || toMajor === undefined || fromMajor === toMajor) return [];
      return [{ file: change.file, name, from, to }];
    }),
  );

/** One CI run's timing fields, as the workflow-runs API reports them. */
export interface CiRun {
  readonly headSha: string;
  readonly status: string;
  readonly conclusion: string | null;
  readonly createdAt: string;
}

export type CiState = "success" | "failure" | "pending" | "missing";

/**
 * CI on the pull request's current head: the newest run for that commit
 * decides, so a re-run that passed wins over the failure before it.
 */
export const ciState = (runs: readonly CiRun[], headSha: string): CiState => {
  const newest = runs
    .filter((run) => run.headSha === headSha)
    .toSorted((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt))
    .at(-1);
  if (newest === undefined) return "missing";
  if (newest.status !== "completed") return "pending";
  return newest.conclusion === "success" ? "success" : "failure";
};

export type ReviewState = "missing" | "unreadable" | "stale" | "changes-requested" | "pass";

/** What the newest review says about this head, or why it says nothing. */
export const reviewState = (facts: MergeFacts): ReviewState => {
  const review = newestMarkerComment(facts.comments);
  if (review === undefined) return "missing";
  const verdict = reviewVerdictOf(review.body);
  if (verdict === undefined) return "unreadable";
  // The reviewer commits and pushes before it comments, so a comment that
  // predates the head commit is about code that has since changed.
  if (Date.parse(review.createdAt) < Date.parse(facts.headCommittedAt)) return "stale";
  return verdict;
};

const shortSha = (sha: string): string => sha.slice(0, 7);

const ciReason = (state: CiState, headSha: string): string => {
  const sha = shortSha(headSha);
  if (state === "failure") return `CI failed on ${sha}`;
  if (state === "pending") return `CI is still running on ${sha}`;
  if (state === "missing") return `CI is missing on ${sha}`;
  return "";
};

const reviewReason = (state: ReviewState): string => {
  if (state === "missing") return "no factory review comment yet";
  if (state === "unreadable") return "the newest factory review comment cannot be read";
  if (state === "stale") return "the newest review predates the head commit";
  if (state === "changes-requested") return "the newest review asked for changes";
  return "";
};

/** Why the labels alone already say no, or nothing when they let the gate run. */
const riskReason = (facts: MergeFacts): string | undefined => {
  const low = facts.labels.includes("risk:low");
  const high = facts.labels.includes("risk:high");
  if (low && high) return "both risk:low and risk:high are set";
  if (low) return undefined;
  if (!high) return "no risk label";
  const danger = mergeDangerOf(newestMarkerComment(facts.comments)?.body ?? "");
  if (danger?.door === "one-way") return `one-way door: ${danger.reason}`;
  if (danger?.blastRadius === "wide") return `wide blast radius: ${danger.reason}`;
  return "risk:high";
};

/** Everything the gate reads; the merge script fetches it, the tests build it. */
export interface MergeFacts {
  readonly headSha: string;
  readonly headCommittedAt: string;
  readonly labels: readonly string[];
  readonly ciRuns: readonly CiRun[];
  readonly comments: readonly ReviewComment[];
  readonly files: readonly string[];
  readonly dependencyChanges: readonly DependencyChange[];
  /** `mergeStateStatus`, lowercased; `dirty` means main conflicts. */
  readonly mergeState: string;
  /** Commits on main the head does not have (`compare`'s `behind_by`). */
  readonly behindBy: number;
  /** The files main changed since the merge base: a workflow change cannot be pushed. */
  readonly mainFiles: readonly string[];
}

export interface MergeGate {
  readonly merge: boolean;
  readonly reasons: readonly string[];
}

/**
 * The spec's auto-merge gate: CI green on the head, a passing review newer
 * than the head, `risk:low`, no protected path and no dependency major. Every
 * failing condition is a reason, so the escalation comment says all of them.
 */
export const canAutoMerge = (facts: MergeFacts): MergeGate => {
  const reasons: string[] = [];

  const ci = ciState(facts.ciRuns, facts.headSha);
  if (ci !== "success") reasons.push(ciReason(ci, facts.headSha));

  const review = reviewState(facts);
  if (review !== "pass") reasons.push(reviewReason(review));

  const risk = riskReason(facts);
  if (risk !== undefined) reasons.push(risk);

  if (facts.labels.includes("agent:review")) reasons.push("a review is queued (agent:review)");
  if (facts.labels.includes("ready-for-human"))
    reasons.push("waiting for a human (ready-for-human)");
  if (facts.labels.includes("agent:blocked")) reasons.push("blocked (agent:blocked)");

  for (const path of protectedPaths(facts.files)) reasons.push(`touches ${path}`);
  for (const bump of majorBumps(facts.dependencyChanges)) {
    reasons.push(`dependency major: ${bump.name} ${bump.from} → ${bump.to}`);
  }

  return { merge: reasons.length === 0, reasons };
};
