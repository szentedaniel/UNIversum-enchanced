import { TURN_SLACK_MS } from "@universum/rules";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startTestServer, withDeadline, type TestServer } from "./helpers.ts";

/** A 1 s ring (the e2e override) plus the 3 s slack. */
const TURN_LIMIT_MS = 1_000;
const DEADLINE_AFTER = TURN_LIMIT_MS + 3_000;
/** 10 s "minutes": shorter than the 60 s default, long enough for the late-wake-up test. */
const MINUTE_MS = 10_000;

let server: TestServer;

beforeAll(async () => {
  server = await startTestServer({ timing: { turnLimitMs: TURN_LIMIT_MS, minuteMs: MINUTE_MS } });
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
  return { alice, bob, ids, view: withDeadline(first) };
}

describe("the Turn deadline", () => {
  it("every push carries the server's clock, the first decision is due one limit plus slack after Start, and the override reaches the ring and the Minute limit", async () => {
    const startedAt = server.scheduler.now();
    const alice = await server.create({ maxPlayers: 2 });
    const bob = await server.join(alice.code);
    alice.send({ type: "Start" });

    const message = await bob.next("game");

    expect(message.now).toBe(startedAt);
    expect(message.view.turnDeadline).toBe(startedAt + DEADLINE_AFTER);
    expect(message.view.turnTimer).toEqual({
      endsAt: startedAt + TURN_LIMIT_MS,
      limitMs: TURN_LIMIT_MS,
    });
    expect(message.view.endsAt).toBe(startedAt + message.view.settings.minuteLimit * MINUTE_MS);
  });

  it("the override wins over a Room's longer Turn timer", async () => {
    const startedAt = server.scheduler.now();
    const alice = await server.create({ maxPlayers: 2, turnLimitMs: 30_000 });
    const bob = await server.join(alice.code);
    alice.send({ type: "Start" });

    const message = await bob.next("game");

    expect(message.view.turnDeadline).toBe(startedAt + DEADLINE_AFTER);
    expect(message.view.turnTimer).toEqual({
      endsAt: startedAt + TURN_LIMIT_MS,
      limitMs: TURN_LIMIT_MS,
    });
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
    // The new deadline counts from the end of the timeout's Playback (ADR-0004).
    expect(timedOut.view.turnDeadline).toBe(timedOut.view.actsAfter + DEADLINE_AFTER);

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
    server.scheduler.advanceTo(view.turnDeadline - 1_000);
    alice.send({ type: "Roll", turn: 1 });
    let [ended] = await Promise.all([alice.next("game"), bob.next("game")]);
    if (ended.view.phase.kind === "offer") {
      // The seed is random: a roll onto a University stops at the offer, which
      // opens only when the roll's Playback has ended.
      server.scheduler.advanceTo(ended.view.actsAfter);
      alice.send({ type: "DeclineOffer", turn: 1 });
      [ended] = await Promise.all([alice.next("game"), bob.next("game")]);
    }

    server.scheduler.advanceTo(view.turnDeadline); // Alice's deadline, not Bob's
    aliceWakeUp(); // fires late anyway, as if a cancelled timer slipped through

    server.scheduler.advanceTo(ended.view.actsAfter); // Bob's decision opens now
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
    expect(timedOut.view.turnDeadline).toBe(timedOut.view.actsAfter + DEADLINE_AFTER);
  });
});

describe("a Room's Turn timer setting", () => {
  let roomServer: TestServer;

  beforeAll(async () => {
    roomServer = await startTestServer();
  });

  afterAll(async () => {
    await roomServer.stop();
  });

  it("R17/R18: a 10 s Room's deadline, ring and Timeout penalty follow the setting", async () => {
    const startedAt = roomServer.scheduler.now();
    const alice = await roomServer.create({ maxPlayers: 2, turnLimitMs: 10_000 });
    const bob = await roomServer.join(alice.code);
    alice.send({ type: "Start" });

    const message = await bob.next("game");
    const view = withDeadline(message);
    const ids = await Promise.all(
      [alice, bob].map(async (client) => (await client.next("welcome")).playerId),
    );
    expect(view.turnDeadline).toBe(startedAt + 10_000 + TURN_SLACK_MS);
    expect(view.turnTimer).toEqual({ endsAt: startedAt + 10_000, limitMs: 10_000 });

    roomServer.scheduler.advanceTo(view.turnDeadline - 1);
    roomServer.scheduler.advanceTo(view.turnDeadline);
    const timedOut = await bob.next("game");

    expect(timedOut.events).toEqual([
      { type: "TimedOut", player: ids[0] },
      { type: "TimeoutPenaltyPaid", player: ids[0], amount: 250_000 },
      { type: "TurnPassed", player: ids[1], turn: 2 },
    ]);
    expect(timedOut.view.turnDeadline).toBe(timedOut.view.actsAfter + 10_000 + TURN_SLACK_MS);
  });
});
