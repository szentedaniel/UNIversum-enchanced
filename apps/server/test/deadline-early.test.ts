import { afterAll, beforeAll, expect, it } from "vitest";
import { startTestServer, withDeadline, type TestServer } from "./helpers.ts";

// One Room on its own server, so `lastTaskAt` can only mean this game's deadline.
let server: TestServer;

beforeAll(async () => {
  server = await startTestServer({ timing: { turnLimitMs: 1_000 } });
});

afterAll(async () => {
  await server.stop();
});

it("R17: a wake-up that fires 1 ms early is re-armed, and the Turn times out exactly once", async () => {
  const alice = await server.create({ maxPlayers: 2 });
  const bob = await server.join(alice.code);
  alice.send({ type: "Start" });
  const [first] = await Promise.all([alice.next("game"), bob.next("game")]);
  const ids = await Promise.all([alice, bob].map(async (c) => (await c.next("welcome")).playerId));
  const view = withDeadline(first);

  server.scheduler.advanceTo(view.turnDeadline - 1); // the clock is 1 ms short
  server.scheduler.fireEarly(view.turnDeadline); // as a Node timer that fired a touch early
  // The engine refused it as NOT_OFFERED, so nothing was broadcast.
  expect(alice.pending("game")).toEqual([]);
  expect(bob.pending("game")).toEqual([]);

  // The Room woke up again at the deadline: one Timeout, not zero or two.
  server.scheduler.advanceTo(view.turnDeadline);
  const timedOut = await alice.next("game");
  expect(timedOut.events).toEqual([
    { type: "TimedOut", player: ids[0] },
    { type: "TimeoutPenaltyPaid", player: ids[0], amount: 250_000 },
    { type: "TurnPassed", player: ids[1], turn: 2 },
  ]);
  expect((await bob.next("game")).events).toEqual(timedOut.events);
  server.scheduler.advanceTo(view.turnDeadline); // no task is due twice
  expect(alice.pending("game")).toEqual([]);
  expect(bob.pending("game")).toEqual([]);
});
