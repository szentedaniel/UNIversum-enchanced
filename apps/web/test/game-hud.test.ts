import { describe, expect, it } from "vitest";
import { formatClock } from "#components/GameHud.tsx";

// R74: the Minute pill shows the minutes and seconds left until the Minute
// limit's end. This is the text half of the rule; tabletop.spec.ts's R74 test
// watches the pill against the view's `endsAt` in a running game.

describe("R74: the countdown text", () => {
  it("R74: shows m:ss with zero-padded seconds", () => {
    expect(formatClock(9_000)).toBe("0:09");
    expect(formatClock(60_000)).toBe("1:00");
    expect(formatClock(65_000)).toBe("1:05");
    expect(formatClock(10 * 60_000 + 7_000)).toBe("10:07");
  });

  it("R74: rounds a partial second up, so 0:00 shows only at the end", () => {
    expect(formatClock(1)).toBe("0:01");
    expect(formatClock(999)).toBe("0:01");
    expect(formatClock(1_001)).toBe("0:02");
    expect(formatClock(59_001)).toBe("1:00");
  });

  it("R74: shows 0:00 once the end has passed, never a negative time", () => {
    expect(formatClock(0)).toBe("0:00");
    expect(formatClock(-1)).toBe("0:00");
    expect(formatClock(-90_000)).toBe("0:00");
  });

  it("R74: keeps minutes past 9 whole, so a 50-minute Room shows 50:00", () => {
    expect(formatClock(9 * 60_000 + 59_000)).toBe("9:59");
    expect(formatClock(50 * 60_000)).toBe("50:00");
    expect(formatClock(50 * 60_000 - 1)).toBe("50:00");
  });
});
