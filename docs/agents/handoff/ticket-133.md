# Ticket #133 (the retro's write step behind one adapter): extension points and gotchas

Branch `agent/issue-133-deepen-the-retro-s-write-step-one-adapter-behind-a`. The write half of the
nightly retro moved out of the run script: one module performs a `WritePlan` through one narrow
adapter, so the skip-versus-fail sequencing is testable without a repository.

## Where the code is (`packages/factory/src/retro/`)

- **`writes.ts`** — `applyWrites(writes, repo, io): { opened, skipped }`. It performs the plan's
  writes in order and returns the log bullets (`Opened #<n>: <title>`, `Opened pull request #<n>:
  <title> (<branch>)`) plus the write-time skips. `io` is `RetroIo`: `git(args)`, `gh(args)` (an
  argument array; a non-zero exit throws) and `writeTemp(name, content)` (returns the path).
  `shellIo` is the real adapter: `git`/`gh` become shell words through `shellArg`, temp files go in
  a fresh `mkdtemp` directory each. `retro.ts` passes `shellIo`.
- **`retro.ts`** — `main` is left with the agent run, the tree check, `planWrites`, one
  `applyWrites` call and the log commit. The log's `git fetch`/`merge`/`commit`/`push` deliberately
  stays here: it is the run's last write, after every planned write, and is not a `PlannedWrite`.
- **`plan.ts`** is unchanged. `ticket-109.md` still holds the two pull kinds' path rules.

## The policy `applyWrites` owns (pinned in `test/retro-writes.test.ts`)

- An existing remote branch is a skip (`"<title>": branch <branch> already exists`) and no patch is
  written. A failed `git ls-remote` reads as no branch, as `safeSh` did; the patch check decides.
- A patch that fails `git apply --check` is a skip (`"<title>": the patch does not apply to main`).
- A push or `gh pr create` failure propagates; the `finally` still runs `git checkout main`. Every
  fatal path therefore reaches `retro.ts`'s top-level catch, which writes `failure_reason.txt`.
- A skip never stops the rest of the plan; an issue after a skipped pull is still created.
- `numberFromUrl` throws `gh printed no issue URL: <out>` instead of calling `fail` directly (the
  top-level catch is the one that fails the step), so the parsing is testable and `process.exit`
  stays in the script only.

## Adding a write kind

Add the member to `PlannedWrite` and its body/skip rules to `planWrites` in `plan.ts`, then handle it
in `applyWrites`. The adapter needs no new method unless the kind reads or writes something other
than a patch branch, an issue or a temp file. Extend the recording adapter in
`test/retro-writes.test.ts` by adding the invocation, never by calling `shellIo`.
