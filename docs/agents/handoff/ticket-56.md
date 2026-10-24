# Ticket #56 (coding standards) — what changed and gotchas

Branch `ticket/56-coding-standards` (on `v2-modernization`), spec #58. No
product code changed: one new file and a trimmed protocol.

## What landed

- `CODING_STANDARDS.md` at the repo root: the judgement calls a reviewer checks
  a diff against, grouped by area (every area, rules engine, protocol/server,
  web client, e2e, docs/commits). Each rule names its ADR, spec section or
  glossary source.
- `docs/agents/implementer.md` §3 keeps the red-green-refactor loop and points
  at the standards; the four bullets it held (public interfaces, rule-id test
  names, seeded time, Paraglide messages) now live there once.
- §1 gained item 5 (`CODING_STANDARDS.md` in the reading list); §4 keeps
  "commit after every green slice" and the no-push/no-stash rules, and points
  at the standards for the message format.

## Gotchas

- **The mechanical list is deliberate.** The standards file names, but does not
  restate, the checks that already enforce a rule: `oxfmt`/`oxlint`/`tsc`, the
  import fence, the engine purity guard, the Playback and server-clock fence,
  R-id coverage, the migration snapshot guard, message-key parity and
  `failOnFlakyTests`. When a new fence lands, add it to that paragraph and take
  the rule out of the list below it.
- **`oxfmt --check` with no paths covers the root Markdown too.** CI runs the
  bare command, while the protocol's §5 check names `apps packages`. The bare
  command already fails on `docs/agents/handoff/ticket-51.md` on the integration
  tip (untouched by this ticket), so check the files you write with a path.
- **The e2e Playback-wait rule is stated twice on purpose.** The ticket asked
  for it in the standards, and the protocol's context comment keeps §5's
  build-time bullets in place. Change the wording in both or neither.
- **Spec #22 still carries its Modules / Client / Testing Decisions text.**
  Implementers never edit issues, so the standards file is the review copy the
  code-review skill reads; a diff that contradicts it wins only with an ADR
  amendment (see its Docs and commits section).
- Where a later ticket adds a rule: put it under the area that reviews it, keep
  it to one or two sentences, link the ADR/glossary, and check it is not
  already enforced by a test or a linter.
