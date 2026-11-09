# TASK

Implement issue #{{ISSUE_NUMBER}}: {{ISSUE_TITLE}}

You are on branch `{{BRANCH}}`, created from `main` and already checked out in this working directory. There is no worktree to create: build and commit here.

# ISSUE

{{ISSUE_CONTEXT}}

# READ FIRST

`docs/agents/implementer.md` is the protocol for building one ticket, and it holds for you except for the deviations listed below. Follow its §1: the ticket's _Parent_ names the spec (`gh issue view <spec> --json body --jq .body`); read `GLOSSARY.md`, the ADRs and handoff docs the ticket's **Implementation context** comment names, and `CODING_STANDARDS.md` (the reviewer checks your diff against it).

# DEVIATIONS FROM THE PROTOCOL

- **No worktree (§2):** you are already on `{{BRANCH}}`; commit directly.
- **No e2e, no `docker compose build` (§5):** the PR's CI runs them. Running Playwright here wastes the factory's monthly minutes.
- **The checks (§5):** run every check of `docs/agents/implementer.md` §5 except the e2e run and `docker compose build`, in that order. Run `pnpm install` first, and `pnpm --filter @universum/web run paraglide` after any message-file change. If you add or remove a dependency, regenerate the lockfile with `pnpm install --no-frozen-lockfile` (pnpm freezes it when `CI` is set) and commit it: CI installs with `--frozen-lockfile`.
- **No handoff-index conflicts (§6):** other agents are not running, so write `docs/agents/handoff/ticket-<N>.md` and its `INDEX.md` line whenever the ticket asks for them.
- **No report file:** do not write a report to `~/.cache/`. Your final message is the report (see below).

# BUILD TEST-FIRST

Red → green → refactor, one behaviour at a time: the failing test first, then the smallest change that passes it. Tests drive public interfaces only, never internals. Commit after every green slice.

# COMMIT

`type(scope): description`, with a type from `packages/repo-checks/src/commits.ts`. No AI attribution lines.

# NEVER

- Never push, never create or edit pull requests, never comment on or label issues: the workflow does all of that from the commits you leave behind.
- Change `.github/workflows/` only when the ticket asks for it. Then run `actionlint` on every workflow you change when it is installed. A workflow change is a protected path, so the owner merges it.

# REPORT

End your final message with the protocol's report, in its exact format and as plain text — no code fence:

```text
STATUS: DONE | BLOCKED
BRANCH: <the branch you committed on>
HEAD: <short sha of the last commit>

## What landed

- ...

## Checks

- each check you ran: pass/fail (+ vitest counts)

## Deviations from the ticket

- what and why (or "none")

## Question (only when BLOCKED)

- the decision you need, with the options you see
```

**Then put `<promise>COMPLETE</promise>` alone on the very last line.** It is Sandcastle's completion signal: without it the run assumes you are not finished and repeats this whole prompt, again, up to five times. The workflow strips the signal before it uses the report, so the pull request's body is the report alone.

The workflow takes everything from the last line that starts with `STATUS: ` to the end of your message and puts it in the pull request's body: whatever you write before it is dropped.
