import { describe, expect, it } from "vitest";
import { PLAYER_COLORS as BOARD_PLAYER_COLORS } from "#board/colors.ts";
import { INK, playerLook } from "#players.ts";
import { contrast } from "./wcag.ts";

// Spec: Client → Player colours. v1's four colours, the same in both themes,
// with a required shape per Seat so Players are told apart without colour.

const SEATS = [0, 1, 2, 3];

describe("a Seat's look", () => {
  it.each([
    [0, "#f29db6", "●"],
    [1, "#8db5e7", "▲"],
    [2, "#70c4a8", "■"],
    [3, "#ffcc00", "★"],
  ])("Seat %i is %s with the shape %s", (seat, color, shape) => {
    expect(playerLook(seat)).toMatchObject({ color, shape });
  });

  it("writes in ink #2b2238 on every Player colour, with AA contrast", () => {
    expect(INK).toBe("#2b2238");
    for (const seat of SEATS) {
      expect(contrast(INK, playerLook(seat).color)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("gives every Seat its own alien figure", () => {
    const figures = SEATS.map((seat) => playerLook(seat).figure);
    expect(new Set(figures).size).toBe(4);
    expect(figures[0]).toMatch(/alienPink/);
  });

  it("uses the same colours on the Board", () => {
    expect(BOARD_PLAYER_COLORS.map((n) => `#${n.toString(16).padStart(6, "0")}`)).toEqual(
      SEATS.map((seat) => playerLook(seat).color),
    );
  });
});
