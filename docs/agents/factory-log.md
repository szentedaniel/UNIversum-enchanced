# Factory log

The nightly retro's log, one dated entry per run: what the factory's day looked like, what recurring
problem the retro found, and which durable fix it opened for it. `packages/factory/src/retro/` writes
the entries; the weekly health report (`factory:report`, #92) reads them.

## 2026-11-09

- Handoff notes: the reviewer corrected stale or wrong handoff claims on five pull requests (#111, #137, #138, #152, #154), so a standards pull request makes the implementer verify them against the final diff before committing. The five red `main` CI runs on merge commits (#115, #119, #121, #123, #128) are the over-long merge subject already tracked in #141 and fixed by #142, which waits for the owner to merge; no new ticket.
- Opened pull request #161: Implementer: verify handoff note claims against the final diff before committing (retro/2026-11-09-implementer-verify-handoff-note-claims-against-the)

## 2026-11-10

- High: the merge gate escalated 'could not decide' on a GitHub API rate-limit 403 (owner comments on #140, runs 42628747934 and 42628819329), which held #140 and #158 until 2026-11-10. Opened a ticket for backoff and retry in the gh seam.
- Medium: duplicate and overlapping implementation runs (owner on #154, #156 and #142; #140 review: stale against TurnClock). Opened a ticket for an overlap check in the dispatcher and the architecture pass. The CI failures on #130 and #116 and the doc-comment fixes by the reviewer on #140, #143, #146 and #164 were one-offs that the fix rounds resolved, so there is no fix tonight.
- Opened #165: Merge gate: wait and retry on GitHub rate-limit errors instead of escalating
- Opened #166: Dispatcher and architecture-proposal intake: skip tickets that duplicate or overlap open work
