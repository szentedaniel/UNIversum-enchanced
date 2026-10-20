import type { PlayerView } from "@universum/rules";
import { describe, expect, it } from "vitest";
import { podiumOrder, type PodiumEntry } from "#pick/podium.ts";

// The result screen ranks the Players from the view only: the winner the
// server named, each Player's Wealth and whether they are Bankrupt (R80).

function player(
  id: string,
  seat: number,
  { cash, wealth, bankrupt = false }: { cash: number; wealth: number; bankrupt?: boolean },
): PlayerView {
  return {
    id,
    name: { adjective: "happy", noun: "tiger" },
    seat,
    cash,
    wealth,
    position: 0,
    bankrupt,
    quarantineRounds: null,
    hasPcrTest: false,
  };
}

const names = (view: readonly PodiumEntry[]) => view.map((entry) => entry.player.id);

describe("the podium order", () => {
  it("puts the winner first, even when another Player is Wealthier", () => {
    const players = [
      player("p1", 0, { cash: 3_000_000, wealth: 3_000_000 }),
      player("p2", 1, { cash: 1_000_000, wealth: 1_000_000 }),
    ];

    expect(names(podiumOrder(players, "p2"))).toEqual(["p2", "p1"]);
  });

  it("ranks the rest by Wealth, then more cash, then the earlier Seat", () => {
    const players = [
      player("p1", 0, { cash: 100_000, wealth: 100_000 }),
      player("p2", 1, { cash: 2_000_000, wealth: 2_000_000 }),
      player("p3", 2, { cash: 1_600_000, wealth: 2_000_000 }),
      player("p4", 3, { cash: 2_000_000, wealth: 2_000_000 }),
    ];

    expect(names(podiumOrder(players, "p1"))).toEqual(["p1", "p2", "p4", "p3"]);
  });

  it("puts Bankrupt Players last, greyed, whatever their cash shows", () => {
    const players = [
      player("p1", 0, { cash: 100_000, wealth: 100_000 }),
      player("p2", 1, { cash: 0, wealth: 0, bankrupt: true }),
      player("p3", 2, { cash: 0, wealth: 0, bankrupt: true }),
    ];

    expect(names(podiumOrder(players, "p1"))).toEqual(["p1", "p2", "p3"]);
  });

  it("numbers every place from 1", () => {
    const players = [
      player("p1", 0, { cash: 100_000, wealth: 100_000 }),
      player("p2", 1, { cash: 50_000, wealth: 50_000 }),
      player("p3", 2, { cash: 0, wealth: 0, bankrupt: true }),
    ];

    expect(podiumOrder(players, "p1").map((entry) => entry.place)).toEqual([1, 2, 3]);
  });
});
