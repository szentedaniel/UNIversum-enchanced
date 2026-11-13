import { describe, expect, it } from "vitest";
import {
  castVote,
  REMATCH_WINDOW_MS,
  seatsAfterRematch,
  shouldReturn,
  votersOf,
  windowExpired,
  windowExpiresAt,
  withdrawVote,
} from "#room/rematch.ts";

const seats = [{ playerId: "p1" }, { playerId: "p2" }, { playerId: "p3" }];

/** The Seats of the Players in `ids` count as connected. */
const connected =
  (...ids: string[]) =>
  (seat: { playerId: string }) =>
    ids.includes(seat.playerId);

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

describe("the all-agreed rule", () => {
  it("returns only once at least one vote is cast", () => {
    expect(shouldReturn(seats, new Set(), connected("p1", "p2", "p3"))).toBe(false);
  });

  it("waits for every connected Guest: one vote of two does not return", () => {
    expect(shouldReturn(seats, new Set(["p1"]), connected("p1", "p2"))).toBe(false);
    expect(shouldReturn(seats, new Set(["p1", "p2"]), connected("p1", "p2"))).toBe(true);
  });

  it("does not wait for a dropped Guest, whether they voted or not", () => {
    const seated = [{ playerId: "p1" }, { playerId: "p2" }];

    expect(shouldReturn(seated, new Set(["p1"]), connected("p1"))).toBe(true);
    expect(shouldReturn(seated, new Set(["p1", "p2"]), connected("p1"))).toBe(true);
  });

  it("neither expects nor lets a Bot vote", () => {
    const seated = [{ playerId: "p1" }, { playerId: "bot", bot: true }];

    expect(shouldReturn(seated, new Set(["p1"]), connected("p1", "bot"))).toBe(true);
    expect(shouldReturn(seated, new Set(["bot"]), connected("p1", "bot"))).toBe(false);
  });
});

describe("the rematch window", () => {
  const firstVoteAt = 1_000_000;

  it("lasts 30 s from the first vote", () => {
    expect(REMATCH_WINDOW_MS).toBe(30_000);
    expect(windowExpiresAt(firstVoteAt)).toBe(firstVoteAt + 30_000);
  });

  it("has not run out a moment before its end, and has run out at its end", () => {
    const expiresAt = windowExpiresAt(firstVoteAt);

    expect(windowExpired(expiresAt - 1, firstVoteAt)).toBe(false);
    expect(windowExpired(expiresAt, firstVoteAt)).toBe(true);
    expect(windowExpired(expiresAt + 1, firstVoteAt)).toBe(true);
  });
});

describe("the Seats after a rematch", () => {
  const seated = [
    { playerId: "p1", name: "one" },
    { playerId: "p2", name: "two" },
    { playerId: "bot", name: "bot", bot: true },
    { playerId: "p3", name: "three" },
  ];

  it("keeps the voters and the Bot Seats, in join order, unchanged", () => {
    expect(seatsAfterRematch(seated, new Set(["p3", "p1"]))).toEqual([
      { playerId: "p1", name: "one" },
      { playerId: "bot", name: "bot", bot: true },
      { playerId: "p3", name: "three" },
    ]);
  });

  it("keeps only the Bot Seats when nobody voted", () => {
    expect(seatsAfterRematch(seated, new Set())).toEqual([
      { playerId: "bot", name: "bot", bot: true },
    ]);
  });
});
