import type { MergeDanger } from "#review/schema.ts";

/** The merge gate's cheap signal; every other danger is the owner's. */
export type RiskLabel = "risk:low" | "risk:high";

/**
 * `risk:low` is the auto-merge gate's only pass: a two-way door with a local
 * blast radius can be reverted and touches one place. A wide radius or a
 * one-way door (a migration, a protocol change, a public interface) is
 * `risk:high`, whatever else the reviewer said — and so is an unrated review,
 * whose verdict and findings are still worth posting.
 */
export const riskLabel = (danger: MergeDanger | undefined): RiskLabel =>
  danger?.door === "two-way" && danger.blastRadius === "local" ? "risk:low" : "risk:high";
