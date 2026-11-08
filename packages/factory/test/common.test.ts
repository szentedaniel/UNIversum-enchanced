import { describe, expect, it } from "vitest";
import { positiveInt } from "#shared/common.ts";

describe("positiveInt", () => {
  it("reads a positive integer", () => {
    expect(positiveInt("900", 1400)).toBe(900);
    expect(positiveInt("1", 1400)).toBe(1);
  });

  it("keeps the default for an unset, empty, zero or misspelt value", () => {
    expect(positiveInt(undefined, 1400)).toBe(1400);
    expect(positiveInt("", 1400)).toBe(1400);
    expect(positiveInt("0", 1400)).toBe(1400);
    expect(positiveInt("-5", 1400)).toBe(1400);
    expect(positiveInt("900m", 1400)).toBe(1400);
    expect(positiveInt("1.5", 1400)).toBe(1400);
  });
});
