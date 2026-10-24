import { describe, expect, it } from "vitest";
import { FIELD_COUNT, STATE_VERSION } from "#index.ts";
import { newGame, T0 } from "./helpers.ts";

describe("game setup", () => {
  it("R6: turn order and Player colours follow join order (Seat i gets colour i)", () => {
    const state = newGame({ players: 4 });

    expect(state.players.map((p) => p.id)).toEqual(["p1", "p2", "p3", "p4"]);
    expect(state.players.map((p) => p.seat)).toEqual([0, 1, 2, 3]);
  });

  it("R6: a 2-Player Room seats exactly its two Players", () => {
    const state = newGame({ settings: { maxPlayers: 2 } });

    expect(state.players.map((p) => [p.id, p.seat])).toEqual([
      ["p1", 0],
      ["p2", 1],
    ]);
  });

  it("R7: every Player starts with 2,500,000 on Start, no PCR test, not in Quarantine and not Bankrupt", () => {
    const state = newGame();

    for (const p of state.players) {
      expect(p).toMatchObject({
        cash: 2_500_000,
        position: 0,
        hasPcrTest: false,
        quarantineRounds: null,
        bankrupt: false,
      });
    }
  });

  it("R7: the server-made Player name is kept with the Seat", () => {
    const state = newGame({ players: 2 });

    expect(state.players[1]?.name).toEqual({ adjective: "adj1", noun: "noun1" });
  });

  it("R8: the first Seat moves first, on Turn 1, awaiting the roll", () => {
    const state = newGame();

    expect(state.currentPlayer).toBe("p1");
    expect(state.turn).toBe(1);
    expect(state.phase).toEqual({ kind: "awaitingRoll" });
  });

  it("R9: the Board has 32 Fields, all unowned at Level 0, and no Doubler", () => {
    const state = newGame();

    expect(FIELD_COUNT).toBe(32);
    expect(state.fields).toHaveLength(32);
    expect(state.fields.every((f) => f.owner === null && f.level === 0)).toBe(true);
    expect(state.doubler).toBeNull();
  });

  it("R11: the Minute limit becomes the end time `now + minutes`", () => {
    const state = newGame({ settings: { minuteLimit: 15 }, now: T0 });

    expect(state.settings.minuteLimit).toBe(15);
    expect(state.endsAt).toBe(T0 + 15 * 60_000);
  });

  it("starts at state version 0 with the current state shape version", () => {
    const state = newGame();

    expect(state.version).toBe(0);
    expect(state.stateVersion).toBe(STATE_VERSION);
  });

  it("is plain JSON, so the Room server can store and restore it", () => {
    const state = newGame();

    expect(JSON.parse(JSON.stringify(state))).toEqual(state);
  });
});
