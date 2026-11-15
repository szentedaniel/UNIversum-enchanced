import type { MergeDanger } from "#review/schema.ts";

/**
 * The merge gate's cheap signal: `risk:low` passes on its own, and the gate
 * reads a `risk:high` summary for a two-way door before it escalates.
 */
export type RiskLabel = "risk:low" | "risk:high";

/**
 * `risk:low` is the auto-merge gate's only label pass: a two-way door with a
 * local blast radius can be reverted and touches one place. A wide radius or a
 * one-way door (a migration, a breaking protocol change, a public interface)
 * is `risk:high`, whatever else the reviewer said — and so is an unrated
 * review, whose verdict and findings are still worth posting. The label is not
 * the decision: the gate reads the summary's door, and a `risk:high` two-way
 * door outside a protected path still merges.
 */
export const riskLabel = (danger: MergeDanger | undefined): RiskLabel =>
  danger?.door === "two-way" && danger.blastRadius === "local" ? "risk:low" : "risk:high";
