import { MatchMakeError } from "@colyseus/sdk";
import { CLOSE_CODE, matchmakeRejection, type RejectionCode } from "@universum/protocol";
import { afterEach, describe, expect, it } from "vitest";
import { BOT_DELAY_MS } from "#room/game-driver.ts";
import {
  eventually,
  ManualScheduler,
  newGuestToken,
  startTestServer,
  withDeadline,
  T0,
  type TestServer,
} from "./helpers.ts";

/** A Lobby Seat is held this long for a Player who dropped (spec: Seat hold). */
const LOBBY_HOLD = 60_000;
/** One Minute of game time in ms; the default Room's games last at most 50 of them (spec: settings). */
const MINUTE = 60_000;
/** What Colyseus answers a reconnection token it no longer holds a Seat for. */
const EXPIRED = "reconnection token invalid or expired";

// One server at a time per file (the matchmaker is a singleton); each test
// stops whatever it started.
const running: TestServer[] = [];

async function start(options?: Parameters<typeof startTestServer>[0]): Promise<TestServer> {
  const server = await startTestServer(options);
  running.push(server);
  return server;
}

async function restart(server: TestServer, now: number): Promise<TestServer> {
  running.splice(running.indexOf(server), 1);
  await server.stop();
  return start({ databasePath: server.databasePath, scheduler: new ManualScheduler(now) });
}

afterEach(async () => {
  // oxlint-disable-next-line no-await-in-loop -- one server at a time (the matchmaker is a singleton)
  for (const server of running.splice(0)) await server.stop();
});

/** The Rejection code a failed join shows, as the web app maps it. */
async function refusal(attempt: Promise<unknown>): Promise<RejectionCode> {
  const error: unknown = await attempt.then(
    () => null,
    (e: unknown) => e,
  );
  if (!(error instanceof MatchMakeError))
    throw new Error(`expected a MatchMakeError, got ${String(error)}`);
  return matchmakeRejection(error);
}

describe("a Lobby Seat while its Player is away", () => {
  it("is held, shown with the time it is freed at, and taken back by the reconnection token", async () => {
    const server = await start();
    const alice = await server.create({ maxPlayers: 3 });
    const bob = await server.join(alice.code);
    const { playerId: bobId } = await bob.next("welcome");
    await alice.until("lobby", (l) => l.seats.length === 2);

    await bob.drop();
    const held = await alice.next("lobby");
    expect(held.seats).toHaveLength(2);
    expect(held.seats[1]).toMatchObject({ playerId: bobId, heldUntil: T0 + LOBBY_HOLD });
    expect(held.now).toBe(T0);

    const back = await server.reconnect(bob);
    const lobby = await alice.next("lobby");
    expect(lobby.seats[1]?.playerId).toBe(bobId);
    expect(lobby.seats[1]?.heldUntil).toBeUndefined();
    expect((await back.next("lobby")).seats).toEqual(lobby.seats);
  });

  it("is freed after 60 s, and nobody else can take it before", async () => {
    const server = await start();
    const alice = await server.create({ maxPlayers: 2 });
    const bob = await server.join(alice.code, { guestToken: newGuestToken() });
    await alice.until("lobby", (l) => l.seats.length === 2);
    await bob.drop();
    await alice.until("lobby", (l) => l.seats[1]?.heldUntil !== undefined);

    expect(await refusal(server.join(alice.code, { guestToken: newGuestToken() }))).toBe(
      "ROOM_FULL",
    );
    server.scheduler.advanceTo(T0 + LOBBY_HOLD - 1);
    expect(alice.pending("lobby")).toEqual([]);
    server.scheduler.advanceTo(T0 + LOBBY_HOLD);
    const freed = await alice.next("lobby");

    expect(freed.seats).toHaveLength(1);
    await expect(server.reconnect(bob)).rejects.toThrow(EXPIRED);
    const carol = await server.join(alice.code);
    expect((await carol.next("lobby")).seats).toHaveLength(2);
  });

  it("frees the last Seat of an emptied Lobby after 60 s, and the Lobby is then deleted", async () => {
    const server = await start();
    const alice = await server.create();
    await alice.next("lobby");
    await alice.drop();

    // Held: the Lobby stays, also a moment before the 60 s run out.
    await eventually(() => expect(server.room(alice.code)?.clients.length).toBe(0));
    server.scheduler.advanceTo(T0 + LOBBY_HOLD - 1);
    expect(server.store.isCodeInUse(alice.code)).toBe(true);
    expect(server.room(alice.code)).toBeDefined();

    server.scheduler.advanceTo(T0 + LOBBY_HOLD);
    await eventually(() => expect(server.store.isCodeInUse(alice.code)).toBe(false));
    await eventually(() => expect(server.room(alice.code)).toBeUndefined());
  });

  it("is taken back by Guest token from a new connection, with no password asked", async () => {
    const server = await start();
    const token = newGuestToken();
    const alice = await server.create({ maxPlayers: 2, password: "pw", guestToken: token });
    const { playerId } = await alice.next("welcome");
    await alice.drop();

    const again = await server.join(alice.code, { guestToken: token });

    expect(await again.next("welcome")).toEqual({ playerId });
    const lobby = await again.until("lobby", (l) => l.seats[0]?.heldUntil === undefined);
    expect(lobby.seats.map((s) => s.playerId)).toEqual([playerId]);
    // The old connection's hold was given up with it.
    await expect(server.reconnect(alice)).rejects.toThrow(EXPIRED);
  });
});

/** A started 2-Player game with Guest tokens; both clients have their first view taken. */
async function startedGame(server: TestServer) {
  const tokens = [newGuestToken(), newGuestToken()];
  const alice = await server.create({ maxPlayers: 2, guestToken: tokens[0] });
  const bob = await server.join(alice.code, { guestToken: tokens[1] });
  const ids = [(await alice.next("welcome")).playerId, (await bob.next("welcome")).playerId];
  alice.send({ type: "Start" });
  const [first] = await Promise.all([alice.next("game"), bob.next("game")]);
  return { alice, bob, tokens, ids, code: alice.code, view: withDeadline(first) };
}

/** The Seat reservation a matchmake answered with, for opening its WebSocket by hand. */
type SeatReservation = { sessionId: string; roomId: string; processId: string };

function reservationOf(answer: unknown): SeatReservation {
  if (
    typeof answer === "object" &&
    answer !== null &&
    "sessionId" in answer &&
    typeof answer.sessionId === "string" &&
    "roomId" in answer &&
    typeof answer.roomId === "string" &&
    "processId" in answer &&
    typeof answer.processId === "string"
  ) {
    return { sessionId: answer.sessionId, roomId: answer.roomId, processId: answer.processId };
  }
  throw new Error("the matchmake answered no Seat reservation");
}

/**
 * A reserved Seat whose WebSocket never answers the JOINED handshake: Colyseus
 * has the client in the Room, but it never counts as joined. A tab closed or a
 * reload interrupted a moment after connecting leaves exactly this behind.
 */
async function halfJoined(
  server: TestServer,
  code: string,
  guestToken: string,
): Promise<WebSocket> {
  const response = await fetch(`http://127.0.0.1:${server.port}/matchmake/joinById/${code}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ code, guestToken }),
  });
  if (!response.ok) throw new Error(`the matchmake was refused: ${String(response.status)}`);
  const seat = reservationOf(await response.json());
  const socket = new WebSocket(
    `ws://127.0.0.1:${server.port}/${seat.processId}/${seat.roomId}?sessionId=${seat.sessionId}`,
  );
  const { promise, resolve, reject } = Promise.withResolvers<void>();
  socket.addEventListener("open", () => resolve(), { once: true });
  socket.addEventListener("error", () => reject(new Error("the socket did not open")), {
    once: true,
  });
  await promise;
  return socket;
}

/** A started 2-Player game whose second Seat dropped before its JOINED handshake. */
async function halfJoinedDrop(server: TestServer) {
  const bobToken = newGuestToken();
  const alice = await server.create({ maxPlayers: 2 });
  const socket = await halfJoined(server, alice.code, bobToken);
  const lobby = await alice.until("lobby", (l) => l.seats.length === 2);
  const bobId = lobby.seats[1]?.playerId;
  if (bobId === undefined) throw new Error("the half-joined Seat has no Player id");
  alice.send({ type: "Start" });
  await alice.next("game");
  socket.close();
  // The drop is a race: wait until the Room holds the Seat before releasing it.
  await eventually(() => expect(server.room(alice.code)?.gauges().held).toBe(1));
  return { bobToken, bobId, code: alice.code };
}

describe("a Seat in a running game while its Player is away", () => {
  it("is held while its Player is away, its Decisions are played by the Bot, and the reconnection token brings them back to the current state", async () => {
    const server = await start();
    const { alice, bob, code, view } = await startedGame(server);
    await alice.drop();
    await eventually(() => expect(server.room(code)?.gauges().held).toBe(1));

    // Her open Decision is answered by the Bot policy, a second and a half
    // after the gate: the Turn timer never runs out, so there is no penalty.
    server.scheduler.advanceTo(view.actsAfter + BOT_DELAY_MS);
    const played = await bob.next("game");
    expect(played.events[0]).toMatchObject({ type: "DiceRolled", player: view.players[0]?.id });
    expect(played.events.some((event) => event.type === "TimedOut")).toBe(false);

    // The Seat is still hers (a running game holds it), and the reconnection
    // token brings her back to the state the Bot's action left.
    const back = await server.reconnect(alice);
    const current = await back.next("game");
    expect(current.events).toEqual([]);
    expect(current.view.version).toBe(played.view.version);
    expect(current.view.version).toBe(server.room(code)?.game?.version);
  });

  it("is taken back by Guest token from a new connection (reload, new tab), as the same Player", async () => {
    const server = await start();
    const { alice, tokens, ids, code } = await startedGame(server);
    await alice.drop();

    const again = await server.join(code, { guestToken: tokens[0] });

    expect(await again.next("welcome")).toEqual({ playerId: ids[0] });
    const { view } = await again.next("game");
    expect(view.version).toBe(0);
    again.send({ type: "Roll", turn: 1 });
    expect((await again.next("game")).view.version).toBe(1);
    await expect(server.reconnect(alice)).rejects.toThrow(EXPIRED);
  });

  it("moves to the new connection when the Guest opens a second tab, closing the first one", async () => {
    const server = await start();
    const { alice, tokens, ids, code } = await startedGame(server);

    const tab = await server.join(code, { guestToken: tokens[0] });

    expect(await tab.next("welcome")).toEqual({ playerId: ids[0] });
    expect(await alice.closed).toBe(CLOSE_CODE.seatTaken);
    expect((await tab.next("game")).view.version).toBe(0);
    tab.send({ type: "Roll", turn: 1 });
    expect((await tab.next("game")).view.version).toBe(1);
  });

  it("can't be taken with another Guest token, or with none", async () => {
    const server = await start();
    const { alice, code } = await startedGame(server);
    await alice.drop();

    expect(await refusal(server.join(code, { guestToken: newGuestToken() }))).toBe(
      "ROOM_NOT_FOUND",
    );
    expect(await refusal(server.join(code))).toBe("ROOM_NOT_FOUND");
  });

  it("is no longer held once the game ends", async () => {
    const server = await start();
    const { alice, code } = await startedGame(server);
    await alice.drop();

    server.room(code)?.endGame();

    await expect(server.reconnect(alice)).rejects.toThrow(EXPIRED);
  });

  it("sees the same final Summary as the Guests who were there when the game ended", async () => {
    const server = await start();
    const { alice, bob, tokens, ids, code } = await startedGame(server);
    await bob.drop();
    // The end, played out from Alice's open Decision; Bob missed every push.
    server.scheduler.advanceTo(T0 + 50 * MINUTE);
    const ended = await alice.next("game");

    const again = await server.join(code, { guestToken: tokens[1] });

    expect(await again.next("welcome")).toEqual({ playerId: ids[1] });
    const { view } = await again.next("game");
    expect(view.version).toBe(ended.view.version);
    expect(view.summary).not.toBeNull();
    expect(view.summary).toEqual(ended.view.summary);
    const final = view.summary?.series.at(-1);
    for (const standing of view.standings ?? []) {
      expect(final?.wealth[standing.player]).toBe(standing.wealth);
    }
  });

  it("is held when its client drops before its JOINED handshake, and the Guest token takes it back", async () => {
    const server = await start();
    const { bobToken, bobId, code } = await halfJoinedDrop(server);

    const again = await server.join(code, { guestToken: bobToken });

    expect(await again.next("welcome")).toEqual({ playerId: bobId });
    expect((await again.next("game")).view.version).toBe(0);
  });

  it("doesn't break the game's end when its client dropped before its JOINED handshake", async () => {
    const server = await start();
    const { bobToken, bobId, code } = await halfJoinedDrop(server);

    server.room(code)?.endGame();

    expect(server.room(code)?.endedAt).toBeTypeOf("number");
    const again = await server.join(code, { guestToken: bobToken });
    expect(await again.next("welcome")).toEqual({ playerId: bobId });
  });

  it("is taken back by Guest token after a server restart", async () => {
    const before = await start();
    const { tokens, ids, code } = await startedGame(before);

    const after = await restart(before, T0 + 5_000);
    const [alice, bob] = await Promise.all(
      tokens.map((guestToken) => after.join(code, { guestToken })),
    );

    expect(await alice!.next("welcome")).toEqual({ playerId: ids[0] });
    expect(await bob!.next("welcome")).toEqual({ playerId: ids[1] });
    expect((await alice!.next("game")).view.version).toBe(0);
    alice!.send({ type: "Roll", turn: 1 });
    expect((await bob!.until("game", (g) => g.view.version === 1)).view.version).toBe(1);
  });
});

describe("a restored Lobby", () => {
  it("holds its Seats for 60 s: the Guests take theirs back by token, the rest are freed and an emptied Lobby is deleted", async () => {
    const before = await start();
    const token = newGuestToken();
    const alice = await before.create({ maxPlayers: 3, guestToken: token });
    const bob = await before.join(alice.code, { guestToken: newGuestToken() });
    const { playerId: bobId } = await bob.next("welcome");
    await alice.until("lobby", (l) => l.seats.length === 2);

    const after = await restart(before, T0);
    const again = await after.join(alice.code, { guestToken: token });
    const lobby = await again.next("lobby");
    expect(lobby.seats).toHaveLength(2);
    expect(lobby.seats[1]).toMatchObject({ playerId: bobId, heldUntil: T0 + LOBBY_HOLD });

    after.scheduler.advanceTo(T0 + LOBBY_HOLD);
    expect((await again.until("lobby", (l) => l.seats.length === 1)).seats[0]).not.toHaveProperty(
      "heldUntil",
    );

    await again.leave();
    await eventually(() => expect(after.store.isCodeInUse(alice.code)).toBe(false));
  });

  it("nobody comes back to is deleted after 60 s", async () => {
    const before = await start();
    const alice = await before.create({ guestToken: newGuestToken() });
    await alice.next("lobby");

    const after = await restart(before, T0);
    expect(after.room(alice.code)).toBeDefined();
    after.scheduler.advanceTo(T0 + LOBBY_HOLD);

    await eventually(() => expect(after.store.isCodeInUse(alice.code)).toBe(false));
  });
});

describe("observability", () => {
  it("counts drops and reconnects, and gauges the held Seats", async () => {
    const server = await start();
    const { alice, tokens, code } = await startedGame(server);
    const sample = async (series: string) => {
      const line = (await server.metrics.scrape())
        .split("\n")
        .find((l) => l.startsWith(`${series} `));
      return Number(line?.slice(series.length + 1));
    };

    await alice.drop();
    await expect.poll(() => sample("seat_drops_total")).toBe(1);
    expect(await sample("seats_held_disconnected")).toBe(1);

    const back = await server.reconnect(alice);
    await back.next("game");
    expect(await sample("seat_reconnects_total")).toBe(1);
    expect(await sample("seats_held_disconnected")).toBe(0);

    await back.drop();
    await expect.poll(() => sample("seat_drops_total")).toBe(2);
    const again = await server.join(code, { guestToken: tokens[0] });
    await again.next("game");
    expect(await sample("seat_reconnects_total")).toBe(2);
    expect(await sample("seats_held_disconnected")).toBe(0);
  });
});

describe("Guest tokens", () => {
  it("never reach another client, as the token or as its hash", async () => {
    const server = await start();
    const { alice, bob, tokens, code } = await startedGame(server);
    await bob.drop();
    const again = await server.join(code, { guestToken: tokens[1] });
    await again.next("game");
    alice.send({ type: "Roll", turn: 1 });
    await again.until("game", (g) => g.view.version === 1);

    const hashes = server.room(code)?.seats.map((s) => s.tokenHash) ?? [];
    expect(hashes.every((h) => typeof h === "string")).toBe(true);
    for (const client of [alice, bob, again]) {
      const seen = JSON.stringify(client.received);
      for (const secret of [...tokens, ...hashes]) expect(seen).not.toContain(secret);
    }
  });
});
