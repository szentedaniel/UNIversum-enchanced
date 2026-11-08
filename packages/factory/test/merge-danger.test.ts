import { describe, expect, it } from "vitest";
import { riskLabel } from "#review/merge-danger.ts";

describe("riskLabel", () => {
  it("calls a two-way door with a local blast radius risk:low", () => {
    expect(
      riskLabel({ door: "two-way", blastRadius: "local", reason: "one step, revertible" }),
    ).toBe("risk:low");
  });

  it("escalates a wide blast radius", () => {
    expect(
      riskLabel({ door: "two-way", blastRadius: "wide", reason: "shared behaviour" }),
    ).toBe("risk:high");
  });

  it("escalates a one-way door", () => {
    expect(
      riskLabel({ door: "one-way", blastRadius: "local", reason: "state migration" }),
    ).toBe("risk:high");
  });

  it("escalates a one-way door with a wide blast radius", () => {
    expect(
      riskLabel({ door: "one-way", blastRadius: "wide", reason: "protocol break" }),
    ).toBe("risk:high");
  });
});
