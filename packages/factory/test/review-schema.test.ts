import { describe, expect, it } from "vitest";
import { reviewOf, reviewSchema } from "#review/schema.ts";

const DANGER = { door: "two-way", blastRadius: "local", reason: "one factory step" } as const;

const parsed = (findings: unknown) =>
  reviewSchema.safeParse({ verdict: "changes-requested", findings, mergeDanger: DANGER });

describe("reviewSchema", () => {
  it("accepts the severities the prompt asks for", () => {
    const result = parsed([
      { text: "The acceptance criterion is unmet.", severity: "blocking" },
      { text: "The helper could be shared.", severity: "advisory" },
    ]);

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(reviewOf(result.data)).toEqual({
      verdict: "changes-requested",
      findings: [
        { text: "The acceptance criterion is unmet.", severity: "blocking" },
        { text: "The helper could be shared.", severity: "advisory" },
      ],
      mergeDanger: DANGER,
    });
  });

  it("counts a finding with no severity as blocking, the older prompt's fallback", () => {
    const result = parsed([
      "A string is what a prompt before the severities wrote.",
      { text: "An object that left the severity out." },
    ]);

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(reviewOf(result.data).findings).toEqual([
      { text: "A string is what a prompt before the severities wrote.", severity: "blocking" },
      { text: "An object that left the severity out.", severity: "blocking" },
    ]);
  });

  it("rejects a severity outside blocking and advisory", () => {
    expect(parsed([{ text: "A nit.", severity: "nit" }]).success).toBe(false);
  });
});
