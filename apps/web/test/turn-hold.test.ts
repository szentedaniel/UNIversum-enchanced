import { describe, expect, it } from "vitest";
import { turnLabelToShow, type TurnLabel } from "#playback/turn-hold.ts";

// Story 4 of ADR-0004: the turn card's heading and Turn number change when the
// decision gate opens, not when the push arrives. A first view, a reconnect or
// a reload has no previous Turn to show and switches at once.

describe("the turn card's held label", () => {
  const previous: TurnLabel = { turn: 2, currentPlayer: "p1" };
  const current: TurnLabel = { turn: 3, currentPlayer: "p2" };

  it("ADR-0004: keeps the previous Turn for the Playback, then switches with the controls", () => {
    expect(turnLabelToShow(previous, current, false, true)).toBe(previous);
    expect(turnLabelToShow(previous, current, true, true)).toBe(current);
  });

  it("ADR-0004: with no previous view, or no local Playback, shows the current Turn at once", () => {
    expect(turnLabelToShow(null, current, false, true)).toBe(current);
    expect(turnLabelToShow(previous, current, false, false)).toBe(current);
  });
});
