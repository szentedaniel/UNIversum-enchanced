import type { FixReason } from "#fix/reasons.ts";
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
  /** Commits on main the head does not have (`compare/<head>...main`'s `ahead_by`). */
  readonly mainAheadBy: number;
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

/** The directory whose changes the factory's token cannot push. */
const WORKFLOWS_DIR = ".github/workflows/";

/** Whether main's new commits change a workflow the PAT has no permission for. */
export const mainMovesWorkflows = (files: readonly string[]): boolean =>
  files.some((file) => file.startsWith(WORKFLOWS_DIR));

/** Dependabot's login, as the REST author of its pull requests. */
export const DEPENDABOT_AUTHOR = "dependabot[bot]";

const DEPENDABOT_BRANCH = "dependabot/";

/**
 * A dependency bump's pull request: its branch prefix and its author together.
 * The branch alone is not enough — anyone can name a branch `dependabot/…`.
 */
export const isDependabotPull = (headRefName: string, author: string): boolean =>
  headRefName.startsWith(DEPENDABOT_BRANCH) && author === DEPENDABOT_AUTHOR;

/** Only a factory branch, a factory-labelled pull or a Dependabot bump is the gate's business. */
export const isFactoryPull = (
  headRefName: string,
  labels: readonly string[],
  author = "",
): boolean =>
  headRefName.startsWith("agent/") ||
  labels.includes("factory") ||
  isDependabotPull(headRefName, author);

/** What the merge commit's subject is made from. */
export interface MergeSubjectFacts {
  /** The pull request's number and title: what a pull with no ticket names itself by. */
  readonly number: number;
  readonly title: string;
  /** The ticket the pull closes: the merge names the ticket, not the pull request. */
  readonly ticket: { readonly number: number; readonly title: string } | undefined;
  readonly headRefName: string;
  readonly author: string;
}

/**
 * The merge commit's subject, `chore(merge): #<ticket> <its title>`, or
 * `undefined` for a factory pull that closes no issue: a factory pull always
 * has a ticket. A dependency bump has none — its pull request is the unit of
 * work, so it names its own number and title instead.
 */
export const mergeSubjectOf = (facts: MergeSubjectFacts): string | undefined => {
  if (facts.ticket !== undefined) {
    return `chore(merge): #${String(facts.ticket.number)} ${facts.ticket.title}`;
  }
  if (isDependabotPull(facts.headRefName, facts.author)) {
    return `chore(merge): #${String(facts.number)} ${facts.title}`;
  }
  return undefined;
};

export type MergeStep =
  | { readonly kind: "merge" }
  | { readonly kind: "wait"; readonly reason: string }
  | { readonly kind: "requeue-review" }
  | { readonly kind: "fix"; readonly reason: FixReason }
  | { readonly kind: "escalate"; readonly reasons: readonly string[] };

const wait = (reason: string): MergeStep => ({ kind: "wait", reason });

/**
 * Whether main must be merged into the branch before the gate decides: it
 * conflicts, or main changed a file the pull request changes too. The handoff
 * notes every ticket appends to don't count; their merge is a union.
 */
export const needsMain = (facts: MergeFacts): boolean => {
  if (facts.mergeState === "dirty") return true;
  if (facts.mainAheadBy === 0) return false;
  const mainFiles = new Set(facts.mainFiles);
  return facts.files.some((file) => !file.startsWith(HANDOFF_DIR) && mainFiles.has(file));
};

/**
 * What the merge workflow should do with this pull request now: merge it,
 * wait for the run that is still coming, queue the re-review a push needs,
 * send it to the fix loop, or hand it to the owner with every reason.
 */
export const mergeStep = (facts: MergeFacts): MergeStep => {
  if (facts.labels.includes("agent:review")) return wait("a review is queued (agent:review)");
  if (facts.labels.includes("ready-for-human")) {
    return wait("already waiting for a human (ready-for-human)");
  }
  if (facts.labels.includes("agent:blocked"))
    return wait("the pull request is blocked (agent:blocked)");

  // CI already ran on the pull request merged into main, so a branch that is
  // merely behind can merge as it is. Only a conflict, or main touching the
  // same files, needs main merged in first; that restarts CI and the review.
  if (needsMain(facts)) {
    if (mainMovesWorkflows(facts.mainFiles)) {
      return {
        kind: "escalate",
        reasons: ["main changed .github/workflows/, which the factory's token cannot push"],
      };
    }
    return { kind: "fix", reason: "main-moved" };
  }

  const ci = ciState(facts.ciRuns, facts.headSha);
  if (ci !== "success") return wait(ciReason(ci, facts.headSha));

  const review = reviewState(facts);
  if (review === "stale") return { kind: "requeue-review" };
  if (review !== "pass") return wait(reviewReason(review));

  const gate = canAutoMerge(facts);
  return gate.merge ? { kind: "merge" } : { kind: "escalate", reasons: gate.reasons };
};
