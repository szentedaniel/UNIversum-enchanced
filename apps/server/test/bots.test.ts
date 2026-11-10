import { PLAYER_NAME_ADJECTIVES, PLAYER_NAME_NOUNS } from "@universum/protocol";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startTestServer, type TestClient, type TestServer } from "./helpers.ts";

let server: TestServer;

beforeAll(async () => {
  server = await startTestServer();
});

afterAll(async () => {
  await server.stop();
});

/** Creates a 3-Seat Room and has a second Guest join; both have their Lobby read. */
async function twoGuests(): Promise<{ alice: TestClient; bob: TestClient }> {
  const alice = await server.create({ maxPlayers: 3 });
  const bob = await server.join(alice.code);
  await alice.until("lobby", (lobby) => lobby.seats.length === 2);
  await bob.until("lobby", (lobby) => lobby.seats.length === 2);
  return { alice, bob };
}

describe("Bots in the Lobby", () => {
  it("seats a Bot on the next empty Seat with a Player name and the Bot flag", async () => {
    const alice = await server.create({ maxPlayers: 3 });
    const aliceId = (await alice.next("welcome")).playerId;
    await alice.next("lobby");

    alice.send({ type: "AddBot" });
    const lobby = await alice.until("lobby", (message) => message.seats.length === 2);

    expect(lobby.seats[0]).toEqual({
      playerId: aliceId,
      name: expect.any(Object),
    });
    const bot = lobby.seats[1]!;
    expect(bot.bot).toBe(true);
    expect(PLAYER_NAME_ADJECTIVES).toContain(bot.name.adjective);
    expect(PLAYER_NAME_NOUNS).toContain(bot.name.noun);
    // A Bot's name is as easy to tell apart as a Guest's.
    expect(bot.name).not.toEqual(lobby.seats[0]?.name);
  });

  it("lets any seated Player add a Bot, and everyone sees the Seat fill", async () => {
    const { alice, bob } = await twoGuests();

    bob.send({ type: "AddBot" });
    const [seenByAlice, seenByBob] = await Promise.all([
      alice.until("lobby", (message) => message.seats.length === 3),
      bob.until("lobby", (message) => message.seats.length === 3),
    ]);

    expect(seenByAlice).toEqual(seenByBob);
    expect(seenByAlice.seats[2]?.bot).toBe(true);
  });

  it("takes a Bot off its Seat for any seated Player", async () => {
    const { alice, bob } = await twoGuests();
    alice.send({ type: "AddBot" });
    const withBot = await alice.until("lobby", (message) => message.seats.length === 3);
    const bot = withBot.seats[2]!;

    bob.send({ type: "RemoveBot", playerId: bot.playerId });
    const [seenByAlice, seenByBob] = await Promise.all([
      alice.until("lobby", (message) => message.seats.length === 2),
      bob.until("lobby", (message) => message.seats.length === 2),
    ]);

    expect(seenByAlice).toEqual(seenByBob);
    expect(seenByAlice.seats.some((seat) => seat.playerId === bot.playerId)).toBe(false);
  });

  it("refuses to take a Guest off their Seat", async () => {
    const { alice, bob } = await twoGuests();
    const bobId = (await bob.next("welcome")).playerId;

    alice.send({ type: "RemoveBot", playerId: bobId });

    expect(await alice.next("rejected")).toEqual({ code: "NOT_OFFERED" });
    expect(alice.pending("lobby")).toEqual([]);
  });

  it("refuses a Bot when every Seat is taken", async () => {
    const alice = await server.create({ maxPlayers: 2 });
    await server.join(alice.code);
    await alice.until("lobby", (message) => message.seats.length === 2);

    alice.send({ type: "AddBot" });

    expect(await alice.next("rejected")).toEqual({ code: "ROOM_FULL" });
    expect(alice.pending("lobby")).toEqual([]);
  });

  it("refuses AddBot and RemoveBot once the game runs", async () => {
    const alice = await server.create({ maxPlayers: 2 });
    await server.join(alice.code);
    await alice.until("lobby", (message) => message.seats.length === 2);
    alice.send({ type: "Start" });
    await alice.next("game");

    alice.send({ type: "AddBot" });
    expect(await alice.next("rejected")).toEqual({ code: "NOT_OFFERED" });

    alice.send({ type: "RemoveBot", playerId: "nobody" });
    expect(await alice.next("rejected")).toEqual({ code: "NOT_OFFERED" });
  });

  it("answers a RemoveBot without a Player id with MALFORMED", async () => {
    const alice = await server.create();

    alice.send({ type: "RemoveBot" });

    expect(await alice.next("rejected")).toEqual({ code: "MALFORMED" });
  });

  it("leaves the Lobby list when Bots fill the last Seat, and comes back when one is removed", async () => {
    const list = await server.watchLobbyList();
    const alice = await server.create({ maxPlayers: 2 });
    await list.until((l) => l.get(alice.code)?.players === 1);

    alice.send({ type: "AddBot" });
    const withBot = await alice.until("lobby", (message) => message.seats.length === 2);
    // No empty Seat left: a stranger looking for a game has nothing to join.
    await list.until((l) => l.get(alice.code) === undefined);

    alice.send({ type: "RemoveBot", playerId: withBot.seats[1]!.playerId });
    await list.until((l) => l.get(alice.code)?.players === 1);
  });

  it("refuses a RemoveBot naming no Seat", async () => {
    const alice = await server.create();

    alice.send({ type: "RemoveBot", playerId: "nobody" });

    expect(await alice.next("rejected")).toEqual({ code: "NOT_OFFERED" });
  });
});
