# Ticket #89 (intake): extension points and gotchas

Branch `ticket/89-intake`, spec #85. A one-line issue now becomes implementable work: triage turns it
into a `ready-for-agent` ticket, a `needs-info` question list or a `spec:proposed` draft, and split
turns an owner-approved spec into tracer-bullet sub-issues with blocking edges. Nothing of the game
changed.

## The modules (`packages/factory/src/intake/`)

- **`select.ts`** — pure. `IntakeIssue` is the REST fact shape the selection reads:
  `parent` (non-null = sub-issue), `subIssues`, `authorAssociation`, `isPullRequest`, `state`.
  `isTriageCandidate` = open, not a pull request, not a sub-issue, and (`needs-triage` **or** no
  labels at all from OWNER/MEMBER/COLLABORATOR). `isSplitCandidate` = open, not a pull request, not a
  sub-issue, `spec:approved`, **zero sub-issues** (the anti-duplicate guard). `triageCandidates` and
  `splitCandidates` sort oldest first and slice to the cap (`DEFAULT_INTAKE_MAX = 3`).
  `intakeAllowed({ eventName, at })` blocks only a **scheduled** run outside the Budapest night
  window (`isNightWindow` from `#review/window.ts`); a manual dispatch always runs. Label names live
  here (`NEEDS_TRIAGE`, `READY_FOR_AGENT`, `SPEC_APPROVED`, `FACTORY_LABEL`, …).
- **The `only` asymmetry.** `triageCandidates(issues, limit, only)` treats a named issue as the
  owner's **override**: that open issue is triaged whatever its labels (that is what makes a local
  dry run against an arbitrary issue possible). `splitCandidates` only **narrows**; a named issue
  still needs `spec:approved` and no sub-issues, because splitting writes issues.
- **`schema.ts`** — pure. `triageSchema` is a `z.discriminatedUnion("kind", …)` requiring the payload
  each kind needs (`ready` → `context`, `needs-info` → `questions` non-empty, `spec` → `spec`), so a
  malformed decision fails the structured-output extraction instead of posting nothing.
  `splitSchema` = `{ spec, tickets[{ title, body, context, blockedBy = [] }] }` (at least one
  ticket). `splitProblems(split)` checks every `blockedBy` index is in range, no self-block, and no
  cycle (DFS with a path, message `0 → 1 → 0`); it runs **before the first write**.
- **`render.ts`** — pure comments and bodies. `SPEC_MARKER = "<!-- factory-spec -->"` /
  `SPEC_END = "<!-- /factory-spec -->"`: triage posts the draft between them, split reads the newest
  marked comment, **falling back to the issue body** for a spec the owner wrote themselves. Changing
  either string breaks the fallback silently. `childBody` puts `Parent: #<n>` first; `triageAction`
  maps a decision to one comment plus the labels to add and to retire (`needs-triage` only when the
  issue carries it, so the label edit never removes an absent label).
- **`gh.ts`** — the boundary. `gh(args)` is `execFileSync` with an **argument array**, so an issue
  title or any agent text never reaches a shell. `api<T>` is the dispatcher's
  `gh api --paginate --slurp` flat list; a read that may be absent goes through `ghSafe`.
  `optionalIssueNumber` reads the dispatch's `ISSUE_NUMBER` and fails on junk.
- **`issues.ts`** — `openIssues(repo)` maps the REST list to `IntakeIssue`, `issueView(n)` gives split
  `{ title, body, comments }`. Two REST traps: `parent_issue_url` is **omitted** (not null) for
  top-level issues, and pull requests from the same endpoint have no `sub_issues_summary`; both are
  optional in `ApiIssue`. Also, `gh api --slurp` cannot be combined with `--jq`.
- **`writes.ts`** — every mutation: `commentOn`, `labelIssue` (one `gh issue edit` for add+remove),
  `rewriteBody`, `createIssue` (returns the number), `issueIdOf` (the numeric **database id** that
  sub-issue and dependency edges need), `attachSubIssue`, `addBlocker`, `queueReady`. Bodies always
  travel in temp files (`--body-file`). `commentOn`/`labelIssue` take `dryRun` and print `would …`;
  the split plan is printed by `split.ts` before anything would be created, so `createIssue`,
  `issueIdOf`, `attachSubIssue`, `addBlocker` and `rewriteBody` are real-run-only. `queueReady` writes
  `${OUTPUT_DIR}/ready-for-agent.txt`; the workflow reads it to start the dispatcher.
- **`tree.ts`** — `treeState()` is `git status --untracked-files=all` plus `git diff`; `changeSince`
  compares it across a Claude run. The **before/after** comparison (not a dirty check) is what lets a
  local dry run start from a developer's own uncommitted work and still catch the agent writing.
- **`triage.ts` / `split.ts`** — the scripts; `triage-prompt.md` / `split-prompt.md` hold the whole
  contract (the three triage kinds, the Implementation context headings, the spec headings, the
  ticket shape, the JSON block). Structured output is `Output.object({ tag: "triage" | "split" })`
  with `maxIterations: 1` and `claudeAgent("claude-sonnet-5-5")` — the reviewer's setup. The last
  `<triage>`/`<split>` block wins, so the prompt's examples are harmless.

## The workflow (`.github/workflows/factory-intake.yml`)

- Cron `15 0 * * *` UTC (02:15/03:15 Budapest) plus `workflow_dispatch` with `issue` (optional,
  narrows/overrides as above) and `dry_run`. `concurrency: factory-intake`, 45 minutes, job token
  read-only, every write via `AGENT_PAT`. It copies the review step's Claude setup **including the
  `mattpocock-skills` 1.3.1 pin check**, although intake's prompts use no plugin skill (the plugin
  ships no `/to-spec` or `/to-tickets`, so those shapes live in the prompts).
- Both steps are `continue-on-error: true` so a triage failure cannot stop an approved spec from
  splitting; a final step exits 1 when either failed. A failed step leaves the issue's label in
  place, so the next night retries it — the red run is the alarm, there is no failure comment.
- After the steps, if `ready-for-agent.txt` exists (and it is not a dry run), the workflow runs
  `gh workflow run factory-dispatch.yml`: a label or issue created with the PAT starts no workflow,
  and the dispatcher listens to pushes, runs and a cron only.

## Gotchas later tickets must know

- **Split idempotency.** Each child is created **and attached** before the next one exists, and
  `isSplitCandidate` refuses a spec that already has sub-issues. A failure after the first attach
  therefore leaves `sub_issues_summary.total > 0`, so the next night cannot duplicate the tickets. The
  price: a partially split spec keeps `spec:approved` (the owner's clue) and no error is written to
  it. A failure on the **first** attach is the one hole.
- **Order of writes in split**: create+attach all children → blocking edges → context comments →
  parent body → parent labels (`-spec:approved +factory`, last). Children carry `ready-for-agent` from
  creation; nothing dispatches until the final workflow step.
- **The agent inherits `GH_TOKEN`.** The read-only rule is prompt-enforced; `tree.ts` catches file
  writes only. Keep that in mind before widening what an intake prompt may do: the script, not the
  agent, must stay the only writer.
- **Dry run.** `DRY_RUN=1` still runs Claude (that is the point) and prints the decision and every
  write. Locally: `set -a; . ~/.local/state/universum-factory/secrets.env; set +a` (the token and the
  PAT), then
  `DRY_RUN=1 GH_REPO=szentedaniel/UNIversum-enchanced ISSUE_NUMBER=<n> node packages/factory/src/intake/triage.ts`.
  Verified on #90: `ready`, a grounded context comment, `would post …` / `would relabel …`, ~58 s.
  The split prompt was smoked separately against a synthetic spec (2 valid tickets, `problems: []`):
  no real `spec:approved` issue exists, and the dry run cannot create one.
- **`shared/common.ts` gained `writeOutput(name, content)`** (`OUTPUT_DIR`, mkdir + write); `fail()`
  now uses it. `queueReady` is the first caller — the retro (#90) and report (#92) steps can reuse it
  for their own output files.
- **No priority, no retry state.** The cap is per step per run (`FACTORY_INTAKE_MAX`, default 3);
  there is no "already failed N times" tracking. If triage starts failing permanently for one issue,
  it will fail every night until a person removes `needs-triage` or fixes the cause.
- **Reusable for #90/#92**: `gh`/`api` (argument arrays, `--slurp`), `writes.ts`'s temp-file bodies,
  `treeState`/`changeSince`, `writeOutput`, `intakeAllowed`, the structured-output shape and the
  `SPEC_MARKER` contract. The prompts are the contract with Claude; the TypeScript around them only
  starts the run, validates and performs the writes.
