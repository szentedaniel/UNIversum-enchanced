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
