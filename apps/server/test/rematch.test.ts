import { afterEach, describe, expect, it } from "vitest";
import {
  eventually,
  ManualScheduler,
  newGuestToken,
  startTestServer,
  T0,
  type TestClient,
  type TestServer,
} from "./helpers.ts";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const RETENTION = 24 * HOUR;

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
    const alice = await server.create({ maxPlayers: 3 });
    const bob = await server.join(alice.code);
    const carol = await server.join(alice.code);
    const [aliceId, bobId] = await Promise.all(
      [alice, bob].map(async (client) => (await client.next("welcome")).playerId),
    );
    if (aliceId === undefined || bobId === undefined) throw new Error("a Seat has no Player id");
    await carol.next("welcome");
    alice.send({ type: "Start" });
    await Promise.all([alice.next("game"), bob.next("game"), carol.next("game")]);
    const ended = await endedGame(server, alice, bob, carol);

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
    // In Seat order, not vote order. Carol has not voted, so the Room stays ended.
    expect((await pushesTo(alice, bob))[0]?.rematch).toEqual([aliceId, bobId]);
    expect(server.room(alice.code)?.endedAt).not.toBeNull();

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

/** The Room's end time, once its game has ended. */
function endedAtOf(server: TestServer, code: string): number {
  const endedAt = server.room(code)?.endedAt;
  if (typeof endedAt !== "number") throw new Error("the game did not end");
  return endedAt;
}

/** The Lobby push a returned Room sends at `now`: earlier Lobby pushes are the pre-start ones. */
const lobbyAt = (client: TestClient, now: number) =>
  client.until("lobby", (message) => message.now === now);

/** Both Guests vote, and the Room returns to Lobby at the game's end. */
async function bothAgree(server: TestServer, alice: TestClient, bob: TestClient) {
  const now = endedAtOf(server, alice.code);
  alice.send({ type: "Rematch" });
  // The vote alone is not the table: its push is taken so the Lobby is next.
  await pushesTo(alice, bob);
  bob.send({ type: "Rematch" });
  const [aliceLobby, bobLobby] = await Promise.all([lobbyAt(alice, now), lobbyAt(bob, now)]);
  return { now, aliceLobby, bobLobby };
}

describe("returning to Lobby", () => {
  it("waits for every connected Guest and returns once the last one agrees", async () => {
    const server = await start();
    const { alice, bob, aliceId, bobId, code } = await startedGame(server);
    const ended = await endedGame(server, alice, bob);
    const endsAt = endedAtOf(server, code);

    alice.send({ type: "Rematch" });
    // One vote of two is not the table: the Room stays on the Podium.
    expect((await pushesTo(alice, bob))[0]?.rematch).toEqual([aliceId]);
    expect(server.room(code)?.game).not.toBeNull();
    expect(server.room(code)?.endedAt).toBe(endsAt);
    expect(alice.pending("lobby").some((lobby) => lobby.now === endsAt)).toBe(false);

    bob.send({ type: "Rematch" });
    const [aliceLobby, bobLobby] = await Promise.all([
      lobbyAt(alice, endsAt),
      lobbyAt(bob, endsAt),
    ]);

    // The agreed Seats, with their Player ids and names, in join order.
    expect(aliceLobby.seats.map(({ playerId, name }) => ({ playerId, name }))).toEqual(
      ended.view.players.map(({ id, name }) => ({ playerId: id, name })),
    );
    expect(aliceLobby.seats.map((seat) => seat.playerId)).toEqual([aliceId, bobId]);
    expect(bobLobby.seats).toEqual(aliceLobby.seats);
    expect(server.room(code)?.game).toBeNull();
    expect(server.room(code)?.endedAt).toBeNull();
    // The gauges report a Lobby again, not a finished game.
    expect(await server.metrics.scrape()).toContain('rooms{state="lobby"} 1');
  });

  it("does not wait for a dropped Guest, and puts their released Seat on the Lobby list", async () => {
    const server = await start();
    const { alice, bob, aliceId, bobId, code } = await startedGame(server);
    await endedGame(server, alice, bob);
    const endsAt = endedAtOf(server, code);
    const list = await server.watchLobbyList();

    // Bob drops on the Podium without voting.
    await bob.drop();
    await eventually(() => expect(server.room(code)?.gauges().connected).toBe(1));
    alice.send({ type: "Rematch" });
    const lobby = await lobbyAt(alice, endsAt);

    expect(lobby.seats.map((seat) => seat.playerId)).toEqual([aliceId]);
    expect(lobby.seats.some((seat) => seat.playerId === bobId)).toBe(false);

    // The released Seat is free: the Room is on the Lobby list again and takes a new Guest.
    await list.until((lobbies) => lobbies.get(code)?.players === 1);
    expect(list.get(code)).toMatchObject({ players: 1, settings: { maxPlayers: 2 } });

    const carol = await server.join(code);
    const carolId = (await carol.next("welcome")).playerId;
    const seated = await carol.until("lobby", (message) => message.seats.length === 2);
    expect(seated.seats.map((seat) => seat.playerId)).toEqual([aliceId, carolId]);
    expect(seated.seats.some((seat) => seat.playerId === bobId)).toBe(false);
  });

  it("keeps the voters and the Bots, and the Room's name, password, code and settings", async () => {
    const server = await start();
    const alice = await server.create({
      maxPlayers: 3,
      roomName: "Friday game",
      password: "secret",
    });
    const aliceId = (await alice.next("welcome")).playerId;
    alice.send({ type: "AddBot" });
    const bob = await server.join(alice.code, { password: "secret" });
    const bobId = (await bob.next("welcome")).playerId;
    const filled = await alice.until("lobby", (message) => message.seats.length === 3);
    const list = await server.watchLobbyList();
    alice.send({ type: "Start" });
    await Promise.all([alice.next("game"), bob.next("game")]);

    await endedGame(server, alice, bob);
    const { aliceLobby } = await bothAgree(server, alice, bob);

    // The Bot's Seat stays, in join order, with every name as it was.
    expect(aliceLobby.seats).toEqual(filled.seats);
    expect(aliceLobby.seats.filter((seat) => seat.bot === true)).toHaveLength(1);
    expect(aliceLobby.seats.map((seat) => seat.playerId)).toContain(bobId);
    // The Room is still the same Room.
    expect(aliceLobby).toMatchObject({
      code: filled.code,
      roomName: "Friday game",
      creatorId: aliceId,
      hasPassword: true,
      settings: filled.settings,
    });
    // Every Seat taken: it stays off the Lobby list.
    expect(list.get(alice.code)).toBeUndefined();
  });

  it("cancels the old game's retention, and stores the Lobby in the same snapshot", async () => {
    const server = await start();
    const { alice, bob, aliceId, bobId, code } = await startedGame(server);
    await endedGame(server, alice, bob);
    const endsAt = endedAtOf(server, code);
    expect(server.store.ended()).toEqual([{ code, endedAt: endsAt }]);

    await bothAgree(server, alice, bob);

    expect(server.store.ended()).toEqual([]);
    const stored = server.store.unfinished().find((room) => room.code === code);
    expect(stored).toMatchObject({ game: null, endedAt: null });
    expect(stored?.seats.map(({ playerId, name }) => ({ playerId, name }))).toEqual([
      { playerId: aliceId, name: server.room(code)?.seats[0]?.name },
      { playerId: bobId, name: server.room(code)?.seats[1]?.name },
    ]);

    // The old game's retention deletion never fires.
    server.scheduler.advanceTo(endsAt + RETENTION);
    expect(server.store.isCodeInUse(code)).toBe(true);
    expect(server.room(code)).toBeDefined();
  });

  it("a restart before the return leaves the ended Room ended, with its retention", async () => {
    const before = await start();
    const { alice, bob, code } = await startedGame(before);
    await endedGame(before, alice, bob);
    const endsAt = endedAtOf(before, code);

    running.splice(running.indexOf(before), 1);
    await before.stop();
    const after = await start({
      databasePath: before.databasePath,
      scheduler: new ManualScheduler(endsAt + 1_000),
    });

    expect(after.restored).toBe(0);
    expect(after.room(code)).toBeUndefined();
    expect(after.store.ended()).toEqual([{ code, endedAt: endsAt }]);
    after.scheduler.advanceTo(endsAt + RETENTION);
    expect(after.store.isCodeInUse(code)).toBe(false);
  });

  it("a restart after the return restores a Lobby, holding the Seats as any Lobby does", async () => {
    const tokens: [string, string] = [newGuestToken(), newGuestToken()];
    const before = await start();
    const { alice, bob, aliceId, bobId, code } = await startedGame(before, tokens);
    await endedGame(before, alice, bob);

    const { now } = await bothAgree(before, alice, bob);

    running.splice(running.indexOf(before), 1);
    await before.stop();
    const restartedAt = now + 5_000;
    const after = await start({
      databasePath: before.databasePath,
      scheduler: new ManualScheduler(restartedAt),
    });

    expect(after.restored).toBe(1);
    expect(after.room(code)?.game).toBeNull();
    expect(after.room(code)?.endedAt).toBeNull();
    expect(after.room(code)?.seats.map((seat) => seat.playerId)).toEqual([aliceId, bobId]);

    // Alice takes her Seat back; Bob's is held for 60 s, as a restored Lobby's.
    const again = await after.join(code, { guestToken: tokens[0] });
    expect(await again.next("welcome")).toEqual({ playerId: aliceId });
    const lobby = await again.next("lobby");
    expect(lobby.seats.map((seat) => seat.playerId)).toEqual([aliceId, bobId]);
    expect(lobby.seats[1]?.heldUntil).toBe(restartedAt + 60_000);
  });

  it("Start builds a fresh game from the kept Seats, and its end arms retention again", async () => {
    const server = await start();
    const { alice, bob, aliceId, bobId, code } = await startedGame(server);
    const ended = await endedGame(server, alice, bob);
    await bothAgree(server, alice, bob);

    alice.send({ type: "Start" });
    const [again] = await Promise.all([alice.next("game"), bob.next("game")]);
    // Nothing from the old game but the Seats and the settings.
    expect(ended.view.phase.kind).toBe("gameOver");
    expect(again.view).toMatchObject({ version: 0, turn: 1, phase: { kind: "awaitingRoll" } });
    expect(
      again.view.players.map(({ id, cash, position }) => ({ playerId: id, cash, position })),
    ).toEqual([
      { playerId: aliceId, cash: 2_500_000, position: 0 },
      { playerId: bobId, cash: 2_500_000, position: 0 },
    ]);

    const secondEnd = again.view.endsAt;
    server.scheduler.advanceTo(secondEnd);
    await Promise.all([alice.next("game"), bob.next("game")]);

    expect(server.store.ended()).toEqual([{ code, endedAt: secondEnd }]);
    server.scheduler.advanceTo(secondEnd + RETENTION);
    expect(server.store.isCodeInUse(code)).toBe(false);
    // The Room disposes as an ended Room does, so its code is free again.
    await eventually(() => expect(server.room(code)).toBeUndefined());
  });

  it("deletes a Room nobody rematches after the retention", async () => {
    const server = await start();
    const { alice, bob, code } = await startedGame(server);
    await endedGame(server, alice, bob);
    const endsAt = endedAtOf(server, code);

    server.scheduler.advanceTo(endsAt + RETENTION - 1);
    expect(server.store.isCodeInUse(code)).toBe(true);
    server.scheduler.advanceTo(endsAt + RETENTION);
    expect(server.store.isCodeInUse(code)).toBe(false);
    await eventually(() => expect(server.room(code)).toBeUndefined());
  });

  it("a failed Lobby write leaves the Room ended, with its retention and its votes", async () => {
    let failing = false;
    const server = await start({
      wrapStore: (store) => ({
        ...store,
        save: (room, events) => {
          if (failing) throw new Error("disk full");
          store.save(room, events);
        },
      }),
    });
    const { alice, bob, aliceId, bobId, code } = await startedGame(server);
    await endedGame(server, alice, bob);
    const endsAt = endedAtOf(server, code);

    alice.send({ type: "Rematch" });
    await pushesTo(alice, bob);
    failing = true;
    bob.send({ type: "Rematch" });

    // The vote stands and everyone hears it; the Room is still the ended one.
    expect((await pushesTo(alice, bob))[0]?.rematch).toEqual([aliceId, bobId]);
    expect(server.room(code)?.game).not.toBeNull();
    expect(server.room(code)?.endedAt).toBe(endsAt);
    expect(server.store.ended()).toEqual([{ code, endedAt: endsAt }]);
    expect(alice.pending("rejected")).toEqual([]);
    expect(bob.pending("rejected")).toEqual([]);
    expect(alice.pending("lobby").some((lobby) => lobby.now === endsAt)).toBe(false);

    // The old game's retention deletion is still armed.
    failing = false;
    server.scheduler.advanceTo(endsAt + RETENTION);
    expect(server.store.isCodeInUse(code)).toBe(false);
  });

  it("holds a kept Guest's Seat when they dropped, and lets their Guest token take it back", async () => {
    const tokens: [string, string] = [newGuestToken(), newGuestToken()];
    const server = await start();
    const { alice, bob, aliceId, bobId, code } = await startedGame(server, tokens);
    await endedGame(server, alice, bob);
    const endsAt = endedAtOf(server, code);

    // Bob's vote survives his drop, and so does his Seat.
    bob.send({ type: "Rematch" });
    await pushesTo(alice, bob);
    await bob.drop();
    await eventually(() => expect(server.room(code)?.gauges().connected).toBe(1));
    alice.send({ type: "Rematch" });
    const lobby = await lobbyAt(alice, endsAt);

    expect(lobby.seats.map((seat) => seat.playerId)).toEqual([aliceId, bobId]);
    expect(lobby.seats[1]?.heldUntil).toBe(endsAt + 60_000);

    const back = await server.join(code, { guestToken: tokens[1] });
    expect(await back.next("welcome")).toEqual({ playerId: bobId });
    const seated = await back.next("lobby");
    expect(seated.seats[1]).toEqual({ playerId: bobId, name: lobby.seats[1]?.name });
  });

  it("waits for a held Seat of a returned Lobby, then the Room disposes and is deleted", async () => {
    const tokens: [string, string] = [newGuestToken(), newGuestToken()];
    const server = await start();
    const { alice, bob, code } = await startedGame(server, tokens);
    await endedGame(server, alice, bob);
    const endsAt = endedAtOf(server, code);

    bob.send({ type: "Rematch" });
    await pushesTo(alice, bob);
    await bob.drop();
    await eventually(() => expect(server.room(code)?.gauges().connected).toBe(1));
    alice.send({ type: "Rematch" });
    await lobbyAt(alice, endsAt);
    await alice.leave();

    // Bob's held Seat keeps the Lobby up although nobody is connected.
    server.scheduler.advanceTo(endsAt + 60_000 - 1);
    expect(server.room(code)).toBeDefined();
    expect(server.store.isCodeInUse(code)).toBe(true);

    server.scheduler.advanceTo(endsAt + 60_000);
    await eventually(() => expect(server.room(code)).toBeUndefined());
    await eventually(() => expect(server.store.isCodeInUse(code)).toBe(false));
  });

  it("counts the returned Lobby against the live-Lobby cap again", async () => {
    const server = await start({ limits: { liveLobbies: 1 } });
    const { alice, bob, code } = await startedGame(server);
    await endedGame(server, alice, bob);
    // A running game is not a Lobby: another Room may be created.
    expect(await server.matchmake("create/game", {}, { ip: "198.51.100.9" })).toBeNull();

    await bothAgree(server, alice, bob);

    expect(await server.matchmake("create/game", {}, { ip: "198.51.100.9" })).toEqual({
      code: "SERVER_BUSY",
    });
    expect(server.room(code)?.game).toBeNull();
  });
});
