import { describe, expect, it } from "vitest";
import { castVote, votersOf, withdrawVote } from "#room/rematch.ts";

const seats = [{ playerId: "p1" }, { playerId: "p2" }, { playerId: "p3" }];

describe("the rematch votes", () => {
  it("keeps a cast vote without changing the set it came from", () => {
    const before = new Set(["p1"]);

    const after = castVote(before, "p2");

    expect([...after]).toEqual(["p1", "p2"]);
    expect([...before]).toEqual(["p1"]);
    // Casting again is harmless.
    expect([...castVote(after, "p2")]).toEqual(["p1", "p2"]);
  });

  it("takes a vote back, and withdrawing one that was never cast changes nothing", () => {
    const before = new Set(["p1", "p2"]);

    const after = withdrawVote(before, "p2");

    expect([...after]).toEqual(["p1"]);
    expect([...before]).toEqual(["p1", "p2"]);
    expect([...withdrawVote(after, "p3")]).toEqual(["p1"]);
  });

  it("lists the agreed Player ids in Seat order, not vote order", () => {
    const votes = new Set(["p3", "p1"]);

    expect(votersOf(votes, seats)).toEqual(["p1", "p3"]);
  });

  it("ignores a vote whose Player no longer has a Seat", () => {
    const votes = new Set(["p1", "gone", "p2"]);

    expect(votersOf(votes, seats)).toEqual(["p1", "p2"]);
  });

  it("lists nothing when nobody has voted", () => {
    expect(votersOf(new Set(), seats)).toEqual([]);
  });
});
