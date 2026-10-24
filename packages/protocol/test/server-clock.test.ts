import { afterEach, describe, expect, it, vi } from "vitest";
import { serverNow } from "#messages.ts";

describe("the server-clock estimate", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("adds the offset to the client reading it is given", () => {
    expect(serverNow(1_500, 1_000_000)).toBe(1_001_500);
  });

  it("subtracts a negative offset (a server whose clock is behind this client's)", () => {
    expect(serverNow(-250, 1_000_000)).toBe(999_750);
  });

  it("reads this client's clock when none is given", () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_700_000_000_000);
    expect(serverNow(2_000)).toBe(1_700_000_002_000);
  });
});
