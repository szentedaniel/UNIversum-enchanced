import { MatchMakeError } from "@colyseus/sdk";
import { matchmakeRejection, type RejectionCode } from "@universum/protocol";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startTestServer, type TestClient, type TestServer } from "./helpers.ts";

let server: TestServer;

beforeAll(async () => {
  server = await startTestServer();
});

afterAll(async () => {
  await server.stop();
});

/** The Rejection code a failed create or join shows, as the web app maps it. */
async function refusal(attempt: Promise<unknown>): Promise<RejectionCode> {
  const error: unknown = await attempt.then(
    () => null,
    (e: unknown) => e,
  );
  if (!(error instanceof MatchMakeError))
    throw new Error(`expected a MatchMakeError, got ${String(error)}`);
  return matchmakeRejection(error);
}

async function fill(creator: TestClient, players: number): Promise<void> {
  for (let i = 1; i < players; i++) {
    // oxlint-disable-next-line no-await-in-loop -- one after another, like Guests do
    await server.join(creator.code);
  }
}

describe("the Lobby list", () => {
  it("lists a new Lobby with its Room name, Room code, Players/max, Minute limit and no lock", async () => {
    const list = await server.watchLobbyList();
    const alice = await server.create({ roomName: "Friday game", maxPlayers: 3, minuteLimit: 30 });

    await list.until((l) => l.get(alice.code)?.players === 1);

    expect(list.get(alice.code)).toEqual({
      code: alice.code,
      roomName: "Friday game",
      players: 1,
      maxPlayers: 3,
      minuteLimit: 30,
      hasPassword: false,
    });
  });

  it("shows Lobbies that were open before the Guest opened the list", async () => {
    const alice = await server.create({ maxPlayers: 2 });
    await alice.next("lobby");

    const list = await server.watchLobbyList();
    await list.until((l) => l.get(alice.code) !== undefined);

    expect(list.get(alice.code)).toMatchObject({ players: 1, maxPlayers: 2, roomName: null });
  });

  it("updates the Players as Guests join, and a Lobby with no empty Seat leaves the list", async () => {
    const list = await server.watchLobbyList();
    const alice = await server.create({ maxPlayers: 2 });
    await list.until((l) => l.get(alice.code)?.players === 1);

    const bob = await server.join(alice.code);
    // Ticket #196: no empty Seat means nobody can join, so it is not listed.
    await list.until((l) => l.get(alice.code) === undefined);
    expect(list.get(alice.code)).toBeUndefined();

    // A Seat opens again: the Lobby is back on the list.
    await bob.leave();
    await list.until((l) => l.get(alice.code)?.players === 1);
    expect(list.get(alice.code)).toMatchObject({ players: 1, maxPlayers: 2 });
  });

  it("names the creator's Seat by Player id, and keeps the crown there when Seats shift", async () => {
    const alice = await server.create({ maxPlayers: 3 });
    const aliceId = (await alice.next("welcome")).playerId;
    expect((await alice.next("lobby")).creatorId).toBe(aliceId);
    const bob = await server.join(alice.code);
    const bobId = (await bob.next("welcome")).playerId;
    const carol = await server.join(alice.code);
    const carolId = (await carol.next("welcome")).playerId;
    expect((await bob.until("lobby", (l) => l.seats.length === 3)).creatorId).toBe(aliceId);

    await alice.leave();
    const shifted = await bob.until("lobby", (l) => l.seats.length === 2);

    // Seat 0 is now Bob's, but the crown stays with the creator (who is gone).
    expect(shifted.seats.map((seat) => seat.playerId)).toEqual([bobId, carolId]);
    expect(shifted.creatorId).toBe(aliceId);
    expect(shifted.seats.some((seat) => seat.playerId === shifted.creatorId)).toBe(false);
  });

  it("drops a Lobby when its last Player leaves", async () => {
    const list = await server.watchLobbyList();
    const alice = await server.create();
    await list.until((l) => l.get(alice.code) !== undefined);

    await alice.leave();

    await list.until((l) => l.get(alice.code) === undefined);
    expect(list.get(alice.code)).toBeUndefined();
  });

  it("leaves the list when its last Seat is taken, and stays off it when started, also for Guests who open the list later", async () => {
    const list = await server.watchLobbyList();
    const alice = await server.create({ maxPlayers: 2 });
    await fill(alice, 2);
    await list.until((l) => l.get(alice.code) === undefined);

    alice.send({ type: "Start" });
    await alice.next("game");
    expect(list.get(alice.code)).toBeUndefined();

    const later = await server.watchLobbyList();
    // A Lobby created after the start reaches the late list, so it has caught up.
    const carol = await server.create();
    await later.until((l) => l.get(carol.code) !== undefined);
    expect(later.get(alice.code)).toBeUndefined();
  });

  it("lists a password Lobby with a lock, and never sends the password or a hash", async () => {
    const list = await server.watchLobbyList();
    const alice = await server.create({ password: "hunter2-secret" });
    await list.until((l) => l.get(alice.code) !== undefined);
    const later = await server.watchLobbyList();
    await later.until((l) => l.get(alice.code) !== undefined);

    expect(list.get(alice.code)?.hasPassword).toBe(true);
    const raw = JSON.stringify([list.received, later.received]);
    expect(raw).not.toContain("hunter2-secret");
    const secretKeys = (raw.match(/"\w+":/g) ?? []).filter(
      (key) => /password|hash|salt|secret/i.test(key) && key !== '"hasPassword":',
    );
    expect(secretKeys).toEqual([]);
  });

  it("does not use Colyseus's private flag for password Lobbies", async () => {
    const list = await server.watchLobbyList();
    const alice = await server.create({ password: "pw" });
    await list.until((l) => l.get(alice.code) !== undefined);

    const raw = list.received
      .flat(2)
      .find(
        (item): item is { roomId: string; private: boolean } =>
          typeof item === "object" &&
          item !== null &&
          "roomId" in item &&
          item.roomId === alice.code,
      );
    expect(raw?.private).toBe(false);
  });
});

describe("the Room name", () => {
  it("is normalised before it is shown", async () => {
    const alice = await server.create({ roomName: "  Friday \t game " });

    expect(await alice.next("lobby")).toMatchObject({ roomName: "Friday game" });
  });

  it("falls back to a generated one (null: the client names it) when empty", async () => {
    const alice = await server.create({ roomName: "   " });

    expect(await alice.next("lobby")).toMatchObject({ roomName: null });
  });

  it.each([["ab"], ["Fri\u200bday"], ["<script>"], ["x".repeat(25)]])(
    "refuses %j with ROOM_NAME_INVALID",
    async (roomName) => {
      expect(await refusal(server.sdk.create("game", { roomName }))).toBe("ROOM_NAME_INVALID");
    },
  );
});

describe("password Lobbies", () => {
  it("lets a Guest with the right password take a Seat", async () => {
    const alice = await server.create({ maxPlayers: 2, password: "open sesame" });

    const bob = await server.join(alice.code, { password: "open sesame" });

    expect((await bob.until("lobby", (l) => l.seats.length === 2)).hasPassword).toBe(true);
  });

  it.each([
    ["a wrong password", { password: "open sesame?" }],
    ["no password", {}],
    ["an empty password", { password: "" }],
  ])("refuses %s with WRONG_PASSWORD", async (_, options) => {
    const alice = await server.create({ password: "open sesame" });

    expect(await refusal(server.join(alice.code, options))).toBe("WRONG_PASSWORD");
  });

  it("reserves no Seat for a wrong guess", async () => {
    const alice = await server.create({ maxPlayers: 2, password: "pw" });
    for (let i = 0; i < 3; i++) {
      // oxlint-disable-next-line no-await-in-loop -- guesses one after another
      expect(await refusal(server.join(alice.code, { password: `guess ${i}` }))).toBe(
        "WRONG_PASSWORD",
      );
    }

    // A wrong guess holding a Seat (15 s) would make the 2-Seat Lobby full here.
    await expect(server.join(alice.code, { password: "pw" })).resolves.toBeDefined();
  });

  it("refuses a join that skips the password check by sending create options", async () => {
    const alice = await server.create({ password: "pw" });

    // A joinById must carry join options: create options are refused before any Seat (MALFORMED).
    expect(await refusal(server.sdk.joinById(alice.code, { maxPlayers: 4 }))).toBe("MALFORMED");
    // A join naming another Room code is checked against that Room, not this one.
    expect(await refusal(server.sdk.joinById(alice.code, { code: "100000" }))).toBe(
      "ROOM_NOT_FOUND",
    );
  });

  it("lets a Room without a password be joined with any password", async () => {
    const alice = await server.create();

    await expect(server.join(alice.code, { password: "whatever" })).resolves.toBeDefined();
  });
});

describe("join refusals", () => {
  it("refuses a full Lobby with ROOM_FULL", async () => {
    const alice = await server.create({ maxPlayers: 2 });
    await fill(alice, 2);

    expect(await refusal(server.join(alice.code))).toBe("ROOM_FULL");
  });

  it("checks for a full Lobby before the password", async () => {
    const alice = await server.create({ maxPlayers: 2, password: "pw" });
    await server.join(alice.code, { password: "pw" });

    expect(await refusal(server.join(alice.code, { password: "wrong" }))).toBe("ROOM_FULL");
  });

  it("refuses an unknown Room code with ROOM_NOT_FOUND", async () => {
    expect(await refusal(server.join("100000"))).toBe("ROOM_NOT_FOUND");
  });

  it("refuses a Room whose game has started with ROOM_NOT_FOUND", async () => {
    const alice = await server.create({ maxPlayers: 2 });
    await fill(alice, 2);
    alice.send({ type: "Start" });
    await alice.next("game");

    expect(await refusal(server.join(alice.code))).toBe("ROOM_NOT_FOUND");
  });
});
