/**
 * The weekly architecture pass's contract with Claude: at most two refactor
 * proposals a week (more on a manual run), each with the door that decides whether an agent may implement it
 * or the owner must. "Claude decides, the script writes": this module turns a
 * proposal into the issue the script opens, and keeps the dedupe pure.
 */
import { z } from "zod";

/** The weekly cap: a weekly issue stream nobody reads is worse than none. */
export const DEFAULT_MAX_PROPOSALS = 2;

/**
 * The owner may lift the cap for one run (`max_proposals` on a manual
 * dispatch) to sweep the whole codebase at once.
 */
export const proposalsSchemaOf = (max: number) =>
  z.object({
    proposals: z
      .array(
        z.object({
          title: z.string().min(1),
          /** The friction: where depth, a seam or locality is missing. */
          problem: z.string().min(1),
          /** The refactor in plain English, with the deepened module's interface. */
          proposal: z.string().min(1),
          files: z.array(z.string().min(1)),
          // The merge gate's door: `true` when a revert is clean.
          twoWayDoor: z.boolean(),
          doorReason: z.string().min(1),
        }),
      )
      .max(max),
  });

export type Proposal = z.infer<ReturnType<typeof proposalsSchemaOf>>["proposals"][number];

/** The hidden marker every architecture issue carries. */
export const ARCHITECTURE_MARKER = "<!-- factory:architecture -->";

/**
 * The label the door picks: a two-way door is an agent's issue, a one-way
 * door is the owner's (the merge gate would send it to them anyway).
 */
export const proposalLabel = (proposal: Proposal): "ready-for-agent" | "ready-for-human" =>
  proposal.twoWayDoor ? "ready-for-agent" : "ready-for-human";

const doorText = (proposal: Proposal): string =>
  `${proposal.twoWayDoor ? "two-way" : "one-way"} — ${proposal.doorReason}`;

export const proposalIssueBody = (proposal: Proposal): string =>
  [
    ARCHITECTURE_MARKER,
    "## The friction",
    "",
    proposal.problem,
    "",
    "## The proposal",
    "",
    proposal.proposal,
    "",
    "## Files",
    "",
    ...proposal.files.map((file) => `- \`${file}\``),
    "",
    `**Door:** ${doorText(proposal)}`,
    "",
    "Found by the weekly architecture pass (`factory-maintain.yml`), with the `codebase-design` vocabulary.",
    "",
  ].join("\n");

/**
 * The proposals no open issue carries yet, deduped on the title: the pass
 * must not re-open last week's issue because the wording drifted a little.
 */
export const newProposals = (
  proposals: readonly Proposal[],
  openTitles: readonly string[],
): Proposal[] => {
  const tracked = new Set(openTitles.map((title) => title.trim().toLowerCase()));
  return proposals.filter((proposal) => !tracked.has(proposal.title.trim().toLowerCase()));
};
