import { afterEach, describe, expect, it } from "vitest";
import { newGuestToken, startTestServer, T0, type TestClient, type TestServer } from "./helpers.ts";

const MINUTE = 60_000;

// One server at a time per file (the matchmaker is a singleton); each test
// stops whatever it started.
const running: TestServer[] = [];

async function start(options?: Parameters<typeof startTestServer>[0]): Promise<TestServer> {
  const server = await startTestServer(options);
  running.push(server);
  return server;
}

afterEach(async () => {
  // oxlint-disable-next-line no-await-in-loop -- one server at a time (the matchmaker is a singleton)
  for (const server of running.splice(0)) await server.stop();
});

/** A started 2-Player game, with its first push taken; optional Guest tokens keep a Seat reachable. */
async function startedGame(server: TestServer, guestTokens?: [string, string]) {
  const alice = await server.create({
    maxPlayers: 2,
    ...(guestTokens && { guestToken: guestTokens[0] }),
  });
  const bob = await server.join(alice.code, guestTokens ? { guestToken: guestTokens[1] } : {});
  const aliceId = (await alice.next("welcome")).playerId;
  const bobId = (await bob.next("welcome")).playerId;
  alice.send({ type: "Start" });
  const [first] = await Promise.all([alice.next("game"), bob.next("game")]);
  return { alice, bob, aliceId, bobId, code: alice.code, first };
}

/** The Minute limit runs out in the first Turn: the game ends, with its final push taken. */
async function endedGame(server: TestServer, ...clients: TestClient[]) {
  server.scheduler.advanceTo(T0 + 50 * MINUTE);
  const [first] = await Promise.all(clients.map((client) => client.next("game")));
  if (first === undefined) throw new Error("no client to wait for");
  return first;
}

/** The push every client gets next. */
const pushesTo = (...clients: TestClient[]) => Promise.all(clients.map((c) => c.next("game")));

describe("a rematch vote", () => {
  it("is refused while the Room is a Lobby and while its game runs", async () => {
    const server = await start();
    const alice = await server.create({ maxPlayers: 2 });
    const aliceId = (await alice.next("welcome")).playerId;
    await alice.until("lobby", (lobby) => lobby.seats.length === 1);

    for (const intent of [{ type: "Rematch" }, { type: "WithdrawRematch" }]) {
      alice.send(intent);
      // oxlint-disable-next-line no-await-in-loop -- one refusal after the other
      expect(await alice.next("rejected")).toEqual({ code: "REMATCH_NOT_OFFERED" });
    }
    expect(alice.pending("game")).toEqual([]);

    const bob = await server.join(alice.code);
    await bob.next("welcome");
    alice.send({ type: "Start" });
    const [first] = await Promise.all([alice.next("game"), bob.next("game")]);
    expect("rematch" in first).toBe(false);

    for (const [client, intent] of [
      [alice, { type: "Rematch" }],
      [bob, { type: "WithdrawRematch" }],
    ] as const) {
      client.send(intent);
      // oxlint-disable-next-line no-await-in-loop -- one refusal after the other
      expect(await client.next("rejected")).toEqual({ code: "REMATCH_NOT_OFFERED" });
    }
    // An unknown extra key is a malformed intent, not a refused vote.
    alice.send({ type: "Rematch", playerId: aliceId });
    expect(await alice.next("rejected")).toEqual({ code: "MALFORMED" });
    expect(alice.pending("game")).toEqual([]);
    expect(bob.pending("game")).toEqual([]);
  });

  it("lists the agreed Player ids on every client once the game ended, and withdraws them", async () => {
    const server = await start();
    const { alice, bob, aliceId, bobId } = await startedGame(server);
    const ended = await endedGame(server, alice, bob);

    // The push that ends the game already opens the Podium with no votes.
    expect(ended.rematch).toEqual([]);
    expect(ended.view.phase).toMatchObject({ kind: "gameOver" });

    alice.send({ type: "Rematch" });
    const [aliceSees, bobSees] = await pushesTo(alice, bob);
    if (!aliceSees || !bobSees) throw new Error("both clients get the vote");

    expect(aliceSees.rematch).toEqual([aliceId]);
    expect(bobSees.rematch).toEqual([aliceId]);
    expect(aliceSees.events).toEqual([]);
    expect(aliceSees.reveals).toEqual([]);
    expect(aliceSees.now).toBe(server.scheduler.now());
    expect(aliceSees.view.version).toBe(ended.view.version);

    bob.send({ type: "Rematch" });
    // In Seat order, not vote order.
    expect((await pushesTo(alice, bob))[0]?.rematch).toEqual([aliceId, bobId]);

    alice.send({ type: "WithdrawRematch" });
    expect((await pushesTo(alice, bob))[0]?.rematch).toEqual([bobId]);

    // Repeating either is harmless.
    alice.send({ type: "WithdrawRematch" });
    expect((await pushesTo(alice, bob))[0]?.rematch).toEqual([bobId]);
    bob.send({ type: "Rematch" });
    expect((await pushesTo(alice, bob))[0]?.rematch).toEqual([bobId]);
    expect(alice.pending("rejected")).toEqual([]);
    expect(bob.pending("rejected")).toEqual([]);
  });

  it("keeps the vote when its Guest drops and comes back by Guest token", async () => {
    const server = await start();
    const token = newGuestToken();
    const { alice, bob, aliceId, code } = await startedGame(server, [token, newGuestToken()]);
    await endedGame(server, alice, bob);

    alice.send({ type: "Rematch" });
    await pushesTo(alice, bob);
    await alice.drop();

    const again = await server.join(code, { guestToken: token });

    expect(await again.next("welcome")).toEqual({ playerId: aliceId });
    const current = await again.next("game");
    expect(current.rematch).toEqual([aliceId]);
    expect(current.events).toEqual([]);
    expect(current.reveals).toEqual([]);
    expect(current.view.phase).toMatchObject({ kind: "gameOver" });
  });

  it("refuses a Bot's vote", async () => {
    const server = await start();
    const alice = await server.create({ maxPlayers: 2 });
    await alice.next("welcome");
    alice.send({ type: "AddBot" });
    await alice.until("lobby", (lobby) => lobby.seats.length === 2);
    alice.send({ type: "Start" });
    await alice.next("game");
    await endedGame(server, alice);

    const room = server.room(alice.code);
    const bot = room?.seats.find((seat) => seat.bot === true);
    if (!room || !bot) throw new Error("the Room has no Bot Seat");
    expect(room.rematch(bot)).toBe("NOT_OFFERED");
    expect(room.withdrawRematch(bot)).toBe("NOT_OFFERED");
    expect(alice.pending("game")).toEqual([]);
  });
});
