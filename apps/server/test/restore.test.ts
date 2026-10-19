import { migrate } from "@universum/rules";
import { afterEach, describe, expect, it } from "vitest";
import {
  eventually,
  ManualScheduler,
  startTestServer,
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

/** A started 2-Player game; returns both clients with their first game view taken. */
async function startedGame(server: TestServer) {
  const alice = await server.create({ maxPlayers: 2 });
  const bob = await server.join(alice.code);
  alice.send({ type: "Start" });
  const [first] = await Promise.all([alice.next("game"), bob.next("game")]);
  return { alice, bob, code: alice.code, view: first.view };
}

describe("restore on boot", () => {
  it("a running game continues under its own code, with its Seats, version, PRNG and deadline", async () => {
    const before = await start();
    const { alice, bob, code } = await startedGame(before);
    alice.send({ type: "Roll", turn: 1 });
    const [{ view }] = await Promise.all([alice.next("game"), bob.next("game")]);
    const game = before.room(code)?.game;
    const seats = before.room(code)?.seats.map(({ playerId, name }) => ({ playerId, name }));

    const after = await restart(before, T0 + 5_000);

    expect(after.restored).toBe(1);
    const room = after.room(code);
    expect(room?.roomId).toBe(code);
    // The whole state, PRNG words included: the dice go on exactly as they would have.
    expect(room?.game).toEqual(game);
    expect(room?.game?.version).toBe(1);
    expect(room?.seats.map(({ playerId, name }) => ({ playerId, name }))).toEqual(seats);

    // Bob's deadline still stands: nothing before it, his Turn times out at it.
    after.scheduler.advanceTo(view.turnDeadline - 1);
    expect(room?.game?.version).toBe(1);
    after.scheduler.advanceTo(view.turnDeadline);
    expect(room?.game).toMatchObject({ version: 2, turn: 3, currentPlayer: view.players[0]?.id });
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
    expect(game?.turnDeadline).toBe(restartedAt + DEADLINE_AFTER);
  });

  it("a Lobby comes back with its code, settings and Seats, and a new Guest can join it", async () => {
    const before = await start();
    const alice = await before.create({ maxPlayers: 3, minuteLimit: 15 });
    const bob = await before.join(alice.code);
    const lobby = await bob.until("lobby", (l) => l.seats.length === 2);

    const after = await restart(before, T0);
    const carol = await after.join(alice.code);
    const restored = await carol.next("lobby");

    expect(after.restored).toBe(1);
    expect(restored.code).toBe(alice.code);
    expect(restored.settings).toEqual({ maxPlayers: 3, minuteLimit: 15 });
    expect(restored.seats.slice(0, 2)).toEqual(lobby.seats);
    expect(restored.seats).toHaveLength(3);
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
