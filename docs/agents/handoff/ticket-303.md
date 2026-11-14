# Ticket 303 (an additive protocol change is a two-way door): extension points and gotchas

Branch `agent/issue-303-factory-review-an-additive-protocol-change-is-a-tw`. The review prompt now
defines an additive protocol change as a two-way door, so the reviewer rates it `two-way` and the
merge gate's existing rules auto-merge it outside a protected path. No gate code and no workflow
changed; the diff is the prompt, one comment, the factory docs and one test.

## The rating rule (`packages/factory/src/review/prompt.md`)

- The `# MERGE DANGER` section, before `# THE OUTPUT`, holds the whole rule: the `door`,
  `blastRadius` and `reason` fields, the additive definition (a new optional field, message or intent
  type, Rejection code or catalogue entry, with nothing existing renamed, removed, retyped or made
  required), the four stay-one-way cases, and examples of both kinds (#270's optional `watch` flag,
  #268's chat catalogue, #267's two Room intents; renaming `MESSAGE.game`, deleting a
  `REJECTION_CODES` entry, making a chat catalogue id required).
- The prompt asks for the reason to open `additive protocol change: …`. Nothing parses the reason
  text: `mergeDangerOf` (`src/review/summary.ts`) keeps it for the summary and `riskReason`
  (`src/merge/gates.ts`) reads only `door`, so the wording is for the reader.
- The `mergeDanger` bullet under `# THE OUTPUT` now points at the section; change them together.

## The decision (`src/review/merge-danger.ts`, `src/merge/gates.ts`)

- `riskLabel` is unchanged: two-way + local is `risk:low`, and a wide two-way door (an additive
  protocol change usually spans packages) is `risk:high`. The comment in `merge-danger.ts` now says
  the label is not the decision.
- The gate's `riskReason` accepts a `risk:high` whose newest `<!-- factory-review -->` summary names
  a two-way door, so no gate change was needed. `packages/protocol/src/` is not a protected path;
  the only wire special case is `WIRE_PATH` in `migrationGate`, which keeps the owner on a state
  migration that also touches the protocol.
- `test/merge-danger.test.ts` pins the path end to end: `factsFor(danger)` builds the gate facts
  from a rating over `packages/protocol/src/messages.ts`, and the test asserts `risk:high` plus
  `{merge: true, reasons: []}` for the reason "additive protocol change".

## Gotchas

- The additive definition is prose only; no code inspects a diff for it. A reviewer that mis-rates a
  removal as two-way sends it to the gate, which trusts the summary's `door` outside a protected path.
- The weekly maintain prompt (`packages/factory/src/maintain/prompt.md`) still calls any "protocol or
  wire change" a one-way proposal. It rates architecture proposals, not reviews, so this ticket left
  it alone; keep the two vocabularies apart when either changes.
