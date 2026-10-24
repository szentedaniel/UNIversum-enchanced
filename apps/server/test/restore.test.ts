import { MatchMakeError } from "@colyseus/sdk";
import { matchmakeRejection, type RejectionCode } from "@universum/protocol";
import { migrate, type GameState } from "@universum/rules";
import stateV1 from "../../../packages/rules/test/fixtures/state-v1.json" with { type: "json" };
import { afterEach, describe, expect, it } from "vitest";
import {
  eventually,
  ManualScheduler,
  startTestServer,
  withDeadline,
  T0,
  type TestClient,
  type TestServer,
} from "./helpers.ts";

/** 20 s on the ring plus the 3 s slack (F22). */
const DEADLINE_AFTER = 23_000;
const HOUR = 60 * 60 * 1000;

// One server at a time per file (the matchmaker is a singleton); each test
// stops whatever it started.
const running: TestServer[] = [];

async function start(options?: Parameters<typeof startTestServer>[0]): Promise<TestServer> {
  const server = await startTestServer(options);
  running.push(server);
  return server;
}

async function restart(server: TestServer, now: number): Promise<TestServer> {
  await stop(server);
  return start({ databasePath: server.databasePath, scheduler: new ManualScheduler(now) });
}

async function stop(server: TestServer): Promise<void> {
  running.splice(running.indexOf(server), 1);
  await server.stop();
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

/** A started 2-Player game; returns both clients with their first game view taken. */
async function startedGame(server: TestServer) {
  const alice = await server.create({ maxPlayers: 2 });
  const bob = await server.join(alice.code);
  alice.send({ type: "Start" });
  const [first] = await Promise.all([alice.next("game"), bob.next("game")]);
  return { alice, bob, code: alice.code, view: withDeadline(first) };
}

describe("restore on boot", () => {
  it("a running game continues under its own code, with its Seats, version, PRNG and deadline", async () => {
    const before = await start();
    const { alice, bob, code } = await startedGame(before);
    alice.send({ type: "Roll", turn: 1 });
    let [rolled] = await Promise.all([alice.next("game"), bob.next("game")]);
    let view = withDeadline(rolled);
    if (view.phase.kind === "offer") {
      // The roll stopped at a University offer: decline it (once the roll's
      // Playback has ended), so the Turn passes.
      before.scheduler.advanceTo(view.actsAfter);
      alice.send({ type: "DeclineOffer", turn: 1 });
      [rolled] = await Promise.all([alice.next("game"), bob.next("game")]);
      view = withDeadline(rolled);
    }
    const { version } = view;
    const game = before.room(code)?.game;
    const seats = before.room(code)?.seats.map(({ playerId, name }) => ({ playerId, name }));

    const after = await restart(before, T0 + 5_000);

    expect(after.restored).toBe(1);
    const room = after.room(code);
    expect(room?.roomId).toBe(code);
    // The whole state, PRNG words included: the dice go on exactly as they would have.
    expect(room?.game).toEqual(game);
    expect(room?.game?.version).toBe(version);
    expect(room?.seats.map(({ playerId, name }) => ({ playerId, name }))).toEqual(seats);

    // Bob's deadline still stands: nothing before it, his Turn times out at it.
    after.scheduler.advanceTo(view.turnDeadline - 1);
    expect(room?.game?.version).toBe(version);
    after.scheduler.advanceTo(view.turnDeadline);
    expect(room?.game).toMatchObject({
      version: version + 1,
      turn: 3,
      currentPlayer: view.players[0]?.id,
    });
    expect(after.store.events(code).at(-1)?.events[0]).toEqual({
      type: "TimedOut",
      player: view.players[1]?.id,
    });
  });

  it("a deadline that passed while the server was down fires at once", async () => {
    const before = await start();
    const { code, view } = await startedGame(before);
    const restartedAt = view.turnDeadline + 60_000;

    const after = await restart(before, restartedAt);
    after.scheduler.advanceTo(restartedAt); // run what is due now; the clock does not move

    const game = after.room(code)?.game;
    expect(game).toMatchObject({ version: 1, turn: 2, currentPlayer: view.players[1]?.id });
    // The timeout ran at restartedAt; its Playback then the Turn limit count from there.
    expect(game?.turnDeadline).toBe((game?.actsAfter ?? 0) + DEADLINE_AFTER);
  });

  it("a Lobby comes back with its code, settings and Seats, and a new Guest can join it", async () => {
    const before = await start();
    const alice = await before.create({ maxPlayers: 3, minuteLimit: 15 });
    const aliceId = (await alice.next("welcome")).playerId;
    const bob = await before.join(alice.code);
    const lobby = await bob.until("lobby", (l) => l.seats.length === 2);

    const after = await restart(before, T0);
    const carol = await after.join(alice.code);
    const restored = await carol.next("lobby");

    expect(after.restored).toBe(1);
    expect(restored.code).toBe(alice.code);
    expect(restored.creatorId).toBe(aliceId);
    expect(restored.settings).toEqual({ maxPlayers: 3, minuteLimit: 15 });
    // Held for their Guests, who have not taken them back yet (#35).
    expect(restored.seats.slice(0, 2)).toEqual(
      lobby.seats.map(({ playerId, name }) => ({ playerId, name, heldUntil: T0 + 60_000 })),
    );
    expect(restored.seats).toHaveLength(3);
  });

  it("a password Lobby comes back with its name and still asks for its password", async () => {
    const before = await start();
    const alice = await before.create({ roomName: "Friday game", password: "open sesame" });
    await alice.next("lobby");

    const after = await restart(before, T0);
    const list = await after.watchLobbyList();
    await list.until((l) => l.get(alice.code) !== undefined);

    expect(list.get(alice.code)).toMatchObject({ roomName: "Friday game", hasPassword: true });
    expect(await refusal(after.join(alice.code))).toBe("WRONG_PASSWORD");
    expect(await refusal(after.join(alice.code, { password: "open sesame?" }))).toBe(
      "WRONG_PASSWORD",
    );
    const bob = await after.join(alice.code, { password: "open sesame" });
    const lobby = await bob.next("lobby");
    expect(lobby).toMatchObject({ roomName: "Friday game", hasPassword: true });
    expect(lobby.seats).toHaveLength(2);
    expect(JSON.stringify(list.received)).not.toContain(
      after.store.unfinished()[0]?.password?.hash,
    );
  });

  it("a restored running game is not on the Lobby list", async () => {
    const before = await start();
    const { code } = await startedGame(before);

    const after = await restart(before, T0);
    const list = await after.watchLobbyList();
    const carol = await after.create();
    await list.until((l) => l.get(carol.code) !== undefined);

    expect(after.room(code)).toBeDefined();
    expect(list.get(code)).toBeUndefined();
  });

  it("ADR-0004: a Room stored at version 1 restores and plays on", async () => {
    const before = await start();
    const code = "600150";
    // The rules package's committed v1 snapshot, as an older deploy stored it.
    before.store.save(
      {
        code,
        settings: { maxPlayers: 4, minuteLimit: 50 },
        roomName: null,
        creatorId: null,
        password: null,
        seats: stateV1.players.map(({ id, name }) => ({ playerId: id, name })),
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- a stored state from before the shape change
        game: stateV1 as unknown as GameState,
        endedAt: null,
      },
      [],
    );

    const after = await restart(before, T0);

    expect(after.restored).toBe(1);
    const game = after.room(code)?.game;
    // Migrated on boot: the deadline it had, and no wait before acting.
    expect(game).toMatchObject({
      stateVersion: 2,
      turn: 2,
      actsAfter: stateV1.turnDeadline - DEADLINE_AFTER,
    });
    expect(game?.turnDeadline).toBe(stateV1.turnDeadline);

    // It plays on: the Turn times out at the deadline it kept.
    after.scheduler.advanceTo(stateV1.turnDeadline);
    expect(after.room(code)?.game).toMatchObject({ version: 3, turn: 3 });
  });

  it("a stored game the server can't migrate stays stored and is not restored", async () => {
    const before = await start();
    const { code } = await startedGame(before);
    const [stored] = before.store.unfinished();
    if (!stored?.game) throw new Error("the game was not stored");
    // As if a newer server had written it before a rollback.
    before.store.save({ ...stored, game: { ...migrate(stored.game), stateVersion: 999 } }, []);

    const after = await restart(before, T0);

    expect(after.restored).toBe(0);
    expect(after.room(code)).toBeUndefined();
    expect(after.store.isCodeInUse(code)).toBe(true);
  });
});

describe("writing before broadcasting", () => {
  it("a failed write broadcasts nothing, refuses the intent with INTERNAL and keeps the last state", async () => {
    let failWrites = false;
    const server = await start({
      wrapStore: (store) => ({
        ...store,
        save(room, events) {
          if (failWrites) throw new Error("disk full");
          store.save(room, events);
        },
      }),
    });
    const { alice, bob, code } = await startedGame(server);

    failWrites = true;
    alice.send({ type: "Roll", turn: 1 });
    expect(await alice.next("rejected")).toEqual({ code: "INTERNAL" });

    failWrites = false;
    alice.send({ type: "Roll", turn: 1 });
    const rolled = await bob.next("game");
    expect(rolled.view.version).toBe(1);
    expect(bob.pending("game")).toEqual([]);
    expect(server.store.unfinished().find((r) => r.code === code)?.game).toMatchObject({
      version: 1,
    });
  });
});

describe("retention", () => {
  it("an emptied Lobby is deleted right away", async () => {
    const server = await start();
    const alice: TestClient = await server.create();
    await alice.next("lobby");
    expect(server.store.isCodeInUse(alice.code)).toBe(true);

    await alice.leave();

    await eventually(() => expect(server.store.isCodeInUse(alice.code)).toBe(false));
  });

  it("an ended game is deleted with its events 24 h after it ended, and its Room closes", async () => {
    const server = await start();
    const { alice, code } = await startedGame(server);
    alice.send({ type: "Roll", turn: 1 });
    await alice.next("game");

    server.room(code)?.endGame(); // #32 calls this when the game-over phase arrives
    expect(server.store.ended()).toEqual([{ code, endedAt: T0 }]);

    server.scheduler.advanceTo(T0 + 24 * HOUR - 1);
    expect(server.store.isCodeInUse(code)).toBe(true);
    server.scheduler.advanceTo(T0 + 24 * HOUR);
    expect(server.store.isCodeInUse(code)).toBe(false);
    expect(server.store.events(code)).toEqual([]);
    await eventually(() => expect(server.room(code)).toBeUndefined());
  });

  it("an ended game is not restored, and is still deleted 24 h after it ended", async () => {
    const before = await start();
    const { code } = await startedGame(before);
    before.room(code)?.endGame();

    const after = await restart(before, T0 + 23 * HOUR);
    after.scheduler.advanceTo(T0 + 23 * HOUR);

    expect(after.restored).toBe(0);
    expect(after.room(code)).toBeUndefined();
    expect(after.store.isCodeInUse(code)).toBe(true);
    after.scheduler.advanceTo(T0 + 24 * HOUR);
    expect(after.store.isCodeInUse(code)).toBe(false);
  });

  it("an ended game whose 24 h ran out while the server was down is deleted at boot", async () => {
    const before = await start();
    const { code } = await startedGame(before);
    before.room(code)?.endGame();

    const after = await restart(before, T0 + 25 * HOUR);
    after.scheduler.advanceTo(T0 + 25 * HOUR);

    expect(after.store.isCodeInUse(code)).toBe(false);
  });
});
