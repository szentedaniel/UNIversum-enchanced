import { describe, expect, it } from "vitest";
import { publicView, type Reveal } from "#index.ts";
import { accept, newGame, player, rollOnto, T0, withField, withPlayer } from "./helpers.ts";

// ADR-0005: the engine snapshots the Players, the Fields and the Doubler at
// every `emit`, so a Playback can show each event's effect at its own step.
// The reveals are read only through `apply`'s `Applied`, exactly like a Room
// server does.

const TAX = 30;
const CHICAGO = 9;
const VIENNA = 13;
const BERLIN = 15;

const playerOf = (reveal: Reveal, playerId: string): Reveal["players"][number] => {
  const found = reveal.players.find((p) => p.id === playerId);
  if (!found) throw new Error(`no Player ${playerId} in the reveal`);
  return found;
};

const cashOf = (reveal: Reveal, playerId: string): number => playerOf(reveal, playerId).cash;

describe("the engine's reveals", () => {
  it("ADR-0005: every Applied carries one reveal per event, in the same order", () => {
    const applied = rollOnto(newGame({ players: 2 }), TAX, T0);

    expect(applied.events.map((event) => event.type)).toEqual([
      "DiceRolled",
      "Moved",
      "TaxPaid",
      "TurnPassed",
    ]);
    expect(applied.reveals).toHaveLength(applied.events.length);
    // Every reveal is a whole board: each Player and each Field.
    for (const reveal of applied.reveals) {
      expect(reveal.players).toHaveLength(2);
      expect(reveal.fields).toHaveLength(applied.state.fields.length);
      expect(reveal.doubler).toBeNull();
    }
  });

  it("ADR-0005: the RentPaid reveal has the payer's cash down and the owner's up, the one before it neither", () => {
    const state = withField(newGame({ players: 2 }), CHICAGO, { owner: "p2", level: 1 });
    const applied = rollOnto(state, CHICAGO, T0);
    const rentIndex = applied.events.findIndex((event) => event.type === "RentPaid");
    const paid = applied.events[rentIndex];
    const before = applied.reveals[rentIndex - 1];
    const at = applied.reveals[rentIndex];

    if (paid?.type !== "RentPaid" || !before || !at) throw new Error("the Rent is missing");
    expect(at.players).not.toBe(before.players);
    expect(cashOf(before, "p1")).toBe(player(applied.state, "p1").cash + paid.amount);
    expect(cashOf(before, "p2")).toBe(player(applied.state, "p2").cash - paid.amount);
    expect(cashOf(at, "p1")).toBe(cashOf(before, "p1") - paid.amount);
    expect(cashOf(at, "p2")).toBe(cashOf(before, "p2") + paid.amount);
    // The settled state is the last reveal's, so nothing is left behind.
    expect(cashOf(at, "p1")).toBe(player(applied.state, "p1").cash);
    expect(cashOf(at, "p2")).toBe(player(applied.state, "p2").cash);
  });

  it("ADR-0005: a reveal's Rent and Wealth are the public view's, a Monopoly included", () => {
    // Vienna alone is no Monopoly; buying Berlin completes Group 4 and lifts Vienna's Rent.
    const state = withField(newGame({ players: 2 }), VIENNA, { owner: "p1", level: 1 });
    const rolled = rollOnto(state, BERLIN, T0);
    const bought = accept(
      rolled.state,
      { type: "BuyLevel", turn: rolled.state.turn, level: 1 },
      rolled.state.currentPlayer,
    );
    const levelIndex = bought.events.findIndex((event) => event.type === "LevelBought");
    // The roll is its own intent: its last reveal is the board the buy starts from.
    const before = rolled.reveals.at(-1);
    const at = bought.reveals[levelIndex];
    const view = publicView(bought.state);

    if (!before || !at) throw new Error("the Level's reveal is missing");
    const rentBefore = before.fields[VIENNA]?.rent ?? 0;
    const rentAfter = at.fields[VIENNA]?.rent ?? 0;
    expect(rentAfter).toBe(Math.round((rentBefore * 14) / 10));
    expect(rentAfter).toBe(view.fields[VIENNA]?.rent);
    expect(at.fields[VIENNA]?.value).toBe(view.fields[VIENNA]?.value);
    expect(at.fields[VIENNA]?.sale).toBe(view.fields[VIENNA]?.sale);
    expect(at.players.map((p) => p.wealth)).toEqual(view.players.map((p) => p.wealth));
    expect(at.doubler).toEqual(view.doubler);
  });

  it("ADR-0005: a reveal is a snapshot: rule code after the emit does not reach it", () => {
    // Quarantine rounds served: `passTurn` emits `TurnPassed`, then `beginTurn`
    // releases the Player and emits `QuarantineReleased`.
    const state = withPlayer(newGame({ players: 2 }), "p2", { quarantineRounds: 0 });
    const applied = rollOnto(state, TAX, T0);
    const passedIndex = applied.events.findIndex((event) => event.type === "TurnPassed");
    const releasedIndex = applied.events.findIndex((event) => event.type === "QuarantineReleased");
    const passed = applied.reveals[passedIndex];
    const released = applied.reveals[releasedIndex];

    if (!passed || !released) throw new Error("the Turn passing or the release is missing");
    expect(releasedIndex).toBe(passedIndex + 1);
    expect(playerOf(passed, "p2").quarantineRounds).toBe(0);
    expect(playerOf(released, "p2").quarantineRounds).toBeNull();
    expect(player(applied.state, "p2").quarantineRounds).toBeNull();
    // Each reveal owns its Players: a later emit never rewrites an earlier one.
    expect(passed.players[1]).not.toBe(released.players[1]);
  });
});
