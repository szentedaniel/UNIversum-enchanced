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

## 2026-11-13

- Medium: the reviewer committed the missing GLOSSARY.md entry itself on #267, #268, #269 and #283, and flagged it on #270, so a standards pull request adds a glossary check to the implementer protocol.
- Opened pull request #284: Implementer: add new domain terms to GLOSSARY.md before the last commit (retro/2026-11-13-implementer-add-new-domain-terms-to-glossary-md-be)

## 2026-11-14

- Medium: the reviewer fixed a test id or role that differed from the ticket on #291 and #298, so a standards pull request adds a step to the implementer's Finish section: compare every name the ticket fixes with the diff before reporting. The review failures without a verdict (#285) are already ticketed, and the one red CI run (#265, run 43541015201) was resolved by fix round 1, so there is no new fix for either.
- Opened pull request #299: Implementer: compare the names the ticket fixes with the diff before finishing (retro/2026-11-14-implementer-compare-the-names-the-ticket-fixes-wit)

## 2026-11-15

- Medium: two concurrent merge-gate runs hit one pull request, giving duplicate 'waiting for a human' comments on #296 and #313 and the owner's false 'Merge already in progress' escalation on #312 (run 43663043570). The likely cause is the run_id concurrency fallback in factory-merge.yml. Opened a ticket to make the gate idempotent against it and to name the group fallback for the owner. The other review advisories are already ticketed as follow-ups (#319 to #343) and the red main #320 is already fixed by open #341, so there is no new fix for them.
- Opened #344: Merge gate: two concurrent runs for one pull request must not double-escalate or fail on 'Merge already in progress'

## 2026-11-16

- The first-push `check` failures on #345 and #348 (CI runs 43674311131, 43678289400) went away after one fix round. The facts give no shared cause, so I proposed no fix.
- Reviewer advisories about duplicated e2e steps and bare timing constants (#348, #356, #379, #382, #386) are already tracked as open follow-ups (#381, #383, #388), so I proposed nothing new. The merge-gate escalations on #341, #342 and #346 were protected-path holds working as designed.

## 2026-11-17

- Nothing new: all 15 pull requests merged with a pass and no fix rounds. The one reviewer commit (#409) was a one-off wording fix. The only red CI run (run 43814357897) was a Dependabot bump branch. The advisories on e2e waits and duplicated steps (#401, #408, #412, #413) are already open follow-ups, and CODING_STANDARDS.md already has the rule on waits after a Playback. The rest are single-pull-request nits.

## 2026-11-18

- No recurring problem: one red CI run (run 44211734141, check, on #415, now blocked for the owner) and no reviewer fixes, fix rounds or escalations across #415-#421; advisory findings already tracked in #422 and #423.

## 2026-11-19

- Nothing new.
