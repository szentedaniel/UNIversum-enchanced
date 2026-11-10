import { describe, expect, it } from "vitest";
import { botIntent, publicView } from "#index.ts";
import { newGame } from "./helpers.ts";

describe("Bot policy", () => {
  it("Roll: rolls the dice", () => {
    const state = newGame();

    expect(botIntent(publicView(state))).toEqual({ type: "Roll", turn: state.turn });
  });
});
