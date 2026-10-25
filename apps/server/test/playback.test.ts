import { playbackOf, START_CASH } from "@universum/rules";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startTestServer, withDeadline, type TestServer } from "./helpers.ts";

/** A 1 s ring (the e2e override) plus the 3 s slack. */
const TURN_LIMIT_MS = 1_000;
const DEADLINE_AFTER = TURN_LIMIT_MS + 3_000;

let server: TestServer;

beforeAll(async () => {
  server = await startTestServer({ timing: { turnLimitMs: TURN_LIMIT_MS } });
});

afterAll(async () => {
  await server.stop();
});

/** A started 2-Player game; returns both clients with the first game view taken. */
async function startedGame() {
  const alice = await server.create({ maxPlayers: 2 });
  const bob = await server.join(alice.code);
  alice.send({ type: "Start" });
  const [first] = await Promise.all([alice.next("game"), bob.next("game")]);
  const ids = await Promise.all([alice, bob].map(async (c) => (await c.next("welcome")).playerId));
  return { alice, bob, code: alice.code, ids, first, view: withDeadline(first) };
}

describe("the server holds the next decision until the Playback ends", () => {
  it("ADR-0004: an intent before actsAfter is refused with PLAYBACK_RUNNING and changes nothing", async () => {
    const { alice, bob, code } = await startedGame();

    alice.send({ type: "Roll", turn: 1 });
    const rolled = await bob.next("game");
    await alice.next("game");
    const afterRoll = withDeadline(rolled);
    const version = server.room(code)?.game?.version;
    // The one legal intent of the decision the roll led to: an offer is
    // declined by the Player who rolled, otherwise the next Player rolls.
    const offer = rolled.view.phase.kind === "offer";
    const sender = offer ? alice : bob;
    const intent = offer
      ? { type: "DeclineOffer" as const, turn: rolled.view.turn }
      : { type: "Roll" as const, turn: rolled.view.turn };

    sender.send(intent);

    expect(await sender.next("rejected")).toEqual({ code: "PLAYBACK_RUNNING" });
    expect(server.room(code)?.game).toMatchObject({
      version,
      turn: rolled.view.turn,
      turnDeadline: rolled.view.turnDeadline,
    });
    expect(alice.pending("game")).toEqual([]);
    expect(bob.pending("game")).toEqual([]);

    // At exactly actsAfter the same intent is accepted.
    server.scheduler.advanceTo(afterRoll.actsAfter);
    sender.send(intent);
    await Promise.all([alice.next("game"), bob.next("game")]);

    expect(server.room(code)?.game?.version).toBe((version ?? 0) + 1);
  });

  it("ADR-0004: the timeout wake-up fires at the later deadline, not before", async () => {
    const { alice, bob, ids, view } = await startedGame();
    await alice.leave(); // nobody rolls for Alice: her Turn must time out

    server.scheduler.advanceTo(view.turnDeadline - 1);
    expect(bob.pending("game")).toEqual([]);
    server.scheduler.advanceTo(view.turnDeadline);
    const message = await bob.next("game");
    const timed = withDeadline(message);

    expect(message.events).toEqual([
      { type: "TimedOut", player: ids[0] },
      { type: "TimeoutPenaltyPaid", player: ids[0], amount: 250_000 },
      { type: "TurnPassed", player: ids[1], turn: 2 },
    ]);
    expect(timed.actsAfter).toBe(view.turnDeadline + playbackOf(message.events));
    expect(timed.turnDeadline).toBe(timed.actsAfter + DEADLINE_AFTER);

    // Bob's deadline is the later one: nothing before it, the timeout at it.
    server.scheduler.advanceTo(timed.turnDeadline - 1);
    expect(bob.pending("game")).toEqual([]);
    server.scheduler.advanceTo(timed.turnDeadline);
    const next = await bob.next("game");
    expect(next.events[0]).toEqual({ type: "TimedOut", player: ids[1] });
  });
});

describe("the reveals a push carries", () => {
  it("ADR-0005: a game push carries one reveal per event; the first push carries none", async () => {
    const { alice, bob, first, ids } = await startedGame();

    expect(first.events).toEqual([]);
    expect(first.reveals).toEqual([]);

    alice.send({ type: "Roll", turn: 1 });
    const rolled = await bob.next("game");
    await alice.next("game");

    expect(rolled.reveals).toHaveLength(rolled.events.length);
    // The dice' own reveal is the board before the move: everyone at Start, nothing owned.
    const [dice] = rolled.reveals;
    expect(dice?.players.map((p) => p.position)).toEqual([0, 0]);
    expect(dice?.players[0]).toMatchObject({ id: ids[0], cash: START_CASH, wealth: START_CASH });
    expect(dice?.fields).toHaveLength(rolled.view.fields.length);
    expect(dice?.fields.every((field) => field.owner === null)).toBe(true);
    // The move's reveal carries the mover where the final view has them.
    const moved = rolled.reveals[rolled.events.findIndex((event) => event.type === "Moved")];
    expect(moved?.players.map((p) => p.position)).toEqual(
      rolled.view.players.map((p) => p.position),
    );
  });

  it("ADR-0005: a reconnect push carries no events and no reveals", async () => {
    const { bob } = await startedGame();
    await bob.drop();
    const back = await server.reconnect(bob);
    const current = await back.next("game");

    expect(current.events).toEqual([]);
    expect(current.reveals).toEqual([]);
  });

  it("ADR-0005: the stored log keeps the events only, never the reveals", async () => {
    const { alice } = await startedGame();
    alice.send({ type: "Roll", turn: 1 });
    const rolled = await alice.next("game");
    const stored = server.store.events(alice.code);

    expect(stored.flatMap((row) => row.events)).toEqual(rolled.events);
    expect(JSON.stringify(stored)).not.toContain("reveals");
  });
});
