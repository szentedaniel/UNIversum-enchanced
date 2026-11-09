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
