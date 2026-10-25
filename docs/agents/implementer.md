# Implementer protocol

How an implementer agent (omp, Claude Code, or a human) builds one ticket of a spec (spec #22, v2 modernization, or a later one such as #49, Playback; the ticket's _Parent_ names it). The orchestrator (Claude Code) plans, dispatches one ticket per implementer, verifies the result and merges it. The implementer builds; it never merges, pushes or closes issues.

## 1. Read before writing code

1. The ticket: `gh issue view <N> --comments`. The **Implementation context** comment lists what the ticket builds on, the files involved, the hazards, and which handoff docs to read.
2. The spec: `gh issue view <spec> --json body --jq .body`, where `<spec>` is the ticket's _Parent_. Its _Testing Decisions_ section defines what a good test is here. Spec #22 still holds the base rules, protocol and Clocks decisions that later specs extend.
3. `GLOSSARY.md` (domain terms) and `docs/adr/`.
4. `docs/agents/handoff/INDEX.md`, then every handoff doc the ticket's context comment names. `ticket-24.md` holds the extension points (where to add a phase, intent, event, Rejection code, protocol schema, Room handler, Board animation, message, test helper). `libs.md` holds verified library facts and gotchas. Grep installed packages under `node_modules/` instead of guessing an API.
5. `CODING_STANDARDS.md`: the judgement calls a reviewer checks your diff against.

## 2. Workspace

- You run inside your own git worktree on branch `ticket/<N>-<slug>`, based on the integration branch `<base>` your prompt names (`v2-modernization` for spec #22). Check with `git merge-base --is-ancestor <base> HEAD`; if it fails, `git reset --hard <base>` (only on a fresh branch with no commits of yours).
- Use paths inside your worktree only. Never edit the main checkout or another worktree.
- Run `pnpm install`, then `pnpm --filter @universum/web run paraglide` (generated message code is gitignored; regenerate after any merge or message-file change).
- Other tickets are built in parallel and merged into `<base>` as they finish. Keep edits to shared files (rules `apply.ts` HANDLERS, unions, `landing.ts`, protocol schemas, message files, `Game.tsx`) small and additive.
- If you change the shape of the rules `GameState`, bump `STATE_VERSION`, add a migration step in `packages/rules/src/migrate.ts` and commit a new snapshot `packages/rules/test/fixtures/state-v<N>.json`, as `packages/rules/test/migrate.test.ts` describes. Never edit an existing snapshot: running games are stored at that version.

## 3. Build test-first

Red → green → refactor, one behaviour at a time. The lines a test must not cross — public interfaces, rule-id names, seeded time, Paraglide messages — are in `CODING_STANDARDS.md`.

## 4. Commit as you go

- Commit after every green slice — a cut-off session must lose nothing.
- Commit messages are `type(scope): description`, with no AI attribution; the `commit-msg` hook (`.githooks/`, installed by `pnpm install`) refuses a bad one, `pnpm run check:commits` (§5) checks the branch, and `packages/repo-checks/src/commits.ts` lists the types.
- Never push, never open PRs, never touch GitHub issues. Never use a bare `git stash` (the stash is shared across worktrees).

## 5. Checks (all must be green, in CI order)

```bash
pnpm install --frozen-lockfile
pnpm run check:commits
pnpm exec oxfmt --check
pnpm run lint
pnpm -r run typecheck
pnpm exec vitest run
TEST_HOOKS=1 pnpm --filter @universum/web run build
CI=true E2E_SERVER_PORT=<sp> E2E_WEB_PORT=<wp> pnpm --filter @universum/e2e run test
docker compose build
```

This list mirrors the `run:` steps of `.github/workflows/ci.yml` (`docker compose build` is CI's parallel `docker` job); `packages/repo-checks/test/ci-protocol.test.ts` fails when the two drift.

Always pass the e2e ports you were given: other implementers run Playwright at the same time, and the default ports would reuse their servers.

- **One spec, repeated:** `CI=true E2E_SERVER_PORT=<sp> E2E_WEB_PORT=<wp> pnpm --filter @universum/e2e run test tests/<name>.spec.ts --repeat-each 6 --retries 0`. Pass the arguments straight after `test`: with `-- ` in front, Playwright drops them and runs the whole suite.
- **Flaky is failing:** in CI mode a test that passes only on its retry fails the run (`failOnFlakyTests`). Before reporting DONE, repeat every spec you touched as above.
- **Waits after a Playback:** see `CODING_STANDARDS.md` §E2E.
- **When an e2e test fails, read the screens, not the spec:** a game spec imports `test` from `tests/helpers.ts` and registers each page it opens (`startGame` does the creator and guest; `registerPage(name, page)` for the rest), handing contexts and launched browsers to `closeAfterDump` instead of closing them. On failure the fixture attaches one JSON per page (`<name>.json`): the Player, connection status and last Rejection, the push's `seq`/`clockOffset`/event types, the view's Turn, current Player, phase, `actsAfter` and version, `playback()` and the visible button labels. The list reporter does not print `application/json` bodies, so read the attachments in the HTML report (`apps/e2e/playwright-report/`, the failed test's **Attachments**) or re-run with `--reporter=json`. A page that was closed reports `error` instead of state.

## 6. Finish

1. Merge the current integration tip: `git merge <base>`, resolve conflicts keeping both sides' behaviour, regenerate Paraglide, re-run every check.
2. Write `docs/agents/handoff/ticket-<N>.md`: extension points and gotchas later tickets need. Append one line for it at the end of `docs/agents/handoff/INDEX.md` (``- `ticket-<N>.md`: what it covers. Read for: #…``). Commit.
3. Write the report file named in your prompt (see below), then stop and wait.

### Report file

```markdown
STATUS: DONE | BLOCKED
BRANCH: ticket/<N>-<slug>
HEAD: <short sha>

## What landed

- ...

## Checks

- each command above: pass/fail (+ e2e passed/failed/skipped counts)

## Deviations from the ticket

- what and why (or "none")

## Question (only when BLOCKED)

- the decision you need, with the options you see
```

Write `STATUS: BLOCKED` when you can't continue without a decision, when a check fails for a reason you can't fix, or when the ticket contradicts the code or spec. Don't guess on product decisions. The orchestrator answers by prompting you in the same session, and you continue from there.

The orchestrator verifies your work against the ticket and the spec. If it finds problems, it prompts you with a list of fixes. Fix them, commit, re-run the checks, and rewrite the report file.
