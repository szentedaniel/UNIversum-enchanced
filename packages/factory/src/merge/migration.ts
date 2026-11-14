/**
 * The state-migration exception: a pull request whose only protected-path
 * changes are one step of the rules state chain may merge without the owner.
 * `packages/rules/test/migrate.test.ts` runs every stored snapshot through the
 * chain to the current shape, so a diff that is exactly one appended step and
 * one new snapshot is about as safe as a reviewed migration. Everything here
 * is pure and reads the sources the merge gate fetches; anything else about
 * the diff fails closed and the owner merges it as before.
 */

/** The rules sources the check reads; `fixtures` is the directory every stored snapshot lives in. */
export const MIGRATION_FILES = {
  state: "packages/rules/src/state.ts",
  migrate: "packages/rules/src/migrate.ts",
  test: "packages/rules/test/migrate.test.ts",
  fixtures: "packages/rules/test/fixtures/",
} as const;

/** The two protected paths a state migration owns; every other one keeps its refusal. */
export const MIGRATION_PATHS = [MIGRATION_FILES.migrate, MIGRATION_FILES.fixtures] as const;

/**
 * Whether a changed file, or a protected path, is the migration's own: the
 * migration file itself, or any snapshot in the fixtures directory.
 */
export const isMigrationPath = (path: string): boolean =>
  MIGRATION_PATHS.some((entry) => (entry.endsWith("/") ? path.startsWith(entry) : path === entry));

/**
 * The sources the check reads. `state` and `fixtures` are read at the merge
 * base, at main's tip and at the head, so a migration racing main's is told
 * apart from a branch that has not bumped at all; `files` is the pull
 * request's own file list, where an edited snapshot shows up.
 */
export interface MigrationFacts {
  readonly stateBase: string | undefined;
  readonly stateMain: string | undefined;
  readonly stateHead: string | undefined;
  readonly migrateMain: string | undefined;
  readonly migrateHead: string | undefined;
  readonly testHead: string | undefined;
  readonly fixturesMain: readonly string[] | undefined;
  readonly fixturesHead: readonly string[] | undefined;
  readonly files: readonly string[];
}

/** `state.ts`'s version line, as the rules package writes it. */
const STATE_VERSION_LINE = /^export const STATE_VERSION = (\d+);$/mu;

/** The `STATE_VERSION` a rules `state.ts` declares, or `undefined` when it declares none. */
export const stateVersionOf = (source: string | undefined): number | undefined => {
  const digits = source === undefined ? undefined : STATE_VERSION_LINE.exec(source)?.[1];
  return digits === undefined ? undefined : Number(digits);
};

/** A line that carries no code: a comment of either kind, or a blank. */
const isComment = (line: string): boolean => {
  const trimmed = line.trim();
  return (
    trimmed === "" ||
    trimmed.startsWith("//") ||
    trimmed.startsWith("/*") ||
    trimmed.startsWith("*")
  );
};

/** The line declaring the chain, and the line closing its object literal. */
const MIGRATIONS_DECLARATION = /^const MIGRATIONS\b/u;
const OBJECT_END = "};";

/** An entry's key line, at the object's own indentation; an entry's body is indented further. */
const ENTRY_KEY = /^ {2}(\d+):/u;

/** One `migrate.ts` split into its chain and the code around it. */
interface MigrationSource {
  readonly entries: ReadonlyMap<number, string>;
  /** The file's lines outside the entries, comments and imports aside: what a migration may not touch. */
  readonly shell: readonly string[];
}

/**
 * Splits a rules `migrate.ts` into its `MIGRATIONS` entries, keyed by the
 * version they migrate from, and the shell around them. Comments and blank
 * lines are dropped on both sides, so a comment may accompany the new entry;
 * imports are outside the shell, so a migration may import the constant its
 * entry needs.
 */
const migrationSourceOf = (source: string): MigrationSource => {
  const entries = new Map<number, string>();
  const shell: string[] = [];
  let started = false;
  let inObject = false;
  let key: number | undefined;
  let body: string[] = [];
  const flush = (): void => {
    if (key !== undefined) entries.set(key, body.join("\n"));
    key = undefined;
    body = [];
  };
  for (const line of source.split("\n")) {
    if (isComment(line)) continue;
    if (!started) {
      if (!MIGRATIONS_DECLARATION.test(line)) continue;
      started = true;
      inObject = true;
      shell.push(line.trimEnd());
      continue;
    }
    if (!inObject) {
      shell.push(line.trim());
      continue;
    }
    if (line.startsWith(OBJECT_END)) {
      flush();
      inObject = false;
      shell.push(line.trim());
      continue;
    }
    const match = ENTRY_KEY.exec(line);
    if (match !== null) {
      flush();
      key = Number(match[1]);
      // A one-line entry is its key line alone, so the body keeps it.
      body = [line.trim()];
      continue;
    }
    if (key !== undefined) body.push(line.trim());
  }
  flush();
  return { entries, shell };
};

/**
 * Whether main already has the version the pull request adds: two migrations
 * raced, and the merge would leave two entries for one version. The gate
 * sends this to the fix loop, whose prompt tells omp to renumber the entry
 * and its snapshot onto main's next version.
 */
export const migrationCollision = (facts: MigrationFacts): boolean => {
  const base = stateVersionOf(facts.stateBase);
  const main = stateVersionOf(facts.stateMain);
  const head = stateVersionOf(facts.stateHead);
  return (
    base !== undefined &&
    main !== undefined &&
    head !== undefined &&
    head === base + 1 &&
    main >= head
  );
};

/** Whether the rules test names a snapshot outside a comment. */
const listsFixture = (test: string, name: string): boolean =>
  test.split("\n").some((line) => !isComment(line) && line.includes(name));

/** The snapshot a version is stored as. */
const fixtureName = (version: number): string => `state-v${String(version)}.json`;

/**
 * Why the pull request is not the one-step migration the gate may merge
 * alone: a version that does not follow main's, a chain entry added, edited
 * or removed, code changed outside the entries, a snapshot added, edited or
 * removed, or a rules test that does not list the new snapshot or dropped an
 * old one. Empty means the exception holds.
 */
export const migrationProblems = (facts: MigrationFacts): string[] => {
  const problems: string[] = [];
  const main = stateVersionOf(facts.stateMain);
  const head = stateVersionOf(facts.stateHead);
  if (main === undefined) problems.push("state migration: main declares no STATE_VERSION");
  if (head === undefined) problems.push("state migration: the head declares no STATE_VERSION");
  if (main !== undefined && head !== undefined && head !== main + 1) {
    problems.push(
      migrationCollision(facts)
        ? `state migration: main already took STATE_VERSION ${String(head)}; the migration must be renumbered`
        : `state migration: STATE_VERSION goes from ${String(main)} to ${String(head)}, not up by one`,
    );
  }

  const chainMain =
    facts.migrateMain === undefined ? undefined : migrationSourceOf(facts.migrateMain);
  const chainHead =
    facts.migrateHead === undefined ? undefined : migrationSourceOf(facts.migrateHead);
  if (
    chainMain === undefined ||
    chainHead === undefined ||
    chainMain.entries.size === 0 ||
    chainHead.entries.size === 0
  ) {
    problems.push("state migration: migrate.ts's MIGRATIONS entries cannot be read");
  } else {
    for (const [version, entry] of chainMain.entries) {
      const current = chainHead.entries.get(version);
      if (current === undefined) {
        problems.push(`state migration: the MIGRATIONS entry for ${String(version)} was removed`);
      } else if (current !== entry) {
        problems.push(`state migration: the MIGRATIONS entry for ${String(version)} was edited`);
      }
    }
    const added = [...chainHead.entries.keys()].filter(
      (version) => !chainMain.entries.has(version),
    );
    if (main !== undefined) {
      if (!added.includes(main)) {
        problems.push(`state migration: no new MIGRATIONS entry for ${String(main)}`);
      }
      for (const version of added) {
        if (version !== main) {
          problems.push(
            `state migration: the MIGRATIONS entry for ${String(version)} is not the one ${String(main)} needs`,
          );
        }
      }
    }
    if (chainMain.shell.join("\n") !== chainHead.shell.join("\n")) {
      problems.push("state migration: migrate.ts changed outside the new MIGRATIONS entry");
    }
  }

  if (facts.fixturesMain === undefined || facts.fixturesHead === undefined) {
    problems.push("state migration: the fixtures directory is missing");
  } else {
    const before = new Set(facts.fixturesMain);
    const after = new Set(facts.fixturesHead);
    for (const name of before) {
      if (!after.has(name)) problems.push(`state migration: fixture ${name} was removed`);
    }
    for (const file of facts.files) {
      if (!file.startsWith(MIGRATION_FILES.fixtures)) continue;
      const name = file.slice(MIGRATION_FILES.fixtures.length);
      if (before.has(name) && after.has(name)) {
        problems.push(`state migration: fixture ${name} changed`);
      }
    }
    const added = [...after].filter((name) => !before.has(name));
    if (head !== undefined) {
      const expected = fixtureName(head);
      if (added.length === 0) {
        problems.push(`state migration: no new fixture, expected ${expected}`);
      } else if (added.length > 1) {
        problems.push(`state migration: ${added.join(", ")} are new, expected only ${expected}`);
      } else if (added[0] !== expected) {
        problems.push(`state migration: the new fixture is ${String(added[0])}, not ${expected}`);
      }
    }
  }

  const test = facts.testHead;
  if (test === undefined) {
    problems.push("state migration: migrate.test.ts is missing");
  } else {
    // The exception rests on the test running every stored snapshot through
    // the chain, so dropping one from the list would hollow out the check.
    const dropped = (facts.fixturesMain ?? []).filter((name) => !listsFixture(test, name));
    if (dropped.length > 0) {
      problems.push(`state migration: migrate.test.ts no longer lists ${dropped.join(", ")}`);
    }
    if (head !== undefined && !listsFixture(test, fixtureName(head))) {
      problems.push(`state migration: migrate.test.ts does not list ${fixtureName(head)}`);
    }
  }

  return problems;
};
