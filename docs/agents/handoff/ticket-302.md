# Ticket 302 (a mechanically checked state migration): extension points and gotchas

Branch `agent/issue-302-factory-merge-gate-auto-merge-a-mechanically-check`. The merge gate now merges
a pull request whose only protected-path changes are one step of the rules state chain, without the
owner: the check lives in `packages/factory/src/merge/migration.ts`, and the review's one-way door on
that migration stops blocking. No workflow changed.

## The migration check (`packages/factory/src/merge/migration.ts`)

- `MIGRATION_FILES` names the four rules paths the check reads (`state.ts`, `migrate.ts`,
  `migrate.test.ts`, `test/fixtures/`); `MIGRATION_PATHS` is the two protected ones and
  `isMigrationPath` matches a changed file and a protected entry with the same prefix rule.
- `MigrationFacts` holds the sources at the merge base, at main's tip and at the head, the two
  fixtures listings, and the pull request's `files` (where an edited snapshot shows up).
- `stateVersionOf` reads `STATE_VERSION`; `migrationCollision` is "the head adds main's version"
  (`head === base + 1 && main >= head`); `migrationProblems` returns the refusal reasons, each opening
  `state migration:`. A sound migration returns `[]`.
- The `migrate.ts` comparison is line-based: entries are the lines at exactly two spaces starting with
  a number and a colon, comment-only and blank lines are dropped, and everything from the
  `const MIGRATIONS` declaration to the end of the file is the shell that must not change. Imports are
  outside it, so an entry may import its constant. A new entry style — a nested line indented two
  spaces, a computed key, a changed declaration line — fails closed with
  `state migration: migrate.ts's MIGRATIONS entries cannot be read` or a shell reason.
- The fixtures comparison is the two directory listings plus `files`: an added name must be exactly
  `state-v<head's STATE_VERSION>.json`, a removed or edited one is a reason, and
  `migrate.test.ts` must name the new snapshot outside a comment and still name every snapshot main
  had (dropping one would hollow out the chain it stands for).
- `test/migration.test.ts` reads the repository's own `migrate.ts`, `state.ts` and `migrate.test.ts`,
  so the parser is pinned against the real formatting rather than a hand-written sample.

## The gate (`packages/factory/src/merge/gates.ts`)

- `MergeFacts.migration` is `MigrationFacts | undefined`; `facts.ts` fills it only when a changed file
  is a migration path, so an ordinary pull request costs no extra read.
- `migrationGate` is the exception: it applies only when every `protectedPaths` entry is the
  migration's own and `migrationProblems` is empty. `canAutoMerge` then skips both the one-way-door
  reason (`riskReason(facts, checkedMigration)`) and the two `touches …` reasons, and reports the
  check's faults in their place.
- `mergeStep` sends a `migrationCollision` to the fix loop (`main-moved`) beside `needsMain`: the
  compare API's file list is capped, so the version itself must route the race.
- Because the waiver keys on the protected paths, a sound migration that also changes the protocol
  still merges on a one-way rating — the gate cannot read the review's reason. #303's rating rule
  (an additive protocol change is a two-way door) is the other half.

## Reading the sources (`packages/factory/src/merge/`)

- `facts.ts` reads `state.ts` at the merge base, `"main"` and the head, `migrate.ts` at main and the
  head, `migrate.test.ts` at the head, and `fixtureNames` at main and the head: 8 reads, migration
  pull requests only.
- `MergeReader.fixtureNames(repo, ref)` is new; `merge.ts` implements it as the contents API listing
  of the fixtures directory (`[.[] | select(.type == "file") | .name]`), `undefined` on 404, and it is
  wrapped in the gate's rate-limit retry like every other read.
- `test/merge.test.ts` pins both the filled facts (refs and listings) and that a non-migration pull
  reads no listing.

## The fix loop (`packages/factory/src/fix/`)

- `mainMovedProblem()` in `rounds.ts` is the `main-moved` problem text `decide.ts` writes into
  `problem.md`; it tells omp to renumber the chain entry, the snapshot's file name and its import and
  list entry in `migrate.test.ts` onto main's next version. `test/rounds.test.ts` pins the instruction.
- `fix.ts` still merges main with git and only reaches omp on a conflict: a collision that git merges
  textually leaves a duplicate `MIGRATIONS` key, which CI refuses as a type error and the `ci` fix
  round sees. The prompt's renumbering is the common, conflicting case.

## Gotchas

- The exception is only as strict as the parser: an entry written in a new style escalates the pull
  request to the owner rather than merging it. Extend `migrationSourceOf` with the new style and add
  the real file's case to `test/migration.test.ts` in the same diff.
- "From main's value" is main's tip (`ref=main`), not the merge base: that is what makes a racing
  migration fail the version rule and route to the fix loop.
- The smoke check against #235, #234, #187 and #193: their merges pass, and the two that raced (the
  branch tips of #187/#193, whose merge renumbered them) are `migrationCollision` before the renumber.
