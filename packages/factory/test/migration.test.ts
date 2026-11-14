import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  isMigrationPath,
  MIGRATION_FILES,
  migrationCollision,
  migrationProblems,
  stateVersionOf,
  type MigrationFacts,
} from "#merge/migration.ts";

/**
 * The check reads the rules package's own sources: the migration chain, the
 * version, the snapshot list and the fixture names, so the parser is pinned
 * against the formatting it must read.
 */
const rulesFile = (path: string): string =>
  readFileSync(new URL(`../../rules/${path}`, import.meta.url), "utf8");

const MIGRATE = rulesFile("src/migrate.ts");
const STATE = rulesFile("src/state.ts");
const MIGRATE_TEST = rulesFile("test/migrate.test.ts");

const version = stateVersionOf(STATE);
if (version === undefined)
  throw new Error("the rules package's state.ts declares no STATE_VERSION");
const next = version + 1;

/** The fixture names the rules package holds. */
const fixtures = (): string[] =>
  readdirSync(new URL("../../rules/test/fixtures/", import.meta.url)).filter((name) =>
    name.endsWith(".json"),
  );

/** The entry a +1 migration appends for main's version, as oxfmt writes it. */
const NEXT_ENTRY = `  ${String(version)}: (state) => ({ ...state, stateVersion: ${String(next)} }),`;

/** A `migrate.ts` with one more entry, added where a migration appends it. */
const withEntry = (source: string, entry: string): string =>
  source.replace("\n};", `\n${entry}\n};`);

/** The rules test with the new snapshot imported and listed after the last one. */
const withListedFixture = (source: string): string =>
  source
    .replace(
      `import stateV${String(version)} from "./fixtures/state-v${String(version)}.json" with { type: "json" };`,
      `import stateV${String(version)} from "./fixtures/state-v${String(version)}.json" with { type: "json" };\nimport stateV${String(next)} from "./fixtures/state-v${String(next)}.json" with { type: "json" };`,
    )
    .replace(
      `{ version: ${String(version)}, state: stateV${String(version)} },`,
      `{ version: ${String(version)}, state: stateV${String(version)} },\n  { version: ${String(next)}, state: stateV${String(next)} },`,
    );

/** A sound +1 migration on the repository's own sources. */
const sound = (overrides: Partial<MigrationFacts> = {}): MigrationFacts => ({
  stateBase: STATE,
  stateMain: STATE,
  stateHead: STATE.replace(`STATE_VERSION = ${String(version)}`, `STATE_VERSION = ${String(next)}`),
  migrateMain: MIGRATE,
  migrateHead: withEntry(MIGRATE, NEXT_ENTRY),
  testHead: withListedFixture(MIGRATE_TEST),
  fixturesMain: fixtures(),
  fixturesHead: [...fixtures(), `state-v${String(next)}.json`],
  files: [MIGRATION_FILES.migrate, `${MIGRATION_FILES.fixtures}state-v${String(next)}.json`],
  ...overrides,
});

describe("the migration paths", () => {
  it("covers the migration file and the snapshots directory, and nothing else", () => {
    expect(isMigrationPath(MIGRATION_FILES.migrate)).toBe(true);
    expect(isMigrationPath(`${MIGRATION_FILES.fixtures}state-v3.json`)).toBe(true);
    expect(isMigrationPath("packages/rules/src/state.ts")).toBe(false);
    expect(isMigrationPath("packages/rules/test/migrate.test.ts")).toBe(false);
    expect(isMigrationPath("packages/factory/src/merge/gates.ts")).toBe(false);
  });
});

describe("stateVersionOf", () => {
  it("reads the version state.ts declares", () => {
    expect(stateVersionOf(STATE)).toBe(version);
    expect(stateVersionOf("export const STATE_VERSION = 34;")).toBe(34);
    expect(stateVersionOf("// nothing here")).toBeUndefined();
    expect(stateVersionOf(undefined)).toBeUndefined();
  });
});

describe("migrationProblems", () => {
  it("passes the repository's own chain with one appended entry and its fixture", () => {
    expect(migrationProblems(sound())).toEqual([]);
    expect(migrationCollision(sound())).toBe(false);
  });

  it("refuses a jump of more than one version", () => {
    const problems = migrationProblems(
      sound({
        stateHead: STATE.replace(
          `STATE_VERSION = ${String(version)}`,
          `STATE_VERSION = ${String(version + 2)}`,
        ),
      }),
    );

    expect(problems).toContain(
      `state migration: STATE_VERSION goes from ${String(version)} to ${String(version + 2)}, not up by one`,
    );
  });

  it("refuses an edited MIGRATIONS entry", () => {
    const problems = migrationProblems(
      sound({
        migrateHead: withEntry(
          MIGRATE.replace("stateVersion: 5, deal: null", "stateVersion: 5, deal: undefined"),
          NEXT_ENTRY,
        ),
      }),
    );

    expect(problems).toContain("state migration: the MIGRATIONS entry for 4 was edited");
  });

  it("refuses a removed MIGRATIONS entry", () => {
    const removed = MIGRATE.replace(
      "  8: (state) => ({ ...state, stateVersion: 9, minuteMs: MINUTE_MS, wealthSamples: [] }),\n",
      "",
    );
    const problems = migrationProblems(sound({ migrateHead: withEntry(removed, NEXT_ENTRY) }));

    expect(problems).toContain("state migration: the MIGRATIONS entry for 8 was removed");
  });

  it("refuses code changed outside the new entry", () => {
    const problems = migrationProblems(
      sound({
        migrateHead: withEntry(
          MIGRATE.replace(
            "if (!step) throw new Error(`no migration from stateVersion ${from}`);",
            "if (!step) state = { ...state, stateVersion: from + 1 };",
          ),
          NEXT_ENTRY,
        ),
      }),
    );

    expect(problems).toContain(
      "state migration: migrate.ts changed outside the new MIGRATIONS entry",
    );
  });

  it("refuses a new entry for a version main does not hand over", () => {
    const problems = migrationProblems(
      sound({ migrateHead: withEntry(MIGRATE, `  7: (state) => ({ ...state, dealUsed: true }),`) }),
    );

    expect(problems).toContain(`state migration: no new MIGRATIONS entry for ${String(version)}`);
  });

  it("refuses an edited snapshot", () => {
    const problems = migrationProblems(
      sound({ files: [...sound().files, `${MIGRATION_FILES.fixtures}state-v3.json`] }),
    );

    expect(problems).toContain("state migration: fixture state-v3.json changed");
  });

  it("refuses a removed snapshot", () => {
    const problems = migrationProblems(
      sound({ fixturesHead: fixtures().filter((name) => name !== "state-v3.json") }),
    );

    expect(problems).toContain("state migration: fixture state-v3.json was removed");
  });

  it("refuses a migration with no new snapshot", () => {
    const problems = migrationProblems(sound({ fixturesHead: fixtures() }));

    expect(problems).toContain(
      `state migration: no new fixture, expected state-v${String(next)}.json`,
    );
  });

  it("refuses a snapshot named for another version", () => {
    const problems = migrationProblems(
      sound({ fixturesHead: [...fixtures(), `state-v${String(next + 1)}.json`] }),
    );

    expect(problems).toContain(
      `state migration: the new fixture is state-v${String(next + 1)}.json, not state-v${String(next)}.json`,
    );
  });

  it("refuses a snapshot the rules test does not list", () => {
    const problems = migrationProblems(sound({ testHead: MIGRATE_TEST }));

    expect(problems).toContain(
      `state migration: migrate.test.ts does not list state-v${String(next)}.json`,
    );
  });

  it("refuses a snapshot only a comment names", () => {
    const problems = migrationProblems(
      sound({ testHead: `${MIGRATE_TEST}\n// state-v${String(next)}.json` }),
    );

    expect(problems).toContain(
      `state migration: migrate.test.ts does not list state-v${String(next)}.json`,
    );
  });

  it("reads a migration main already took as a collision, to renumber", () => {
    const raced = sound({
      stateMain: STATE.replace(
        `STATE_VERSION = ${String(version)}`,
        `STATE_VERSION = ${String(next)}`,
      ),
      migrateMain: withEntry(
        MIGRATE,
        `  ${String(version)}: (state) => ({ ...state, stateVersion: ${String(next)}, mine: true }),`,
      ),
      fixturesMain: [...fixtures(), `state-v${String(next)}.json`],
      fixturesHead: [...fixtures(), `state-v${String(next)}.json`],
    });

    expect(migrationCollision(raced)).toBe(true);
    expect(migrationProblems(raced)).toContain(
      `state migration: main already took STATE_VERSION ${String(next)}; the migration must be renumbered`,
    );
  });
});
