import type { PlayerView, Standing } from "@universum/rules";
import { describe, expect, it } from "vitest";
import { podiumOrder, type PodiumEntry } from "#pick/podium.ts";

// The result screen shows the server's standings (R80). The client only maps
// each ordered Player id to the view's Player; it holds no ranking logic.

function player(id: string, seat: number): PlayerView {
  return {
    id,
    name: { adjective: "happy", noun: "tiger" },
    seat,
    cash: 0,
    wealth: 0,
    position: 0,
    bankrupt: false,
    quarantineRounds: null,
    hasPcrTest: false,
    bot: false,
  };
}

const standing = (playerId: string, wealth: number): Standing => ({ player: playerId, wealth });

const names = (view: readonly PodiumEntry[]) => view.map((entry) => entry.player.id);

describe("the podium order", () => {
  it("follows the server's standings, winner first even when another Player is Wealthier", () => {
    const players = [player("p1", 0), player("p2", 1)];
    const standings = [standing("p2", 1_000_000), standing("p1", 3_000_000)];

    expect(names(podiumOrder(players, standings))).toEqual(["p2", "p1"]);
  });

  it("maps every standing to the view's Player, in order, with one place each", () => {
    const players = [player("p3", 2), player("p1", 0), player("p2", 1)];
    const standings = [standing("p1", 2_000_000), standing("p2", 1_600_000), standing("p3", 0)];

    expect(podiumOrder(players, standings)).toEqual([
      { player: players[1], place: 1 },
      { player: players[2], place: 2 },
      { player: players[0], place: 3 },
    ]);
  });

  it("skips a standing id the view does not carry", () => {
    const players = [player("p1", 0)];

    expect(podiumOrder(players, [standing("p1", 1), standing("gone", 0)])).toEqual([
      { player: players[0], place: 1 },
    ]);
  });
});
