import { MatchMakeError } from "@colyseus/sdk";
import {
  CLOSE_CODE,
  matchmakeRejection,
  type RejectionCode,
  type RoomSettings,
} from "@universum/protocol";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { BOT_ONLY_RETENTION_MS } from "#room/game-driver.ts";
import {
  eventually,
  newGuestToken,
  startTestServer,
  type TestServer,
} from "./helpers.ts";

let server: TestServer;

beforeAll(async () => {
  // A cap of two, so a test fills it without opening a crowd of sockets.
  server = await startTestServer({ limits: { spectatorsPerRoom: 2 } });
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

/** A client asking to enter `code` as a spectator (spec #179). */
const watch = (code: string, options: { password?: string; guestToken?: string } = {}) =>
  server.join(code, { watch: true, ...options });

/** A started 2-Guest game: the first Decision is open and both have its view. */
async function startedGame(settings: Partial<RoomSettings> = {}) {
  const alice = await server.create({ maxPlayers: 2, ...settings });
  const bob = await server.join(alice.code);
  const aliceId = (await alice.next("welcome")).playerId;
  await alice.next("lobby");
  alice.send({ type: "Start" });
  const [first] = await Promise.all([alice.next("game"), bob.next("game")]);
  return { alice, bob, aliceId, code: alice.code, first };
}

describe("a spectator joins by Room code", () => {
  it("watches a Lobby without taking a Seat or getting a Player id", async () => {
    const alice = await server.create({ maxPlayers: 3 });
    await alice.next("welcome");
    const lobby = await alice.next("lobby");

    const spectator = await watch(alice.code);
    const seen = await spectator.next("lobby");

    expect(seen.seats).toEqual(lobby.seats);
    expect(spectator.pending("welcome")).toEqual([]);
    expect(server.room(alice.code)?.seats).toHaveLength(1);
  });

  it("watches a full Lobby", async () => {
    const alice = await server.create({ maxPlayers: 2 });
    await server.join(alice.code);
    await alice.until("lobby", (message) => message.seats.length === 2);

    const spectator = await watch(alice.code);

    expect((await spectator.next("lobby")).seats).toHaveLength(2);
    expect(spectator.pending("welcome")).toEqual([]);
  });

  it("watches a started game and gets every push a Player gets", async () => {
    const { alice, first, code } = await startedGame();

    const spectator = await watch(code);
    expect(await spectator.next("game")).toEqual(first);

    server.scheduler.advanceTo(first.view.actsAfter);
    alice.send({ type: "Roll", turn: first.view.turn });
    const [seenByAlice, seenBySpectator] = await Promise.all([
      alice.next("game"),
      spectator.next("game"),
    ]);

    expect(seenBySpectator).toEqual(seenByAlice);
    expect(seenByAlice.events.length).toBeGreaterThan(0);
  });

  it("asks a spectator for the Room password", async () => {
    const alice = await server.create({ maxPlayers: 3, password: "open sesame" });

    expect(await refusal(watch(alice.code))).toBe("WRONG_PASSWORD");
    expect(await refusal(watch(alice.code, { password: "nope" }))).toBe("WRONG_PASSWORD");
    const spectator = await watch(alice.code, { password: "open sesame" });

    expect((await spectator.next("lobby")).seats).toHaveLength(1);
    expect(spectator.pending("welcome")).toEqual([]);
  });

  it("never takes a Seat back for a watch join that carries a Guest token", async () => {
    const token = newGuestToken();
    const alice = await server.create({ maxPlayers: 2, guestToken: token });
    const aliceId = (await alice.next("welcome")).playerId;

    const spectator = await watch(alice.code, { guestToken: token });

    expect((await spectator.next("lobby")).seats.map((seat) => seat.playerId)).toEqual([aliceId]);
    expect(spectator.pending("welcome")).toEqual([]);
    expect(server.room(alice.code)?.seats[0]?.sessionId).toBe(alice.room.sessionId);
  });

  it("never stores a spectator in the Room snapshot", async () => {
    const { code } = await startedGame();
    const before = server.store.unfinished().find((room) => room.code === code);

    const spectator = await watch(code);
    await spectator.next("game");

    expect(before).toBeDefined();
    expect(server.store.unfinished().find((room) => room.code === code)).toEqual(before);
  });
});

describe("spectators are read-only", () => {
  it("refuses a spectator's intent and changes no game state", async () => {
    const { alice, first, code } = await startedGame();
    const spectator = await watch(code);
    await spectator.next("game");

    spectator.send({ type: "Roll", turn: first.view.turn });

    expect(await spectator.next("rejected")).toEqual({ code: "SPECTATOR_READ_ONLY" });
    expect(server.room(code)?.game?.version).toBe(first.view.version);
    expect(alice.pending("game")).toEqual([]);
  });

  it("refuses a spectator's Room intent in a Lobby", async () => {
    const alice = await server.create({ maxPlayers: 2 });
    const spectator = await watch(alice.code);
    await spectator.next("lobby");

    spectator.send({ type: "Start" });

    expect(await spectator.next("rejected")).toEqual({ code: "SPECTATOR_READ_ONLY" });
    expect(server.room(alice.code)?.game).toBeNull();
  });
});

describe("the spectator cap", () => {
  it("refuses more spectators with SPECTATORS_FULL and leaves the Seats alone", async () => {
    const alice = await server.create({ maxPlayers: 3 });
    const first = await watch(alice.code);
    const second = await watch(alice.code);
    await first.next("lobby");
    await second.next("lobby");

    expect(await refusal(watch(alice.code))).toBe("SPECTATORS_FULL");

    // The Seats are not spectators' to fill: a Guest still takes the next one.
    const bob = await server.join(alice.code);
    expect((await bob.next("welcome")).playerId).toEqual(expect.any(String));
  });

  it("counts spectators inside maxClients, so a Guest can take their Seat back", async () => {
    const token = newGuestToken();
    const alice = await server.create({ maxPlayers: 2, guestToken: token });
    const aliceId = (await alice.next("welcome")).playerId;
    await server.join(alice.code);
    alice.send({ type: "Start" });
    await alice.next("game");
    const first = await watch(alice.code);
    const second = await watch(alice.code);
    await first.next("game");
    await second.next("game");

    // The Room holds 2 Players plus the spectators at its cap; a new tab must
    // still fit in `maxClients` to take the Seat back.
    const reopened = await server.join(alice.code, { guestToken: token });

    expect((await reopened.next("welcome")).playerId).toBe(aliceId);
    expect(await alice.closed).toBe(CLOSE_CODE.seatTaken);
  });

  it("frees a dropped spectator's slot without a Seat hold or a Bot", async () => {
    const { code } = await startedGame();
    const spectator = await watch(code);
    await spectator.next("game");
    const { held } = server.room(code)!.gauges();

    await spectator.drop();

    await eventually(() => expect(server.room(code)?.clients.length).toBe(2));
    expect(server.room(code)?.seats).toHaveLength(2);
    expect(server.room(code)?.gauges().held).toBe(held);
    const again = await watch(code);
    expect(await again.next("game")).toBeDefined();
  });
});

describe("a Room with only spectators left", () => {
  it("is disposed once the Lobby's last Guest leaves", async () => {
    const alice = await server.create({ maxPlayers: 2 });
    await alice.next("welcome");
    const spectator = await watch(alice.code);
    await spectator.next("lobby");

    await alice.leave();

    await eventually(() => expect(server.room(alice.code)).toBeUndefined());
    expect(await spectator.closed).toBeTypeOf("number");
  });

  it("keeps a running game until its usual retention runs out", async () => {
    // Last: it moves the shared test clock a minute.
    const { alice, bob, code } = await startedGame();
    const spectator = await watch(code);
    await spectator.next("game");

    await Promise.all([alice.leave(), bob.leave()]);
    await eventually(() => expect(server.room(code)?.gauges().connected).toBe(0));
    expect(server.room(code)).toBeDefined();

    server.scheduler.advanceTo(server.scheduler.now() + BOT_ONLY_RETENTION_MS);

    await eventually(() => expect(server.room(code)?.endedAt).not.toBeNull());
  });
});
