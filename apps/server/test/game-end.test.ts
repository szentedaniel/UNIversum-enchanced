import { afterEach, describe, expect, it } from "vitest";
import {
  eventually,
  ManualScheduler,
  startTestServer,
  withDeadline,
  T0,
  type TestServer,
} from "./helpers.ts";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

// One server at a time per file (the matchmaker is a singleton); each test
// stops whatever it started.
const running: TestServer[] = [];

async function start(options?: Parameters<typeof startTestServer>[0]): Promise<TestServer> {
  const server = await startTestServer(options);
  running.push(server);
  return server;
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
  const [aliceId, bobId] = await Promise.all(
    [alice, bob].map(async (client) => (await client.next("welcome")).playerId),
  );
  if (aliceId === undefined || bobId === undefined) throw new Error("a Seat has no Player id");
  if (first.view.turnDeadline === null) throw new Error("a started game has a deadline");
  return { alice, bob, code: alice.code, view: withDeadline(first), aliceId, bobId };
}

/** The value of one sample in a Prometheus text scrape. */
function sample(scrape: string, series: string): number {
  const line = scrape.split("\n").find((l) => l.startsWith(`${series} `));
  if (line === undefined) throw new Error(`no sample ${series} in the scrape`);
  return Number(line.slice(series.length + 1));
}

describe("the game ending", () => {
  it("R75: when the Minute limit runs out, the Turn in progress is played out and the game ends", async () => {
    const server = await start();
    const { alice, bob, code, view, aliceId, bobId } = await startedGame(server);
    const endsAt = T0 + 50 * MINUTE;

    // The first Turn's deadline falls after the Minute limit: it times out at `endsAt`.
    server.scheduler.advanceTo(endsAt);
    const [ended] = await Promise.all([alice.next("game"), bob.next("game")]);

    // The penalty (10% of Alice's cash) applies before the winner is ranked.
    expect(ended.events).toEqual([
      { type: "TimedOut", player: aliceId },
      { type: "TimeoutPenaltyPaid", player: aliceId, amount: 250_000 },
      { type: "GameEnded", winner: bobId, reason: "timeUp" },
    ]);
    expect(ended.view).toMatchObject({
      phase: { kind: "gameOver", winner: bobId, reason: "timeUp" },
      currentPlayer: bobId,
      turnDeadline: null,
      turnTimer: null,
    });
    expect(ended.view.version).toBe(view.version + 1);
    // The Room knows it is over: it will be deleted with its events 24 h later.
    expect(server.room(code)?.endedAt).toBe(endsAt);
    expect(server.store.ended()).toEqual([{ code, endedAt: endsAt }]);
    expect(server.store.unfinished().some((room) => room.code === code)).toBe(false);
    // The ended Room no longer counts as playing.
    expect(sample(await server.metrics.scrape(), 'rooms{state="playing"}')).toBe(0);
    expect(sample(await server.metrics.scrape(), "rooms_restored")).toBe(0);
  });

  it("R80: once the game is over, the Room never wakes up again", async () => {
    const server = await start();
    const { alice, bob, view } = await startedGame(server);
    const lastWakeUp = server.scheduler.lastTaskAt(view.turnDeadline);

    server.scheduler.advanceTo(T0 + 50 * MINUTE);
    await Promise.all([alice.next("game"), bob.next("game")]);

    // The old Turn deadline, fired by hand, finds the game over and changes nothing.
    server.scheduler.advanceTo(T0 + 50 * MINUTE + HOUR);
    lastWakeUp();
    expect(alice.pending("game")).toEqual([]);
    expect(bob.pending("game")).toEqual([]);

    // An intent after the end is refused, and the game stays final.
    bob.send({ type: "Roll", turn: view.turn });
    expect(await bob.next("rejected")).toEqual({ code: "NOT_OFFERED" });
  });

  it("an ended game is deleted with its events 24 h after it ended, and its Room closes", async () => {
    const server = await start();
    const { alice, bob, code } = await startedGame(server);
    const endsAt = T0 + 50 * MINUTE;

    server.scheduler.advanceTo(endsAt);
    await Promise.all([alice.next("game"), bob.next("game")]);

    server.scheduler.advanceTo(endsAt + 24 * HOUR - 1);
    expect(server.store.isCodeInUse(code)).toBe(true);
    expect(server.room(code)).toBeDefined();

    server.scheduler.advanceTo(endsAt + 24 * HOUR);
    expect(server.store.isCodeInUse(code)).toBe(false);
    expect(server.store.events(code)).toEqual([]);
    await eventually(() => expect(server.room(code)).toBeUndefined());
  });

  it("a game-over state stored as unfinished (a crash before endGame) is finished on restore", async () => {
    const before = await start();
    const { code, aliceId } = await startedGame(before);
    const stored = before.store.unfinished().find((room) => room.code === code);
    const game = before.room(code)?.game;
    if (!stored || !game) throw new Error("the started game is not stored");
    // The final save landed, the crash came before the Room recorded `endedAt`.
    before.store.save(
      {
        ...stored,
        game: {
          ...game,
          phase: { kind: "gameOver", winner: aliceId, reason: "lastPlayer" },
          turnDeadline: null,
        },
      },
      [],
    );

    await stop(before);
    const restartedAt = T0 + 5_000;
    const after = await start({
      databasePath: before.databasePath,
      scheduler: new ManualScheduler(restartedAt),
    });

    expect(after.restored).toBe(1);
    expect(after.room(code)?.endedAt).toBe(restartedAt);
    expect(after.store.ended()).toEqual([{ code, endedAt: restartedAt }]);

    after.scheduler.advanceTo(restartedAt + 24 * HOUR);
    expect(after.store.isCodeInUse(code)).toBe(false);
  });
});
