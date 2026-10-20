import { MatchMakeError } from "@colyseus/sdk";
import { PLAYER_NAME_ADJECTIVES, PLAYER_NAME_NOUNS, type GameMessage } from "@universum/protocol";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startTestServer, type TestClient, type TestServer } from "./helpers.ts";

let server: TestServer;

beforeAll(async () => {
  server = await startTestServer();
});

afterAll(async () => {
  await server.stop();
});

/** Creates a Room of `players` and fills every Seat; returns the clients in join order. */
async function fullLobby(players: 2 | 3 | 4): Promise<TestClient[]> {
  const creator = await server.create({ maxPlayers: players });
  const clients = [creator];
  for (let i = 1; i < players; i++) {
    // oxlint-disable-next-line no-await-in-loop -- one after another: join order is turn order
    clients.push(await server.join(creator.code));
  }
  return clients;
}

/** Fills a Lobby, starts it, and returns the clients with everyone's first game view taken. */
async function startedGame(players: 2 | 3 | 4) {
  const clients = await fullLobby(players);
  clients[0]?.send({ type: "Start" });
  const views = await Promise.all(clients.map((c) => c.next("game")));
  const ids = await Promise.all(clients.map(async (c) => (await c.next("welcome")).playerId));
  return { clients, ids, view: views[0]!.view };
}

/** The current Player of `view` sends `intent`; returns the push everyone got. */
async function play(
  clients: TestClient[],
  view: GameMessage["view"],
  intent: Record<string, unknown>,
): Promise<GameMessage> {
  const pushes = clients.map((c) => c.next("game"));
  const current = view.players.findIndex((p) => p.id === view.currentPlayer);
  clients[current]!.send({ ...intent, turn: view.turn });
  const [first] = await Promise.all(pushes);
  return first!;
}

/** The roll the phase offers: the dice, or the roll for 12 from Quarantine. */
const rollFor = (view: GameMessage["view"]) => ({
  type: view.phase.kind === "quarantineChoice" ? "RollForTwelve" : "Roll",
});

/** The current Player rolls, and declines the offer the roll stops at, if any, so the Turn passes. */
async function playTurn(clients: TestClient[], view: GameMessage["view"]): Promise<GameMessage> {
  const rolled = await play(clients, view, rollFor(view));
  if (rolled.view.phase.kind !== "offer") return rolled;
  return play(clients, rolled.view, { type: "DeclineOffer" });
}

/** True when the view stops at an offer of Levels (not a Museum buy or a Buyout). */
function levelOffer(view: GameMessage["view"]): boolean {
  return view.phase.kind === "offer" && view.phase.levels.length > 0;
}

describe("creating and joining a Room", () => {
  it("R4: creates a Room under a 6-digit Room code, with 4 Players and 50 minutes by default", async () => {
    const alice = await server.create();

    expect(alice.code).toMatch(/^[1-9]\d{5}$/);
    expect(await alice.next("lobby")).toMatchObject({
      code: alice.code,
      settings: { maxPlayers: 4, minuteLimit: 50 },
    });
  });

  it("R4: gives every Room its own code", async () => {
    const rooms = await Promise.all([server.create(), server.create(), server.create()]);

    expect(new Set(rooms.map((r) => r.code)).size).toBe(3);
  });

  it("refuses create options outside the allowed settings", async () => {
    await expect(server.sdk.create("game", { maxPlayers: 9 })).rejects.toBeInstanceOf(
      MatchMakeError,
    );
  });

  it("seats the creator with a public Player id and a Player name from the word lists", async () => {
    const alice = await server.create();

    const { playerId } = await alice.next("welcome");
    const lobby = await alice.next("lobby");

    expect(lobby.seats).toHaveLength(1);
    expect(lobby.seats[0]?.playerId).toBe(playerId);
    expect(PLAYER_NAME_ADJECTIVES).toContain(lobby.seats[0]?.name.adjective);
    expect(PLAYER_NAME_NOUNS).toContain(lobby.seats[0]?.name.noun);
  });

  it("joins by Room code, and every Player sees the Seats fill in join order", async () => {
    const alice = await server.create({ maxPlayers: 3 });
    const bob = await server.join(alice.code);
    const aliceId = (await alice.next("welcome")).playerId;
    const bobId = (await bob.next("welcome")).playerId;

    await alice.next("lobby"); // just Alice
    const seenByAlice = await alice.next("lobby");
    const seenByBob = await bob.until("lobby", (l) => l.seats.length === 2);

    expect(seenByAlice.seats.map((s) => s.playerId)).toEqual([aliceId, bobId]);
    expect(seenByBob).toEqual(seenByAlice);
    expect(seenByAlice.seats[0]?.name).not.toEqual(seenByAlice.seats[1]?.name);
  });

  it("refuses a Room code that does not exist", async () => {
    await expect(server.join("100000")).rejects.toBeInstanceOf(MatchMakeError);
  });

  it("refuses a Guest once every Seat is taken", async () => {
    const [alice] = await fullLobby(2);

    await expect(server.join(alice!.code)).rejects.toBeInstanceOf(MatchMakeError);
  });

  it("frees a Lobby Seat when its Player leaves", async () => {
    const alice = await server.create({ maxPlayers: 2 });
    const bob = await server.join(alice.code);
    await bob.leave();

    await alice.next("lobby");
    await alice.next("lobby");
    const lobby = await alice.next("lobby");

    expect(lobby.seats).toHaveLength(1);
  });
});

describe("starting the game", () => {
  it("R5: refuses Start until every Seat is taken, to the sender only", async () => {
    const alice = await server.create({ maxPlayers: 3 });
    const bob = await server.join(alice.code);

    bob.send({ type: "Start" });
    expect(await bob.next("rejected")).toEqual({ code: "NOT_OFFERED" });

    // A later broadcast reaches Alice after anything sent to her before it.
    await server.join(alice.code);
    await alice.until("lobby", (lobby) => lobby.seats.length === 3);
    expect(alice.pending("rejected")).toEqual([]);
  });

  it("R5: any Player may start a full Lobby; everyone gets the first game view", async () => {
    const [alice, bob] = await fullLobby(2);
    const aliceId = (await alice!.next("welcome")).playerId;

    bob!.send({ type: "Start" });
    const [forAlice, forBob] = await Promise.all([alice!.next("game"), bob!.next("game")]);

    expect(forAlice).toEqual(forBob);
    expect(forAlice.events).toEqual([]);
    expect(forAlice.view).toMatchObject({
      turn: 1,
      version: 0,
      currentPlayer: aliceId,
      phase: { kind: "awaitingRoll" },
      settings: { maxPlayers: 2, minuteLimit: 50 },
    });
  });

  it("R6: the game seats the Players in join order with the Lobby's names", async () => {
    const clients = await fullLobby(3);
    const lobby = await clients[2]!.until("lobby", (l) => l.seats.length === 3);

    clients[1]!.send({ type: "Start" });
    const { view } = await clients[0]!.next("game");

    expect(view.players.map((p) => ({ playerId: p.id, name: p.name }))).toEqual(lobby.seats);
  });

  it("refuses a second Start once the game runs", async () => {
    const { clients } = await startedGame(2);

    clients[1]!.send({ type: "Start" });

    expect(await clients[1]!.next("rejected")).toEqual({ code: "NOT_OFFERED" });
  });
});

describe("playing", () => {
  it("rolls: every Player gets the full view plus the roll's events, in order", async () => {
    const { clients } = await startedGame(2);

    clients[0]!.send({ type: "Roll", turn: 1 });
    const [forAlice, forBob] = await Promise.all(clients.map((c) => c.next("game")));

    expect(forBob).toEqual(forAlice);
    // The seed is random: the roll ends the Turn, or stops at a University offer.
    expect(forAlice!.events.slice(0, 2).map((e) => e.type)).toEqual(["DiceRolled", "Moved"]);
    expect(forAlice!.view.version).toBe(1);
    const [d1, d2] = forAlice!.events[0]!.type === "DiceRolled" ? forAlice!.events[0]!.dice : [];
    expect(forAlice!.view.players[0]!.position).toBe(d1! + d2!);
  });

  it("buys a University: the offer lists Levels and prices, and everyone sees the new owner", async () => {
    const { clients, view: first } = await startedGame(2);
    // The seed is random: play Turns until someone lands on a Level offer
    // (declining Museum and Buyout offers on the way).
    let { view } = await play(clients, first, { type: "Roll" });
    for (let tries = 0; !levelOffer(view) && tries < 60; tries++) {
      const intent = view.phase.kind === "offer" ? { type: "DeclineOffer" } : rollFor(view);
      // oxlint-disable-next-line no-await-in-loop -- Turns are played one after another
      ({ view } = await play(clients, view, intent));
    }
    if (view.phase.kind !== "offer" || !levelOffer(view)) throw new Error("no offer in 30 Turns");
    const { field, levels } = view.phase;
    const price = levels[0]!.price;
    expect(levels[0]!.level).toBe(1);
    expect(view.fields[field]).toMatchObject({ owner: null, level: 0 });

    const bought = await play(clients, view, { type: "BuyLevel", level: 1 });

    expect(bought.events[0]).toEqual({
      type: "LevelBought",
      player: view.currentPlayer,
      field,
      level: 1,
      price,
    });
    expect(bought.view.fields[field]).toMatchObject({
      owner: view.currentPlayer,
      level: 1,
      value: price,
    });
    expect(bought.view.turn).toBe(view.turn + 1);
  });

  it("never sends the PRNG state", async () => {
    const { clients } = await startedGame(2);

    clients[0]!.send({ type: "Roll", turn: 1 });
    const message = await clients[0]!.next("game");

    expect(message.view).not.toHaveProperty("rng");
  });

  it("rejects a stale intent with STALE_TURN, to the sender only, and changes nothing", async () => {
    const { clients, view: first } = await startedGame(2);
    const [alice, bob] = [clients[0]!, clients[1]!];
    const { view } = await playTurn(clients, first);

    bob.send({ type: "Roll", turn: 1 }); // Turn 2 is Bob's: his intent is for an old Turn
    expect(await bob.next("rejected")).toEqual({ code: "STALE_TURN" });

    bob.send({ type: "Roll", turn: 2 });
    const next = await alice.next("game");
    expect(next.view.version).toBe(view.version + 1);
    expect(alice.pending("rejected")).toEqual([]);
  });

  it("rejects an intent from a Player whose Turn it is not", async () => {
    const { clients } = await startedGame(2);

    clients[1]!.send({ type: "Roll", turn: 1 });

    expect(await clients[1]!.next("rejected")).toEqual({ code: "NOT_YOUR_TURN" });
  });

  it("rejects a game intent while the Room is still a Lobby", async () => {
    const alice = await server.create({ maxPlayers: 2 });

    alice.send({ type: "Roll", turn: 1 });

    expect(await alice.next("rejected")).toEqual({ code: "NOT_OFFERED" });
  });

  it.each([
    ["an unknown intent", { type: "Teleport" }],
    ["a Roll without a turn", { type: "Roll" }],
    ["not an object", "roll please"],
  ])("answers %s with MALFORMED and keeps the connection", async (_, message) => {
    const { clients } = await startedGame(2);

    clients[0]!.send(message);
    expect(await clients[0]!.next("rejected")).toEqual({ code: "MALFORMED" });

    clients[0]!.send({ type: "Roll", turn: 1 });
    expect((await clients[0]!.next("game")).view.version).toBe(1);
  });

  it("answers a message of an unknown type with MALFORMED and keeps the connection", async () => {
    const { clients } = await startedGame(2);

    clients[0]!.room.send("cheat", { dice: [6, 6] });
    expect(await clients[0]!.next("rejected")).toEqual({ code: "MALFORMED" });

    clients[0]!.send({ type: "Roll", turn: 1 });
    expect((await clients[0]!.next("game")).view.version).toBe(1);
  });
});
