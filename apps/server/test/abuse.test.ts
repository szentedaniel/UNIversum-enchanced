/**
 * Abuse protection (spec: Abuse protection), through a real server with
 * lowered per-IP limits. Each test sends from its own IP (`X-Real-IP`, as
 * Caddy sets it), so the tests don't share counters.
 */
import { matchMaker } from "@colyseus/core";
import { MatchMakeError } from "@colyseus/sdk";
import { matchmakeRefusal, type Refusal } from "@universum/protocol";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GameRoom } from "#room/game-room.ts";
import { startTestServer, type TestClient, type TestServer } from "./helpers.ts";

let server: TestServer;

beforeAll(async () => {
  server = await startTestServer({
    limits: {
      roomCreationsPerMinute: 4,
      roomCreationsPerHour: 6,
      joinsPerMinute: 8,
      seatReservationsPerIp: 2,
      openLobbiesPerIp: 2,
      passwordFailuresPerIp: 6,
    },
  });
});

afterAll(async () => {
  await server.stop();
});

/** The Refusal a failed SDK create or join carries, as the web app reads it. */
async function refusalOf(attempt: Promise<unknown>): Promise<Refusal> {
  const error: unknown = await attempt.then(
    () => null,
    (e: unknown) => e,
  );
  if (!(error instanceof MatchMakeError)) {
    throw new Error(`expected a MatchMakeError, got ${String(error)}`);
  }
  return matchmakeRefusal(error);
}

/** A Lobby nobody in the test is limited by: made from an IP of its own. */
let lobbies = 0;
async function someLobby(options: { password?: string } = {}): Promise<TestClient> {
  lobbies += 1;
  return server.from(`198.51.100.${lobbies}`).create(options);
}

function liveRoom(code: string): GameRoom {
  const room = matchMaker.getLocalRoomById(code);
  if (!(room instanceof GameRoom)) throw new Error(`no live Room ${code}`);
  return room;
}

/** A creator leaves its Lobby and the Lobby closes. */
async function close(lobby: TestClient): Promise<void> {
  await lobby.leave();
  await expect.poll(() => matchMaker.getLocalRoomById(lobby.code)).toBeUndefined();
}

describe("Room creations per IP", () => {
  it("allows the per-minute number, then refuses with RATE_LIMITED and the wait", async () => {
    const guest = server.from("203.0.113.1");
    for (let i = 0; i < 4; i++) {
      // oxlint-disable-next-line no-await-in-loop -- one after another
      await close(await guest.create());
    }

    const refusal = await refusalOf(guest.create());

    expect(refusal.code).toBe("RATE_LIMITED");
    expect(refusal.retryAfter).toBeGreaterThan(0);
    expect(refusal.retryAfter).toBeLessThanOrEqual(60);
  });

  it("limits each IP alone, and buckets IPv6 by its /64", async () => {
    const blocked = { roomName: "ab" };
    for (let i = 0; i < 4; i++) {
      // oxlint-disable-next-line no-await-in-loop -- one after another
      await server.matchmake("create/game", blocked, { ip: `2001:db8:5:5::${i + 1}` });
    }

    expect(
      await server.matchmake("create/game", blocked, { ip: "2001:db8:5:5:ffff::1" }),
    ).toMatchObject({ code: "RATE_LIMITED" });
    expect(await server.matchmake("create/game", {}, { ip: "2001:db8:5:6::1" })).toBeNull();
  });

  it("counts a refused Room name too (which holds no Seat)", async () => {
    const ip = "203.0.113.2";
    for (let i = 0; i < 4; i++) {
      // oxlint-disable-next-line no-await-in-loop -- one after another
      expect(await server.matchmake("create/game", { roomName: "ab" }, { ip })).toEqual({
        code: "ROOM_NAME_INVALID",
      });
    }

    expect(await server.matchmake("create/game", {}, { ip })).toMatchObject({
      code: "RATE_LIMITED",
    });
  });

  it("refuses an offensive Room name with ROOM_NAME_BLOCKED", async () => {
    expect(
      await server.matchmake("create/game", { roomName: "Kurva jó" }, { ip: "203.0.113.3" }),
    ).toEqual({ code: "ROOM_NAME_BLOCKED" });
  });
});

describe("join attempts per IP", () => {
  it("counts wrong Room codes, then refuses with RATE_LIMITED", async () => {
    const lobby = await someLobby();
    const guest = server.from("203.0.113.10");
    const wrong = Array.from({ length: 8 }, (_, i) => String(100_000 + i));
    for (const code of wrong) {
      // oxlint-disable-next-line no-await-in-loop -- one after another
      expect(await refusalOf(guest.join(code))).toEqual({ code: "ROOM_NOT_FOUND" });
    }

    const refusal = await refusalOf(guest.join(lobby.code));

    expect(refusal.code).toBe("RATE_LIMITED");
    expect(refusal.retryAfter).toBeLessThanOrEqual(60);
    expect(await server.from("203.0.113.11").join(lobby.code)).toBeDefined();
  });
});

describe("outstanding Seat reservations per IP", () => {
  it("refuses a Seat while the IP holds too many it never used, until one lapses", async () => {
    const [a, b, c] = [await someLobby(), await someLobby(), await someLobby()];
    const ip = "203.0.113.20";
    expect(await server.matchmake(`joinById/${a.code}`, { code: a.code }, { ip })).toBeNull();
    expect(await server.matchmake(`joinById/${b.code}`, { code: b.code }, { ip })).toBeNull();

    const refusal = await server.matchmake(`joinById/${c.code}`, { code: c.code }, { ip });

    expect(refusal).toMatchObject({ code: "RATE_LIMITED" });
    expect(refusal?.retryAfter).toBeLessThanOrEqual(5);
  });

  it("frees a reservation once its WebSocket takes the Seat", async () => {
    const guest = server.from("203.0.113.21");
    for (let i = 0; i < 3; i++) {
      // oxlint-disable-next-line no-await-in-loop -- one after another
      const lobby = await someLobby();
      // oxlint-disable-next-line no-await-in-loop -- one after another
      await expect(guest.join(lobby.code)).resolves.toBeDefined();
    }
  });

  it("waits 5 s for a reserved Seat's WebSocket", async () => {
    const lobby = await someLobby();

    expect(liveRoom(lobby.code).seatReservationTimeout).toBe(5);
  });
});

describe("open Lobbies per IP", () => {
  it("refuses another Room while the IP has its share open, and allows one when a Lobby closes", async () => {
    const guest = server.from("203.0.113.30");
    const first = await guest.create();
    await guest.create();

    expect(await refusalOf(guest.create())).toEqual({ code: "RATE_LIMITED" });

    await first.leave();
    await expect.poll(() => matchMaker.getLocalRoomById(first.code)).toBeUndefined();
    await expect(guest.create()).resolves.toBeDefined();
  });

  it("stops counting a Lobby once its game starts", async () => {
    const guest = server.from("203.0.113.31");
    const first = await guest.create({ maxPlayers: 2 });
    await guest.create();
    await server.from("203.0.113.32").join(first.code);
    first.send({ type: "Start" });
    await first.next("game");

    await expect(guest.create()).resolves.toBeDefined();
  });
});

describe("password guesses", () => {
  it("locks (Room code + IP) after 5 wrong guesses, even for the right password", async () => {
    const lobby = await someLobby({ password: "secret" });
    const guest = server.from("203.0.113.40");
    for (let i = 0; i < 5; i++) {
      // oxlint-disable-next-line no-await-in-loop -- one guess after another
      expect(await refusalOf(guest.join(lobby.code, { password: `guess${i}` }))).toEqual({
        code: "WRONG_PASSWORD",
      });
    }

    expect(await refusalOf(guest.join(lobby.code, { password: "secret" }))).toEqual({
      code: "PASSWORD_LOCKED",
      retryAfter: 60,
    });
  });

  it("locks no one else out of the Lobby", async () => {
    const lobby = await someLobby({ password: "secret" });
    const attacker = server.from("203.0.113.41");
    for (let i = 0; i < 6; i++) {
      // oxlint-disable-next-line no-await-in-loop -- one guess after another
      await refusalOf(attacker.join(lobby.code, { password: `guess${i}` }));
    }

    await expect(
      server.from("203.0.113.42").join(lobby.code, { password: "secret" }),
    ).resolves.toBeDefined();
  });

  it("does not count asking for the password (a join with none)", async () => {
    const lobby = await someLobby({ password: "secret" });
    const guest = server.from("203.0.113.43");
    for (let i = 0; i < 6; i++) {
      // oxlint-disable-next-line no-await-in-loop -- one after another
      expect(await refusalOf(guest.join(lobby.code))).toEqual({ code: "WRONG_PASSWORD" });
    }

    await expect(guest.join(lobby.code, { password: "secret" })).resolves.toBeDefined();
  });

  it("starts (Room code + IP) afresh after the right password", async () => {
    const lobby = await someLobby({ password: "secret" });
    const guest = server.from("203.0.113.44");
    for (let i = 0; i < 3; i++) {
      // oxlint-disable-next-line no-await-in-loop -- one guess after another
      await refusalOf(guest.join(lobby.code, { password: `guess${i}` }));
    }
    const seated = await guest.join(lobby.code, { password: "secret" });
    await seated.leave();
    for (let i = 0; i < 3; i++) {
      // oxlint-disable-next-line no-await-in-loop -- one guess after another
      expect(await refusalOf(guest.join(lobby.code, { password: `again${i}` }))).toEqual({
        code: "WRONG_PASSWORD",
      });
    }
  });

  it("locks an IP spraying guesses across Rooms", async () => {
    const guest = server.from("203.0.113.45");
    const rooms = [await someLobby({ password: "a" }), await someLobby({ password: "b" })];
    for (let i = 0; i < 6; i++) {
      // oxlint-disable-next-line no-await-in-loop -- one guess after another
      const code = rooms[i % 2]!.code;
      // oxlint-disable-next-line no-await-in-loop -- one guess after another
      expect(await refusalOf(guest.join(code, { password: `x${i}` }))).toEqual({
        code: "WRONG_PASSWORD",
      });
    }
    const other = await someLobby({ password: "c" });

    const refusal = await refusalOf(guest.join(other.code, { password: "c" }));

    expect(refusal.code).toBe("PASSWORD_LOCKED");
    expect(refusal.retryAfter).toBeGreaterThan(60);
    expect(refusal.retryAfter).toBeLessThanOrEqual(600);
  });
});

describe("message sizes", () => {
  it("refuses a matchmaking body over 2 KB", async () => {
    const big = JSON.stringify({ roomName: "x".repeat(2100) });

    expect(
      await server.matchmake("create/game", null, { ip: "203.0.113.50", rawBody: big }),
    ).toEqual({ code: "MALFORMED" });
  });

  it("refuses a chunked matchmaking body that grows over 2 KB", async () => {
    const chunk = new TextEncoder().encode(" ".repeat(1024));
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        for (let i = 0; i < 3; i++) controller.enqueue(chunk);
        controller.close();
      },
    });
    const response = await fetch(`http://127.0.0.1:${server.port}/matchmake/create/game`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-real-ip": "203.0.113.51" },
      body,
      duplex: "half",
    });

    expect(response.status).toBe(413);
  });

  it("closes a WebSocket that sends a message over 1 KB", async () => {
    const lobby = await someLobby();
    const closed = new Promise<number>((resolve) => lobby.room.onLeave(resolve));

    lobby.send({ type: "Roll", turn: 1, padding: "x".repeat(1100) });

    expect(await closed).toBe(1009);
  });

  it("keeps a WebSocket whose message is under 1 KB (MALFORMED)", async () => {
    const lobby = await someLobby();

    lobby.send({ type: "Roll", turn: 1, padding: "x".repeat(900) });

    expect(await lobby.next("rejected")).toEqual({ code: "MALFORMED" });
  });
});

/** A 2-Player game Alice has sent nothing in yet. */
async function runningGame(): Promise<[TestClient, TestClient]> {
  const alice = await someLobby();
  const room = liveRoom(alice.code);
  room.settings = { ...room.settings, maxPlayers: 2 };
  const bob = await server.from("198.51.100.200").join(alice.code);
  // Bob starts, so Alice's flood counter starts at zero.
  bob.send({ type: "Start" });
  await alice.next("game");
  await bob.next("game");
  return [alice, bob];
}

describe("intent floods", () => {
  it("drops the extras above 10 per second with a single SLOW_DOWN, and keeps the socket", async () => {
    const [alice] = await runningGame();

    for (let i = 0; i < 30; i++) alice.send({ type: "Nope" });
    await expect.poll(() => alice.pending("rejected").length).toBe(11);

    const codes = alice.pending("rejected").map((r) => r.code);
    expect(codes.filter((c) => c === "SLOW_DOWN")).toHaveLength(1);
    expect(codes.filter((c) => c === "MALFORMED")).toHaveLength(10);
    expect(alice.room.connection.isOpen).toBe(true);
  });

  it("closes a socket sending more than 50 in one second, without a consented leave, and keeps the Seat", async () => {
    const [alice, bob] = await runningGame();
    const closed = new Promise<number>((resolve) => alice.room.onLeave(resolve));
    const room = liveRoom(alice.code);
    const seat = room.seats[0];

    for (let i = 0; i < 60; i++) alice.send({ type: "Nope" });

    expect(await closed).toBe(4002);
    expect(room.seats[0]).toEqual(seat);
    expect(room.game?.players.map((p) => p.id)).toContain(seat?.playerId);
    expect(bob.room.connection.isOpen).toBe(true);
  });
});
