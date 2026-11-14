/mattpocock-skills:code-review Review pull request #{{PR_NUMBER}} on branch `{{BRANCH}}` against `origin/main`.

This is the factory's review step. The owner's decision: run the real `mattpocock-skills:code-review` skill, not a re-written checklist. Follow the skill's process, including its parallel Standards and Spec sub-agents, and report the two axes side by side.

# THE PULL REQUEST

{{PR_CONTEXT}}

# THE SPEC

{{ISSUE_LINE}}

{{ISSUE_CONTEXT}}

# STANDARDS

The Standards axis reads this repository's own documentation:

- `CODING_STANDARDS.md`: the judgement calls a reviewer checks a diff against.
- `GLOSSARY.md`: the terms to use, and the _Avoid_ synonyms to reject.
- every `docs/adr/` record the diff touches.
- the skill's smell baseline, where the repo says nothing.

`oxfmt`, `oxlint`, `tsc`, `vitest` and the repo's fences already run in CI: do not re-report what tooling enforces.

# AFTER THE REVIEW

The skill reports; it does not commit. Apply every fix you are sure of, on this branch:

- Stay inside the pull request's diff. Do not add features, dependencies, abstractions or refactors the spec did not ask for, and do not reformat untouched code.
- Make the change the repository's code already implies: match the neighbouring code and the documented standards rather than introducing a second pattern.
- Run the fast checks after a change: `pnpm exec oxfmt`, `pnpm run lint`, `pnpm -r run typecheck`, `pnpm exec vitest run`. Never run Playwright or `docker compose build`: CI owns those.
- Commit with `type(scope): description`, a type from `packages/repo-checks/src/commits.ts`, and no AI attribution. One commit per green slice is fine.
- Leave the working tree clean: commit or revert everything before you finish. The workflow pushes your commits; you never push.

Never change `.github/workflows/` yourself: it is a protected path the owner merges. If a finding needs a workflow change, leave it in `findings`.

Never comment on the pull request, label it, or open another one: the workflow posts the one summary comment.

# MERGE DANGER

`mergeDanger` decides the merge gate's label: `risk:low` for a two-way door with a local blast radius,
`risk:high` for everything else. The label is not the decision, though — the gate reads the door
itself, and outside a protected path it merges a two-way door even at `risk:high` once CI is green.
So rate the door and the blast radius as they are: only a one-way door hands the pull request to the
owner.

- `door`: `one-way` when undoing it is expensive, `two-way` when a revert is clean.
- `blastRadius`: `local` when the diff stays in one package, app or factory step; `wide` when it
  spans packages, or changes shared behaviour or a contract.
- `reason`: one sentence a person can check.

**An additive protocol change is a two-way door.** A new optional field, a new message or intent
type, a new Rejection code, or a new catalogue entry — added while nothing already on the wire is
renamed, removed, retyped or made required — is one old clients ignore and a clean revert until a
client ships code that depends on it. Rate it `two-way`, give the blast radius as it is (a protocol
change usually spans packages, so `wide`), and name it in the reason: "additive protocol change: …".

These stay `one-way`:

- renaming or removing anything on the wire: a message name, an intent type, a field, a Rejection
  code, a catalogue id;
- making an optional field required, or changing a field's type or meaning;
- reusing a retired id;
- changing stored state outside the migration path.

Examples: #270's new optional `watch` flag that nothing read yet, #268's chat catalogue and #267's
two Room intents were additive, so two-way doors. Renaming `MESSAGE.game`, deleting a
`REJECTION_CODES` entry, or making a chat catalogue id required is a one-way door.

# THE OUTPUT

End your final message with exactly one `<review>` block: valid JSON, no code fence, nothing after it. Every field is required — a reply without `mergeDanger` fails validation and costs a second turn.

<review>
{"verdict": "pass", "findings": [{"text": "...", "severity": "advisory"}], "mergeDanger": {"door": "two-way", "blastRadius": "local", "reason": "..."}}
</review>

- `findings`: only what you did not fix, or were not sure enough to fix. The fixes are the commits, not findings. `[]` when there are none.
- `findings[].severity`: a finding without one counts as **blocking**, so rate every finding:
  - `blocking`: a bug, a broken acceptance criterion, a standards breach with a real cost, or a security issue — something you would stop the merge for.
  - `advisory`: a judgement call, an optional follow-up, a scope note, or a test that could be stronger — a person may merge without doing it. The merge gate files these as one follow-up issue for triage after the merge; they never send the pull request back to a fix round on their own.
- `verdict`: `changes-requested` only when at least one finding is `blocking`; `pass` otherwise, including a review whose findings are all advisory.
- `mergeDanger`: `door`, `blastRadius` and `reason` as the MERGE DANGER section defines them.
