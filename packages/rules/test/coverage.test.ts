/**
 * The R-id coverage check (spec: definition of done item 1). Every rule in the
 * parity yardstick, R1–R80 of `docs/research/rules-inventory-v1.md`, is either
 * cited by a test name in this folder or listed below as deliberately out of
 * the rules engine's scope. A new rule area must add tests named by its ids;
 * a new test that covers an excluded id makes the exclusion stale and fails
 * here until it is removed.
 *
 * The scan reads the `it("…")` titles of the other `*.test.ts` files in this
 * folder, expanding `R25–R27`-style ranges. It deliberately skips this file,
 * whose exclusion reasons mention the ids they exclude.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Rule ids this package does not test, and why. The spec's amendments (#13)
 * and the parity yardstick win over the inventory where they disagree.
 */
const OUT_OF_SCOPE: Readonly<Record<number, string>> = {
  1: "R1: the Room size is chosen on the create form and validated by the protocol/Room server (#36); the engine takes it as Settings.maxPlayers.",
  2: "R2: refusing a join to a full Room is Room-server matchmaking (#36), not a rule the engine can be handed.",
  3: "R3: the Room password is checked in the server's static onAuth (#36/#37); no password reaches the engine.",
  4: "R4: the 6-digit Room code belongs to the Room server's code reservation (#34/#36), not to game state.",
  5: "R5: Start unlocks only when the Lobby is full, which is the Room server's Start gate (#36); setupGame's 2–4 Seat guard is tested under R6.",
  12: "R12: v1 found the local Player by username; superseded by ADR-0001 — the server owns the Seat and the client gets its own id. Nothing in the engine.",
  22: "R22: v1 let the active browser roll and relayed the values; superseded by ADR-0001 — the Room server rolls. R21 tests the seeded roll.",
  74: "R74: the Board countdown is client rendering of `endsAt` (MinutePill), covered by the Playwright seam, not by the engine.",
};

const RULE_IDS = Array.from({ length: 80 }, (_, index) => index + 1);

/** The rule ids an `it("…")` title cites, with `R25–R27` expanded to 25, 26, 27. */
function citedIds(source: string): number[] {
  const ids: number[] = [];
  for (const test of source.matchAll(/\bit\(\s*(["'`])([\s\S]*?)\1/g)) {
    const title = test[2] ?? "";
    for (const citation of title.matchAll(/\bR(\d+)(?:[–-]R?(\d+))?/g)) {
      const from = Number(citation[1]);
      const to = Number(citation[2] ?? from);
      for (let id = from; id <= to; id++) ids.push(id);
    }
  }
  return ids;
}

describe("R-id coverage", () => {
  const files = readdirSync(import.meta.dirname).filter(
    (file) => file.endsWith(".test.ts") && file !== "coverage.test.ts",
  );
  const cited = new Set(
    files.flatMap((file) => citedIds(readFileSync(join(import.meta.dirname, file), "utf8"))),
  );

  it("every R1–R80 either has a test named by its id or a documented exclusion", () => {
    const missing = RULE_IDS.filter((id) => !cited.has(id) && !Object.hasOwn(OUT_OF_SCOPE, id));

    // Name a missing rule's test by its id, or add the id to OUT_OF_SCOPE with a reason.
    expect(missing).toEqual([]);
  });

  it("lists only exclusions that are real and still needed", () => {
    const excluded = Object.keys(OUT_OF_SCOPE).map(Number);
    const stale = excluded.filter((id) => cited.has(id));
    const outOfRange = excluded.filter((id) => !RULE_IDS.includes(id));

    // An excluded id that now has a test is stale; drop it from OUT_OF_SCOPE.
    expect(stale).toEqual([]);
    // Only R1–R80 exist in the parity yardstick.
    expect(outOfRange).toEqual([]);
  });
});
