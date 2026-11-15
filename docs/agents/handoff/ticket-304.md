# Ticket #304 (shared append-only files) — extension points and gotchas

Branch `agent/issue-304-factory-dispatcher-shared-append-only-files-are-no`, from `main`.

The dispatcher no longer serializes work that only meets the files every web or e2e ticket appends
to. Both readers of the overlap rule — `targetPathsIn` and `shareModule` — drop those paths, and a
pull request that changed only them holds nothing, however its branch is named.

## The shared list (`packages/factory/src/shared/targets.ts`)

- `SHARED_FILES` is a `readonly string[]` of patterns, one comment per entry saying why it is
  append-only: `apps/web/messages/*.json`, `apps/web/src/text.ts`, `apps/e2e/tests/helpers.ts`,
  `GLOSSARY.md`, `docs/agents/handoff/*`, `docs/agents/factory-log.md`, `pnpm-workspace.yaml` and
  `pnpm-lock.yaml`. `*` matches one path segment; `docs/agents/handoff/*` subsumes the old
  `docs/agents/handoff/INDEX.md` entry. Add a shared file as one entry here, never as a second list.
- `sharedPatternsOf(entry)` compiles one entry into its regexes at module load (`SHARED_PATTERNS`):
  the full path, every trailing two-or-more-segment form (`messages/en.json`,
  `handoff/ticket-4.md`) and the bare file name when the entry is not a glob and its stem is not in
  `GENERIC_STEMS` (`text.ts` matches; `helpers.ts` does not, and the bare tail of
  `apps/web/messages/*.json` is skipped because `*.json` names every JSON file in the repo).
- `isSharedFile(path)` is the exported predicate. `modulePathOf` and `targetPathsIn` both call it, so
  a named path and a changed file are read the same way.

## Dispatcher (`packages/factory/src/dispatch/frontier.ts`)

- `onlySharedFiles(pull)` requires a non-empty `files` list: a pull whose files could not be read
  still holds its module, so a failed `gh pr list` read does not unblock a ticket.
- `overlappingPull` skips such a pull before the changed-file and branch-slug tests, so a pull that
  only appended to `text.ts` cannot hold a ticket through a branch slug that repeats the title.
- The same-module test between tickets is unchanged: two tickets on the same component, rules or
  server file still serialize, shared files beside it or not.

## Tests

- `test/targets.test.ts`: `targetPathsIn` drops the full path of every shared entry plus the
  package-relative `messages/en.json` and `text.ts`; `shareModule` never matches two message files,
  `text.ts`, the helpers, `GLOSSARY.md`, a ledger entry, `pnpm-workspace.yaml` or `pnpm-lock.yaml`,
  and still matches a component named beside them.
- `test/frontier.test.ts`: two web tickets sharing the messages, `text.ts` and the helpers but
  different components both reach the frontier; the same component beside them still serializes; a
  pull that changes only shared files holds no ticket even when its branch slug names the module;
  a pull that changes a module beside them still blocks.

Read for: any shared-file addition, dispatcher overlap or target-path rule change.
