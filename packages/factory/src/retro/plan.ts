/**
 * The retro's write plan: dedupe against what is already open, refuse a patch
 * that belongs in another kind, cap the day's writes and shape the bodies the
 * workflow's `gh` calls take. All pure, so the plan is testable without a
 * repository; `retro.ts` performs it.
 */
import type { Finding } from "#retro/schema.ts";

/** The spec's cap: at most three writes a night, so a bad day cannot flood. */
export const DEFAULT_MAX_WRITES = 3;

/** The log the retro appends to; #92's weekly report reads it. */
export const LOG_FILE = "docs/agents/factory-log.md";

export const LOG_HEADER = [
  "# Factory log",
  "",
  "The nightly retro's log, one dated entry per run: what the factory's day looked like, what",
  "recurring problem the retro found, and which durable fix it opened for it.",
  "`packages/factory/src/retro/` writes the entries; the weekly health report (`factory:report`,",
  "#92) reads them.",
  "",
].join("\n");

export interface ExistingIssue {
  readonly number: number;
  readonly title: string;
}

const normaliseTitle = (title: string): string =>
  title
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, " ")
    .trim();

/** The open issue (or pull request) whose title is the same one; cheap by design. */
export const duplicateOf = (
  title: string,
  existing: readonly ExistingIssue[],
): ExistingIssue | undefined => {
  const wanted = normaliseTitle(title);
  return existing.find((issue) => normaliseTitle(issue.title) === wanted);
};

export const slugOf = (title: string): string => {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+/u, "")
    .slice(0, 50)
    .replace(/-+$/u, "");
  return slug === "" ? "retro" : slug;
};

export const branchOf = (date: string, title: string): string => `retro/${date}-${slugOf(title)}`;

const COMMIT_PREFIX = "docs(factory): ";
/** `packages/repo-checks`'s subject limit, mirrored because a PR's CI checks it. */
const SUBJECT_LIMIT = 100;

/** A retro pull request's one commit: conventional, in the limit, no period. */
export const commitSubjectOf = (title: string): string => {
  const room = SUBJECT_LIMIT - COMMIT_PREFIX.length;
  const cleaned = title.replace(/\s+/gu, " ").trim();
  let subject = cleaned.slice(0, room);
  if (cleaned.length > room) {
    const boundary = subject.lastIndexOf(" ");
    if (boundary > 0) subject = subject.slice(0, boundary);
  }
  subject = subject.replace(/[.:;,!-]+$/u, "").trimEnd();
  return `${COMMIT_PREFIX}${subject === "" ? "standards update" : subject}`;
};

const FENCED_PATCH = /^```[a-z]*\n([\s\S]*?)\n```\s*$/u;

/** A model may wrap the diff in a fence despite the prompt; the patch ignores it. */
export const unfencePatch = (patch: string): string => {
  const trimmed = patch.trim();
  return FENCED_PATCH.exec(trimmed)?.[1] ?? trimmed;
};

/** The paths a unified diff touches; a deletion counts through its `--- a/` line. */
export const patchPaths = (patch: string): string[] => {
  const paths = new Set<string>();
  for (const line of patch.split("\n")) {
    if (line.startsWith("+++ b/")) paths.add(line.slice("+++ b/".length).trim());
    else if (line.startsWith("--- a/")) paths.add(line.slice("--- a/".length).trim());
  }
  return [...paths].toSorted();
};

const STANDARDS_FILES: Readonly<Record<string, true>> = {
  "CODING_STANDARDS.md": true,
  "AGENTS.md": true,
  "CLAUDE.md": true,
  "GLOSSARY.md": true,
};
const STANDARDS_DIRS = ["docs/agents/", "docs/adr/"];
/** The log belongs to the script, and the handoff notes to the implementers. */
const NOT_STANDARDS = [LOG_FILE, "docs/agents/handoff/"];
const PROMPT_FILE = /^packages\/factory\/src\/[a-z]+\/prompt\.md$/u;

/**
 * Where a standards change may land: the reviewer's standards, the implementer
 * protocol, the factory's docs, the ADRs and the step prompts. Code, the log
 * and the handoff notes belong elsewhere.
 */
export const isStandardsPath = (path: string): boolean => {
  if (NOT_STANDARDS.some((prefix) => path.startsWith(prefix))) return false;
  return (
    STANDARDS_FILES[path] === true ||
    STANDARDS_DIRS.some((directory) => path.startsWith(directory)) ||
    PROMPT_FILE.test(path)
  );
};

/** Only the workflows directory: the owner merges a workflow change. */
export const isWorkflowPath = (path: string): boolean => path.startsWith(".github/workflows/");

const evidenceLines = (finding: Finding): string[] => finding.evidence.map((item) => `- ${item}`);

/** A ticket an implementer agent can build from, with the protocol's context section. */
export const issueBody = (body: string, finding: Finding): string =>
  [
    body.trim(),
    "",
    "## Implementation context (for implementer agents)",
    "",
    finding.problem,
    "",
    "Evidence from the factory's last day:",
    "",
    ...evidenceLines(finding),
    "",
    "Follow `docs/agents/implementer.md`; the nightly retro opened this ticket.",
  ].join("\n");

export const standardsBody = (body: string, finding: Finding): string =>
  [
    body.trim(),
    "",
    "## Why",
    "",
    finding.problem,
    "",
    ...evidenceLines(finding),
    "",
    "The nightly retro opened this pull request: it touches a protected path, so the owner merges it.",
  ].join("\n");

export type PlannedWrite =
  | { readonly kind: "issue"; readonly title: string; readonly body: string }
  | {
      readonly kind: "standards-pr" | "workflow-pr";
      readonly title: string;
      readonly body: string;
      readonly patch: string;
      readonly branch: string;
    };

export interface WritePlan {
  readonly writes: readonly PlannedWrite[];
  readonly skipped: readonly string[];
}

export const planWrites = (options: {
  readonly findings: readonly Finding[];
  readonly existing: readonly ExistingIssue[];
  readonly date: string;
  readonly maxWrites: number;
}): WritePlan => {
  const writes: PlannedWrite[] = [];
  const skipped: string[] = [];
  const planned = new Set<string>();

  for (const finding of options.findings) {
    const { fix } = finding;
    if (fix.kind === "none") continue;
    if (writes.length >= options.maxWrites) {
      skipped.push(`write cap (${String(options.maxWrites)}) reached: "${fix.title}"`);
      continue;
    }
    const duplicate = duplicateOf(fix.title, options.existing);
    if (duplicate !== undefined) {
      skipped.push(`already proposed: #${String(duplicate.number)} "${duplicate.title}"`);
      continue;
    }
    const key = normaliseTitle(fix.title);
    if (planned.has(key)) {
      skipped.push(`already proposed in this run: "${fix.title}"`);
      continue;
    }

    if (fix.kind === "issue") {
      writes.push({ kind: "issue", title: fix.title, body: issueBody(fix.body, finding) });
    } else {
      const patch = unfencePatch(fix.patch);
      const paths = patchPaths(patch);
      if (paths.length === 0) {
        skipped.push(`"${fix.title}" has no patch paths`);
        continue;
      }
      const allowed = fix.kind === "standards-pr" ? isStandardsPath : isWorkflowPath;
      const outside = paths.find((path) => !allowed(path));
      if (outside !== undefined) {
        const scope = fix.kind === "standards-pr" ? "standards" : "workflow";
        skipped.push(`"${fix.title}" touches ${outside}, not a ${scope} path`);
        continue;
      }
      writes.push({
        kind: fix.kind,
        title: fix.title,
        body: standardsBody(fix.body, finding),
        patch,
        branch: branchOf(options.date, fix.title),
      });
    }
    planned.add(key);
  }

  return { writes, skipped };
};

export const logSection = (date: string, bullets: readonly string[]): string =>
  [
    `## ${date}`,
    "",
    ...(bullets.length === 0
      ? ["- Nothing new."]
      : bullets.map((bullet) => `- ${bullet.replace(/\s+/gu, " ").trim()}`)),
    "",
  ].join("\n");

export const appendLog = (
  existing: string | undefined,
  date: string,
  bullets: readonly string[],
): string => {
  const section = logSection(date, bullets);
  return existing === undefined || existing.trim() === ""
    ? `${LOG_HEADER}\n${section}`
    : `${existing.trimEnd()}\n\n${section}`;
};
