import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startTestServer, type TestServer } from "./helpers.ts";

/** 20 s on the ring plus the 3 s slack (F22). */
const DEADLINE_AFTER = 23_000;

let server: TestServer;

beforeAll(async () => {
  server = await startTestServer();
});

afterAll(async () => {
  await server.stop();
});

/** A started 2-Player game; returns both clients with their first game view taken. */
async function startedGame() {
  const alice = await server.create({ maxPlayers: 2 });
  const bob = await server.join(alice.code);
  alice.send({ type: "Start" });
  const [first] = await Promise.all([alice.next("game"), bob.next("game")]);
  const ids = await Promise.all([alice, bob].map(async (c) => (await c.next("welcome")).playerId));
  return { alice, bob, ids, view: first.view };
}

describe("the Turn deadline", () => {
  it("every push carries the server's clock, and the first decision is due 23 s after Start", async () => {
    const startedAt = server.scheduler.now();
    const alice = await server.create({ maxPlayers: 2 });
    const bob = await server.join(alice.code);
    alice.send({ type: "Start" });

    const message = await bob.next("game");

    expect(message.now).toBe(startedAt);
    expect(message.view.turnDeadline).toBe(startedAt + DEADLINE_AFTER);
  });

  it("R18/R19: an absent Player's Turn times out exactly once: the penalty, then the Turn passes", async () => {
    const { alice, bob, ids, view } = await startedGame();
    await alice.leave(); // the Seat stays; nobody will roll for Alice

    server.scheduler.advanceTo(view.turnDeadline - 1);
    server.scheduler.advanceTo(view.turnDeadline);
    const timedOut = await bob.next("game");

    expect(timedOut.events).toEqual([
      { type: "TimedOut", player: ids[0] },
      { type: "TimeoutPenaltyPaid", player: ids[0], amount: 250_000 },
      { type: "TurnPassed", player: ids[1], turn: 2 },
    ]);
    expect(timedOut.view).toMatchObject({ version: 1, turn: 2, currentPlayer: ids[1] });
    expect(timedOut.view.turnDeadline).toBe(view.turnDeadline + DEADLINE_AFTER);

    // Time moves on, but not to Bob's deadline: no second timeout for Alice's Turn.
    server.scheduler.advanceTo(view.turnDeadline + DEADLINE_AFTER - 1);
    bob.send({ type: "Roll", turn: 2 });
    const rolled = await bob.next("game");
    expect(rolled.view.version).toBe(2);
    expect(rolled.events[0]?.type).toBe("DiceRolled");
  });

  it("a stale wake-up (for a Turn already over) changes nothing", async () => {
    const { alice, bob, view } = await startedGame();
    const aliceWakeUp = server.scheduler.lastTaskAt(view.turnDeadline);
    server.scheduler.advanceTo(view.turnDeadline - 10_000);
    alice.send({ type: "Roll", turn: 1 });
    let [ended] = await Promise.all([alice.next("game"), bob.next("game")]);
    if (ended.view.phase.kind === "offer") {
      // The seed is random: a roll onto a University stops at the offer.
      alice.send({ type: "DeclineOffer", turn: 1 });
      [ended] = await Promise.all([alice.next("game"), bob.next("game")]);
    }

    server.scheduler.advanceTo(view.turnDeadline); // Alice's deadline, not Bob's
    aliceWakeUp(); // fires late anyway, as if a cancelled timer slipped through

    bob.send({ type: "Roll", turn: 2 });
    const next = await alice.next("game");
    expect(next.view.version).toBe(ended.view.version + 1);
    expect(next.events[0]?.type).toBe("DiceRolled");
    expect(alice.pending("game")).toEqual([]);
  });

  it("a wake-up that runs late still times the Turn out, and the next deadline counts from then", async () => {
    const { bob, ids, view } = await startedGame();

    server.scheduler.advanceTo(view.turnDeadline + 60_000);
    const timedOut = await bob.next("game");

    expect(timedOut.events[0]).toEqual({ type: "TimedOut", player: ids[0] });
    expect(timedOut.view.turnDeadline).toBe(view.turnDeadline + 60_000 + DEADLINE_AFTER);
  });
});
