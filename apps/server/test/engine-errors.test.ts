import { apply, type Intent } from "@universum/rules";
import { afterEach, describe, expect, it } from "vitest";
import type { ErrorContext, ErrorReporter } from "#observability/error-reporting.ts";
import { createLogger } from "#observability/logger.ts";
import { captureLogs, startTestServer, withDeadline, type TestServer } from "./helpers.ts";

/** 20 s on the ring plus the 3 s slack (F22). */
const DEADLINE_AFTER = 23_000;

let server: TestServer | undefined;

afterEach(async () => {
  await server?.stop();
  server = undefined;
});

/** A rules engine that throws on the intent types in `failing` (a bug for the Room to survive). */
function brokenEngine() {
  const failing = new Set<Intent["type"]>();
  const engine: typeof apply = (state, intent, ctx) => {
    if (failing.has(intent.type)) throw new Error(`engine bug on ${intent.type}`);
    return apply(state, intent, ctx);
  };
  return { engine, failing };
}

/** An error reporter that keeps what it was told. */
function fakeReporter() {
  const reports: { error: unknown; context: ErrorContext | undefined }[] = [];
  let flushed = 0;
  const reporter: ErrorReporter = {
    report: (error, context) => void reports.push({ error, context }),
    flush: async () => {
      flushed += 1;
    },
  };
  return { reporter, reports, flushed: () => flushed };
}

async function startedGame(s: TestServer) {
  const alice = await s.create({ maxPlayers: 2 });
  const bob = await s.join(alice.code);
  alice.send({ type: "Start" });
  const [first] = await Promise.all([alice.next("game"), bob.next("game")]);
  return { alice, bob, code: alice.code, view: withDeadline(first) };
}

describe("an engine throw on an intent", () => {
  it("refuses the sender with INTERNAL and keeps the last good state: nothing saved or broadcast", async () => {
    const { engine, failing } = brokenEngine();
    server = await startTestServer({ engine });
    const { alice, bob, code, view } = await startedGame(server);
    const events = server.store.events(code);

    failing.add("Roll");
    alice.send({ type: "Roll", turn: 1 });

    expect(await alice.next("rejected")).toEqual({ code: "INTERNAL" });
    expect(server.room(code)?.game).toMatchObject({ version: view.version, turn: 1 });
    expect(server.store.unfinished().find((r) => r.code === code)?.game).toMatchObject({
      version: view.version,
    });
    expect(server.store.events(code)).toEqual(events);

    // The Room is still playable, and Bob never heard of the failed Roll.
    failing.clear();
    alice.send({ type: "Roll", turn: 1 });
    const rolled = await bob.next("game");
    expect(rolled.view.version).toBe(view.version + 1);
    expect(rolled.events[0]?.type).toBe("DiceRolled");
    expect(bob.pending("game")).toEqual([]);
    expect(bob.pending("rejected")).toEqual([]);
  });

  it("is logged at error and reported with Room code, version, phase and intent type, never the state or payload", async () => {
    const { engine, failing } = brokenEngine();
    const logs = captureLogs();
    const { reporter, reports } = fakeReporter();
    server = await startTestServer({
      engine,
      reporter,
      log: createLogger({ level: "debug", stream: logs.stream }),
    });
    const { alice, code, view } = await startedGame(server);

    failing.add("Roll");
    alice.send({ type: "Roll", turn: 1 });
    await alice.next("rejected");

    const context = {
      roomCode: code,
      version: view.version,
      phase: "awaitingRoll",
      intent: "Roll",
    };
    const errors = logs.lines().filter((l) => l["level"] === 50);
    expect(errors).toEqual([
      expect.objectContaining({ ...context, msg: "Engine threw", err: expect.anything() }),
    ]);
    expect(reports).toEqual([{ error: expect.any(Error), context }]);
    expect(JSON.stringify(errors)).not.toMatch(/"turn"|seed|players|cash/);
  });

  it("3 throws in a row in one Room are logged at fatal, and the Room stays open", async () => {
    const { engine, failing } = brokenEngine();
    const logs = captureLogs();
    server = await startTestServer({
      engine,
      log: createLogger({ level: "info", stream: logs.stream }),
    });
    const { alice, bob, code } = await startedGame(server);
    const fatal = () => logs.lines().filter((l) => l["level"] === 60);

    failing.add("Roll");
    for (let i = 0; i < 2; i++) {
      alice.send({ type: "Roll", turn: 1 });
      // oxlint-disable-next-line no-await-in-loop -- one throw after another
      await alice.next("rejected");
    }
    expect(fatal()).toEqual([]);
    alice.send({ type: "Roll", turn: 1 });
    await alice.next("rejected");
    expect(fatal()).toEqual([
      expect.objectContaining({ roomCode: code, throwsInARow: 3, msg: "Engine keeps throwing" }),
    ]);

    failing.clear();
    alice.send({ type: "Roll", turn: 1 });
    expect((await bob.next("game")).events[0]?.type).toBe("DiceRolled");
  });

  it("a good intent in between starts the count afresh", async () => {
    const { engine, failing } = brokenEngine();
    const logs = captureLogs();
    server = await startTestServer({
      engine,
      log: createLogger({ level: "info", stream: logs.stream }),
    });
    const { alice, bob } = await startedGame(server);

    failing.add("Roll");
    for (let i = 0; i < 2; i++) {
      alice.send({ type: "Roll", turn: 1 });
      // oxlint-disable-next-line no-await-in-loop -- one throw after another
      await alice.next("rejected");
    }
    bob.send({ type: "DeclineOffer", turn: 1 }); // nothing to decline: a Rejection, but no throw
    expect(await bob.next("rejected")).not.toEqual({ code: "INTERNAL" });
    alice.send({ type: "Roll", turn: 1 });
    await alice.next("rejected");

    expect(logs.lines().filter((l) => l["level"] === 60)).toEqual([]);
  });
});

describe("an engine throw at a Turn deadline", () => {
  it("is logged and reported, and the deadline is tried again, so the Room keeps moving", async () => {
    const { engine, failing } = brokenEngine();
    const logs = captureLogs();
    const { reporter, reports } = fakeReporter();
    server = await startTestServer({
      engine,
      reporter,
      log: createLogger({ level: "info", stream: logs.stream }),
    });
    const { bob, code, view } = await startedGame(server);
    // Alice stays connected and does not roll: her Turn runs out. (An absent
    // Guest's Decision is the Bot's — ticket #198.)
    failing.add("TurnTimedOut");
    server.scheduler.advanceTo(view.turnDeadline);
    expect(server.room(code)?.game).toMatchObject({ version: view.version, turn: 1 });
    expect(reports).toEqual([
      {
        error: expect.any(Error),
        context: {
          roomCode: code,
          version: view.version,
          phase: "awaitingRoll",
          intent: "TurnTimedOut",
        },
      },
    ]);
    expect(logs.lines().filter((l) => l["level"] === 50)).toEqual([
      expect.objectContaining({ roomCode: code, intent: "TurnTimedOut", msg: "Engine threw" }),
    ]);

    // The bug is gone (say, a deploy): the next try times the Turn out.
    failing.clear();
    server.scheduler.advanceTo(view.turnDeadline + DEADLINE_AFTER);
    const timedOut = await bob.next("game");
    expect(timedOut.events[0]?.type).toBe("TimedOut");
    expect(timedOut.view).toMatchObject({ version: view.version + 1, turn: 2 });
  });

  it("a failed write at a deadline is logged, reported and tried again", async () => {
    let failWrites = false;
    const logs = captureLogs();
    const { reporter, reports } = fakeReporter();
    server = await startTestServer({
      reporter,
      log: createLogger({ level: "info", stream: logs.stream }),
      wrapStore: (store) => ({
        ...store,
        save(room, events) {
          if (failWrites) throw new Error("disk full");
          store.save(room, events);
        },
      }),
    });
    const { bob, code, view } = await startedGame(server);

    failWrites = true;
    server.scheduler.advanceTo(view.turnDeadline);
    expect(server.room(code)?.game).toMatchObject({ version: view.version });
    expect(reports).toEqual([
      {
        error: expect.any(Error),
        context: {
          roomCode: code,
          version: view.version,
          phase: "awaitingRoll",
          intent: "TurnTimedOut",
        },
      },
    ]);
    expect(logs.lines().filter((l) => l["level"] === 50)).toEqual([
      expect.objectContaining({ roomCode: code, msg: "Room not saved" }),
    ]);

    failWrites = false;
    server.scheduler.advanceTo(view.turnDeadline + DEADLINE_AFTER);
    const timedOut = await bob.next("game");
    expect(timedOut.view).toMatchObject({ version: view.version + 1, turn: 2 });
  });
});
