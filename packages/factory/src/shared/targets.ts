/**
 * The code paths a ticket, an issue or a proposal names, and whether two of
 * them touch the same module. The factory uses this to keep duplicate work out
 * of the dispatcher and the architecture pass without a model call.
 *
 * A path is matched by its trailing segments, so the package-relative form a
 * ticket usually uses (`shared/runs.ts`) finds the full path a pull request
 * reports (`packages/factory/src/shared/runs.ts`). A bare file name matches any
 * directory, except a generic one (`index.ts`); a directory matches the files
 * below it.
 */

const SOURCE_EXTENSION =
  "ts|tsx|js|jsx|mjs|cjs|json|jsonc|md|mdx|ya?ml|css|scss|html|sql|toml|sh|txt";

const FILE_PATH = new RegExp(
  `(?<![\\w@./-])(?:[\\w@.-]+/)*[\\w@.-]+\\.(?:${SOURCE_EXTENSION})\\b`,
  "giu",
);

const KNOWN_EXTENSION = new RegExp(`\\.(?:${SOURCE_EXTENSION})$`, "iu");

/**
 * How deep a directory must be to name a module: a package root
 * (`packages/factory`) or a broad folder (`.github`, `.github/workflows`) is not
 * a target, or one sentence about protected paths would claim the whole repo.
 */
const MODULE_DIRECTORY_DEPTH = 4;

/** The repo's top-level folders: a backticked directory under one is a target. */
const ROOT_DIRS: ReadonlySet<string> = new Set([
  "apps",
  "packages",
  "docs",
  "scripts",
  "monitoring",
  "patches",
  ".github",
]);

/** Names too common to identify a module on their own. */
const GENERIC_STEMS: ReadonlySet<string> = new Set([
  "index",
  "main",
  "mod",
  "type",
  "types",
  "util",
  "utils",
  "helper",
  "helpers",
  "constant",
  "constants",
  "config",
  "setup",
  "test",
  "tests",
  "fixture",
  "fixtures",
  "package",
  "readme",
  "glossary",
  "agents",
  "claude",
  "tsconfig",
]);

/**
 * The files nearly every web or e2e ticket touches without sharing any logic
 * with the next ticket: each only grows a line or an entry. Naming one is not a
 * claim on a module, and a pull request whose changed files are all of them
 * holds nothing. A `*` matches one path segment.
 */
const SHARED_FILES: readonly string[] = [
  // The Paraglide messages: a new string is a new key in hu, en and de.
  "apps/web/messages/*.json",
  // The message wiring: a ticket adds one map entry per new message.
  "apps/web/src/text.ts",
  // One home for shared e2e steps (`CODING_STANDARDS.md`, E2E): a ticket adds its own.
  "apps/e2e/tests/helpers.ts",
  // A new domain noun adds its entry (`CODING_STANDARDS.md`, Docs).
  "GLOSSARY.md",
  // The handoff ledger: one `ticket-<n>.md` and one `INDEX.md` line per ticket.
  "docs/agents/handoff/*",
  // The factory log: one line per day.
  "docs/agents/factory-log.md",
  // A new package adds one entry to the workspace manifest.
  "pnpm-workspace.yaml",
  // Any dependency change rewrites the lockfile.
  "pnpm-lock.yaml",
];

/** The regex syntax in a path segment, escaped before the glob's `*` becomes a matcher. */
const SEGMENT_SYNTAX = /[.*+?^${}()|[\]\\]/gu;

/** One path segment as a regex source; `*` matches any run of characters but `/`. */
const segmentSource = (segment: string): string =>
  segment.replace(SEGMENT_SYNTAX, "\\$&").replaceAll("\\*", "[^/]*");

/**
 * What a shared entry matches: its full path and every shorter trailing form a
 * ticket writes (`messages/en.json`, `handoff/ticket-4.md`). A bare file name
 * matches too, unless it is a glob (`*.json` would match every JSON file in the
 * repo) or generic (`helpers.ts` names test helpers everywhere).
 */
const sharedPatternsOf = (entry: string): readonly RegExp[] => {
  const segments = entry.split("/");
  const sources = segments.map(segmentSource);
  const patterns: RegExp[] = [];
  const shortest = segments.length >= 2 ? 2 : 1;
  for (let tail = shortest; tail <= segments.length; tail += 1) {
    patterns.push(new RegExp(`^${sources.slice(-tail).join("/")}$`, "u"));
  }
  const name = segments.at(-1) ?? "";
  const stem = name.replace(KNOWN_EXTENSION, "").toLowerCase();
  if (segments.length >= 2 && !name.includes("*") && !GENERIC_STEMS.has(stem)) {
    patterns.push(new RegExp(`^${sources.at(-1) ?? ""}$`, "u"));
  }
  return patterns;
};

const SHARED_PATTERNS: readonly RegExp[] = SHARED_FILES.flatMap(sharedPatternsOf);

interface ModulePath {
  /** The normalized path without a source extension. */
  readonly key: string;
  readonly segments: readonly string[];
  readonly stem: string;
  readonly bare: boolean;
  readonly directory: boolean;
}

const normalizePath = (raw: string): string =>
  raw
    .replaceAll("\\", "/")
    .replace(/^(?:\.\/)+/u, "")
    .replace(/[.,;:!?]+$/u, "")
    .replace(/\/+$/u, "");

/**
 * Whether a path names one of the shared files: changing or naming it says
 * nothing about which module the work changes, so it claims none.
 */
export const isSharedFile = (raw: string): boolean => {
  const path = normalizePath(raw);
  return path !== "" && SHARED_PATTERNS.some((pattern) => pattern.test(path));
};

const modulePathOf = (raw: string): ModulePath | undefined => {
  const path = normalizePath(raw);
  if (path === "" || isSharedFile(path)) return undefined;
  const directory = !KNOWN_EXTENSION.test(path);
  const key = directory ? path : path.replace(KNOWN_EXTENSION, "");
  const segments = key.split("/").filter((segment) => segment !== "");
  const stem = segments.at(-1);
  if (stem === undefined) return undefined;
  return { key, segments, stem, bare: segments.length === 1, directory };
};

const sameModulePath = (a: ModulePath, b: ModulePath): boolean => {
  if (a.segments.length >= 2 && b.segments.length >= 2) {
    return (
      a.key === b.key ||
      a.key.endsWith(`/${b.key}`) ||
      b.key.endsWith(`/${a.key}`) ||
      (a.directory &&
        a.segments.length >= MODULE_DIRECTORY_DEPTH &&
        b.key.startsWith(`${a.key}/`)) ||
      (b.directory && b.segments.length >= MODULE_DIRECTORY_DEPTH && a.key.startsWith(`${b.key}/`))
    );
  }
  const aIsDistinct = a.bare && a.stem !== "" && !GENERIC_STEMS.has(a.stem.toLowerCase());
  const bIsDistinct = b.bare && b.stem !== "" && !GENERIC_STEMS.has(b.stem.toLowerCase());
  return (aIsDistinct || bIsDistinct) && a.stem === b.stem;
};

/** Whether two lists of paths name at least one common module. */
export const shareModule = (a: readonly string[], b: readonly string[]): boolean => {
  const aPaths = a.flatMap((raw) => {
    const path = modulePathOf(raw);
    return path === undefined ? [] : [path];
  });
  const bPaths = b.flatMap((raw) => {
    const path = modulePathOf(raw);
    return path === undefined ? [] : [path];
  });
  return aPaths.some((aPath) => bPaths.some((bPath) => sameModulePath(aPath, bPath)));
};

interface FoundPath {
  readonly at: number;
  readonly path: string;
}

const spanDirectories = (text: string): FoundPath[] => {
  const found: FoundPath[] = [];
  for (const match of text.matchAll(/`([^`\n]+)`/gu)) {
    const span = match[1]?.trim();
    if (span === undefined || span === "") continue;
    if (/[\s*?{}<>|]/u.test(span) || span.includes("://")) continue;
    const path = normalizePath(span);
    if (KNOWN_EXTENSION.test(path)) continue;
    const segments = path.split("/");
    const first = segments[0];
    if (first === undefined || !ROOT_DIRS.has(first)) continue;
    if (segments.length < MODULE_DIRECTORY_DEPTH) continue;
    found.push({ at: match.index, path });
  }
  return found;
};

/** Every ticket ends "Follow `docs/agents/implementer.md`": that names the protocol, not a target. */
const PROTOCOL_LINE = /^.*\bFollow\b.*implementer\.md.*$/gimu;

/**
 * The file and directory paths the text names, once each, in textual order.
 * A shared file is not a target: every web or e2e ticket appends to the message
 * files, the helpers and the ledger, so naming one says nothing about which
 * module it changes.
 */
export const targetPathsIn = (rawText: string): string[] => {
  const text = rawText.replace(PROTOCOL_LINE, (line) => " ".repeat(line.length));
  const found: FoundPath[] = [];
  for (const match of text.matchAll(FILE_PATH)) {
    found.push({ at: match.index, path: normalizePath(match[0]) });
  }
  found.push(...spanDirectories(text));
  const seen = new Set<string>();
  return found
    .toSorted((a, b) => a.at - b.at)
    .flatMap((entry) => {
      if (entry.path === "" || isSharedFile(entry.path) || seen.has(entry.path)) return [];
      seen.add(entry.path);
      return [entry.path];
    });
};

/**
 * Directory names that say what a file is, not which module it belongs to:
 * `src-index` or `shared-runs` names half the repo's modules, so a branch slug
 * that carries the pair is no evidence the pull request meets the ticket.
 */
const GENERIC_DIRECTORIES: ReadonlySet<string> = new Set([
  "src",
  "lib",
  "libs",
  "shared",
  "common",
  "core",
  "internal",
  "utils",
  "helpers",
  "components",
  "services",
  "hooks",
  "store",
  "styles",
  "assets",
  "test",
  "tests",
  "specs",
  "fixtures",
  "mocks",
  "config",
  "types",
  "dist",
  "build",
]);

/** Whether the branch slug carries the candidate as whole hyphen or underscore words. */
const slugNames = (branch: string, candidate: string): boolean => {
  const slug = branch.toLowerCase().replaceAll("/", "-");
  const escaped = candidate.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  return new RegExp(`(?:^|-|_)${escaped}(?:-|_|$)`, "u").test(slug);
};

/**
 * Whether a pull request's branch slug names the module. The branch is
 * `agent/issue-<n>-<title slug>`, so `apps/server/src/room/turn-clock.ts` lands
 * `room-turn-clock` in `…-room-turn-clock-extract-the-clock`. The last three
 * segments match too (`src-dispatch-frontier` when the title names the path);
 * a two-segment pair only counts when both halves are specific, or a branch
 * that happens to share `src-index` would block the ticket.
 */
export const branchNamesTarget = (branch: string, path: string): boolean => {
  const module = modulePathOf(path);
  if (module === undefined || GENERIC_STEMS.has(module.stem.toLowerCase())) return false;
  const candidates = module.bare
    ? [module.stem]
    : module.segments.length >= 3
      ? [module.segments.slice(-3).join("-")]
      : [];
  const directory = module.segments.at(-2)?.toLowerCase() ?? "";
  if (!module.bare && !GENERIC_DIRECTORIES.has(directory)) {
    candidates.push(module.segments.slice(-2).join("-"));
  }
  return candidates.some((candidate) => slugNames(branch, candidate));
};
