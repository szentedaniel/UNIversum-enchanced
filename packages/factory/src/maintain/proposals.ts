/**
 * The weekly architecture pass's contract with Claude: what one run may do
 * (its cap, focus and the prompt arguments they produce) and the door that
 * decides whether an agent may implement a proposal or the owner must.
 * "Claude decides, the script writes": this module turns a proposal into the
 * issue the script opens, and keeps the dedupe pure.
 */
import { z } from "zod";

/** The weekly cap: a weekly issue stream nobody reads is worse than none. */
export const DEFAULT_MAX_PROPOSALS = 2;

/** The most a manual dispatch may lift the cap to. */
const MAX_PROPOSALS_LIMIT = 20;

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

/** The model's whole answer schema: the proposals, capped by the run. */
export type ProposalsSchema = ReturnType<typeof proposalsSchemaOf>;

const parseMax = (raw: string | undefined): number => {
  if (raw === undefined || raw.trim() === "") return DEFAULT_MAX_PROPOSALS;
  const max = Number(raw);
  if (!Number.isInteger(max) || max < 1 || max > MAX_PROPOSALS_LIMIT) {
    throw new Error(
      `MAX_PROPOSALS must be an integer from 1 to ${String(MAX_PROPOSALS_LIMIT)}, got '${raw}'.`,
    );
  }
  return max;
};

const focusOf = (raw: string | undefined): string[] =>
  (raw ?? "")
    .trim()
    .split(/\s+/u)
    .filter((path) => path !== "");

/** What one architecture run is allowed to do, and the prompt arguments it feeds. */
export interface ArchitectureConfig {
  /** The proposal cap; a lifted cap switches the prompt to the sweep rule. */
  readonly max: number;
  /** The paths the pass keeps to; empty means the whole repository. */
  readonly focus: string[];
  /** The model's output schema, bounded by this run's cap. */
  readonly schema: ProposalsSchema;
  readonly promptArgs: {
    readonly DATE: string;
    readonly MAX_PROPOSALS: string;
    readonly CAP_RULE: string;
    readonly FOCUS: string;
  };
}

/**
 * One run's configuration, read from the dispatch env: an invalid
 * `MAX_PROPOSALS` throws rather than silently running at the default. Pure
 * apart from the injected clock that dates the prompt.
 */
export const architectureRun = (
  env: { MAX_PROPOSALS?: string; FOCUS?: string },
  now: Date,
): ArchitectureConfig => {
  const max = parseMax(env.MAX_PROPOSALS);
  const focus = focusOf(env.FOCUS);
  return {
    max,
    focus,
    schema: proposalsSchemaOf(max),
    promptArgs: {
      DATE: now.toISOString().slice(0, 10),
      MAX_PROPOSALS: String(max),
      // The weekly pass is picky; a sweep the owner lifted the cap for wants
      // every opportunity that pays for a ticket.
      CAP_RULE:
        max > DEFAULT_MAX_PROPOSALS
          ? "This run is a sweep the owner asked for: propose every opportunity in scope that would pay for a ticket, strongest first, up to the cap. Leave out only the ones you would not defend."
          : "It is not a target: propose one strong opportunity rather than two weak ones, and none when nothing this week would pay for a ticket.",
      FOCUS:
        focus.length === 0 ? "the whole repository" : focus.map((path) => `\`${path}\``).join(", "),
    },
  };
};

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
