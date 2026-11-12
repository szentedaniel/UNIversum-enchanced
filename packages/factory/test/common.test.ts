import { describe, expect, it } from "vitest";
import { positiveInt, sh, shellArg } from "#shared/common.ts";

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

describe("sh", () => {
  it("kills a call that outlives its cap instead of hanging its loop", () => {
    // The heartbeat caps every gh call, so a hung one must throw like a failure.
    expect(() => sh("sleep 5", 50)).toThrow(/ETIMEDOUT/u);
  });
});

describe("shellArg", () => {
  it("hands a value with spaces, quotes and dollars to the shell as one word", () => {
    const value = `chore(merge): #87 it's a "title" $HOME \`id\``;

    expect(sh(`printf %s ${shellArg(value)}`)).toBe(value);
  });
});
