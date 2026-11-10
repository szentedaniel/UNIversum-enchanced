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

/** The repo's top-level folders: a backticked directory under one is a target. */
const ROOT_DIRS: Record<string, true> = {
  apps: true,
  packages: true,
  docs: true,
  scripts: true,
  monitoring: true,
  patches: true,
  ".github": true,
};

/** Names too common to identify a module on their own. */
const GENERIC_STEMS: Record<string, true> = {
  index: true,
  main: true,
  mod: true,
  type: true,
  types: true,
  util: true,
  utils: true,
  helper: true,
  helpers: true,
  constant: true,
  constants: true,
  config: true,
  setup: true,
  test: true,
  tests: true,
  fixture: true,
  fixtures: true,
  package: true,
  readme: true,
};

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

const modulePathOf = (raw: string): ModulePath | undefined => {
  const path = normalizePath(raw);
  if (path === "") return undefined;
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
      (a.directory && b.key.startsWith(`${a.key}/`)) ||
      (b.directory && a.key.startsWith(`${b.key}/`))
    );
  }
  const aIsDistinct = a.bare && a.stem !== "" && !GENERIC_STEMS[a.stem.toLowerCase()];
  const bIsDistinct = b.bare && b.stem !== "" && !GENERIC_STEMS[b.stem.toLowerCase()];
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
    const first = path.split("/")[0];
    if (first === undefined || !ROOT_DIRS[first]) continue;
    found.push({ at: match.index, path });
  }
  return found;
};

/** The file and directory paths the text names, once each, in textual order. */
export const targetPathsIn = (text: string): string[] => {
  const found: FoundPath[] = [];
  for (const match of text.matchAll(FILE_PATH)) {
    found.push({ at: match.index, path: normalizePath(match[0]) });
  }
  found.push(...spanDirectories(text));
  const seen = new Set<string>();
  return found
    .toSorted((a, b) => a.at - b.at)
    .flatMap((entry) => {
      if (entry.path === "" || seen.has(entry.path)) return [];
      seen.add(entry.path);
      return [entry.path];
    });
};

/**
 * Whether a pull request's branch slug names one of the paths. The branch is
 * `agent/issue-<n>-<title slug>`, so `shared/runs.ts` lands in
 * `…-shared-runs-ts-…`; the last two segments are what the title carries.
 */
export const branchNamesTarget = (branch: string, path: string): boolean => {
  const module = modulePathOf(path);
  if (module === undefined) return false;
  const slug = branch.toLowerCase().replaceAll("/", "-");
  const candidates =
    module.segments.length >= 2
      ? [
          module.segments.slice(-2).join("-"),
          module.segments.length >= 3 ? module.segments.slice(-3).join("-") : "",
        ]
      : module.stem === "" || GENERIC_STEMS[module.stem.toLowerCase()]
        ? []
        : [module.stem];
  return candidates.some((candidate) => {
    if (candidate === "") return false;
    const escaped = candidate.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
    return new RegExp(`(?:^|-|_)${escaped}(?:-|_|$)`, "u").test(slug);
  });
};
