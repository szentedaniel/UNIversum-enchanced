/**
 * The commit pipeline on its own: no Colyseus Room and no sockets. A manual
 * scheduler drives the Turn deadline, a fake store fails on demand, a throwing
 * engine stands in for an engine bug and the Room state is read live.
 */
import {
  apply,
  publicView,
  setupGame,
  type GameEvent,
  type GameState,
  type Intent,
  type Seed,
} from "@universum/rules";
import type { GameMessage, RoomSettings } from "@universum/protocol";
import { describe, expect, it } from "vitest";
import type { ErrorContext, ErrorReporter } from "#observability/error-reporting.ts";
import { createLogger, type Logger } from "#observability/logger.ts";
import { GameMetrics } from "#observability/metrics.ts";
import {
  GameDriver,
  type DriverRoom,
  type DriverState,
  type GameTiming,
  type SeatRecord,
} from "#room/game-driver.ts";
import type { RoomStore, StoredRoom } from "#store/room-store.ts";
import { ManualScheduler, T0, captureLogs } from "./helpers.ts";

const TURN_LIMIT_MS = 1_000;
/** The ring plus the server's network slack (F22). */
const MINUTE_MS = 1_000;
const HOUR_MS = 60 * 60 * 1_000;
const RETENTION_MS = 24 * HOUR_MS;
const SEED: Seed = [1, 2, 3, 4];
const SETTINGS: RoomSettings = {
  maxPlayers: 2,
  minuteLimit: 15,
  startingCash: 2_500_000,
  turnLimitMs: 20_000,
};

const SEATS: SeatRecord[] = [
  {
    playerId: "p1",
    name: { adjective: "brave", noun: "otter" },
    sessionId: null,
    tokenHash: null,
  },
  {
    playerId: "p2",
    name: { adjective: "calm", noun: "heron" },
    sessionId: null,
    tokenHash: null,
  },
];

const ROOM: DriverRoom = {
  settings: SETTINGS,
  roomName: null,
  creatorId: "p1",
  password: null,
};

/** A RoomStore that keeps what it was saved and can fail on demand. */
function fakeStore() {
  const saved: { room: StoredRoom; events: readonly GameEvent[] }[] = [];
  const deleted: string[] = [];
  let failing = false;
  const store: RoomStore = {
    unfinished: () => [],
    ended: () => [],
    save(room, events) {
      if (failing) throw new Error("disk full");
      saved.push({ room, events });
    },
    isCodeInUse: () => false,
    delete: (code) => void deleted.push(code),
    events: () => [],
    close: () => {},
  };
  return {
    store,
    saved,
    deleted,
    fail: (value: boolean) => {
      failing = value;
    },
  };
}

/** An error reporter that keeps what it was told. */
function fakeReporter() {
  const reports: { error: unknown; context: ErrorContext | undefined }[] = [];
  const reporter: ErrorReporter = {
    report: (error, context) => void reports.push({ error, context }),
    flush: async () => {},
  };
  return { reporter, reports };
}

/** A rules engine that throws on the intent types in `failing`. */
function brokenEngine() {
  const failing = new Set<Intent["type"]>();
  const engine: typeof apply = (state, intent, ctx) => {
    if (failing.has(intent.type)) throw new Error(`engine bug on ${intent.type}`);
    return apply(state, intent, ctx);
  };
  return { engine, failing };
}

function newGame(overrides: { minuteMs?: number } = {}): GameState {
  return setupGame({
    seats: SEATS.map(({ playerId, name }) => ({ playerId, name })),
    settings: SETTINGS,
    seed: SEED,
    now: T0,
    turnLimitMs: TURN_LIMIT_MS,
    minuteMs: overrides.minuteMs ?? MINUTE_MS,
  });
}

/** A driver wired to a manual clock, a fake store, live Room state and recording callbacks. */
function newDriver(
  options: {
    engine?: typeof apply;
    store?: RoomStore;
    log?: Logger;
    reporter?: ErrorReporter;
    timing?: GameTiming;
  } = {},
) {
  const scheduler = new ManualScheduler();
  const logs = captureLogs();
  const store = fakeStore();
  const state: DriverState = { game: null, seats: SEATS, endedAt: null };
  const published: { state: GameState; message: GameMessage }[] = [];
  const ended: number[] = [];
  const retained: string[] = [];
  const driver = new GameDriver({
    engine: options.engine ?? apply,
    scheduler,
    store: options.store ?? store.store,
    metrics: new GameMetrics({ release: "test" }),
    log: options.log ?? createLogger({ level: "silent", stream: logs.stream }),
    reporter: options.reporter ?? { report: () => {}, flush: async () => {} },
    timing: options.timing ?? { turnLimitMs: TURN_LIMIT_MS, seed: SEED },
    roomCode: "ABC123",
    readRoom: () => ROOM,
    readState: () => state,
    publish: (game, message) => {
      state.game = game;
      published.push({ state: game, message });
    },
    onEnded: (endedAt) => {
      state.endedAt = endedAt;
      ended.push(endedAt);
    },
    onRetention: () => void retained.push("ABC123"),
  });
  return { driver, scheduler, logs, state, ...store, published, ended, retained };
}

describe("committing an intent", () => {
  it("stores the new state and its events, then publishes the view, before the next wake-up", () => {
    const { driver, scheduler, saved, published, state } = newDriver();
    const game = newGame();

    expect(driver.start(game)).toEqual({ committed: game });

    expect(saved).toEqual([
      {
        room: {
          code: "ABC123",
          ...ROOM,
          seats: SEATS.map(({ playerId, name, tokenHash }) => ({ playerId, name, tokenHash })),
          game,
          endedAt: null,
        },
        events: [],
      },
    ]);
    expect(published).toEqual([
      {
        state: game,
        message: {
          view: publicView(game, { turnLimitMs: TURN_LIMIT_MS }),
          events: [],
          reveals: [],
          now: T0,
        },
      },
    ]);
    expect(state.game).toBe(game);
    expect(() => scheduler.lastTaskAt(game.turnDeadline ?? 0)).not.toThrow();
  });

  it("a new decision replaces the previous Turn deadline: only one wake-up is armed", () => {
    const { driver, scheduler, published } = newDriver();
    const game = newGame();
    driver.start(game);
    const firstDeadline = game.turnDeadline ?? 0;

    const outcome = driver.submit(game, { type: "Roll", turn: 1 }, "p1");
    expect("committed" in outcome).toBe(true);

    // The first deadline is cancelled: it finds no task to fire.
    scheduler.advanceTo(firstDeadline);
    expect(published).toHaveLength(2);
  });

  it("a failed write changes nothing: INTERNAL, no publish and the last good state kept", () => {
    const { driver, saved, published, state, fail } = newDriver();
    const game = newGame();
    driver.start(game);

    fail(true);
    expect(driver.submit(game, { type: "Roll", turn: 1 }, "p1")).toEqual({
      rejected: "INTERNAL",
    });
    expect(published).toHaveLength(1);
    expect(state.game).toBe(game);
    expect(saved.at(-1)?.room.game).toBe(game);

    fail(false);
    const outcome = driver.submit(game, { type: "Roll", turn: 1 }, "p1");
    expect(outcome).toMatchObject({ committed: { version: 1 } });
    expect(published.at(-1)?.message.events[0]?.type).toBe("DiceRolled");
  });

  it("an engine throw is INTERNAL, logged and reported, and the third in a row is fatal", () => {
    const { engine, failing } = brokenEngine();
    const { reporter, reports } = fakeReporter();
    const logs = captureLogs();
    const { driver } = newDriver({
      engine,
      reporter,
      log: createLogger({ level: "info", stream: logs.stream }).child({ roomCode: "ABC123" }),
    });
    const game = newGame();
    driver.start(game);

    failing.add("Roll");
    for (let i = 0; i < 3; i++) {
      expect(driver.submit(game, { type: "Roll", turn: 1 }, "p1")).toEqual({
        rejected: "INTERNAL",
      });
    }

    const context = { roomCode: "ABC123", version: 0, phase: "awaitingRoll", intent: "Roll" };
    expect(reports).toHaveLength(3);
    expect(reports[0]).toEqual({ error: expect.any(Error), context });
    expect(logs.lines().filter((line) => line["level"] === 60)).toEqual([
      expect.objectContaining({
        roomCode: "ABC123",
        throwsInARow: 3,
        msg: "Engine keeps throwing",
      }),
    ]);

    // A good intent resets the count.
    failing.clear();
    driver.submit(game, { type: "Roll", turn: 1 }, "p1");
    failing.add("Roll");
    driver.submit(game, { type: "Roll", turn: 1 }, "p1");
    expect(logs.lines().filter((line) => line["level"] === 60)).toHaveLength(1);
  });
});

describe("the Turn deadline", () => {
  it("times the Turn out, publishes it and arms the next deadline", () => {
    const { driver, scheduler, published } = newDriver();
    const game = newGame();
    driver.start(game);

    scheduler.advanceTo(game.turnDeadline ?? 0);

    expect(published).toHaveLength(2);
    const timedOut = published[1];
    expect(timedOut?.message.events[0]).toEqual({ type: "TimedOut", player: "p1" });
    expect(timedOut?.state.version).toBe(1);
    expect(() => scheduler.lastTaskAt(timedOut?.state.turnDeadline ?? 0)).not.toThrow();
  });

  it("a wake-up that fires early is re-armed for the deadline, and times the Turn out once", () => {
    const { driver, scheduler, published } = newDriver();
    const game = newGame();
    driver.start(game);
    const deadline = game.turnDeadline ?? 0;

    scheduler.advanceTo(deadline - 1);
    scheduler.fireEarly(deadline);
    expect(published).toHaveLength(1);

    scheduler.advanceTo(deadline);
    expect(published).toHaveLength(2);
    scheduler.advanceTo(deadline);
    expect(published).toHaveLength(2);
  });

  it("an engine throw at the deadline retries at 5 s, doubling the wait each time", () => {
    const { engine, failing } = brokenEngine();
    const { driver, scheduler, published } = newDriver({ engine });
    const game = newGame();
    driver.start(game);
    const deadline = game.turnDeadline ?? 0;

    failing.add("TurnTimedOut");
    scheduler.advanceTo(deadline);
    scheduler.advanceTo(deadline + 4_999);
    expect(published).toHaveLength(1);

    scheduler.advanceTo(deadline + 5_000); // second try, wait doubles to 10 s
    scheduler.advanceTo(deadline + 14_999);
    expect(published).toHaveLength(1);

    failing.clear();
    scheduler.advanceTo(deadline + 15_000); // third try: it times the Turn out
    expect(published).toHaveLength(2);
    expect(published[1]?.message.events[0]?.type).toBe("TimedOut");
  });

  it("caps the retry back-off at 60 s", () => {
    const { engine, failing } = brokenEngine();
    const { driver, scheduler, published } = newDriver({ engine });
    const game = newGame();
    driver.start(game);
    const deadline = game.turnDeadline ?? 0;

    failing.add("TurnTimedOut");
    // Tries at the deadline, +5 s, +15 s, +35 s and +75 s.
    for (const at of [0, 5_000, 15_000, 35_000, 75_000]) scheduler.advanceTo(deadline + at);
    expect(published).toHaveLength(1);

    failing.clear();
    // The next try would be +80 s uncapped; it is at +60 s instead.
    scheduler.advanceTo(deadline + 75_000 + 59_999);
    expect(published).toHaveLength(1);
    scheduler.advanceTo(deadline + 135_000);
    expect(published).toHaveLength(2);
  });

  it("a failed write at the deadline is retried and publishes once the write works", () => {
    const { driver, scheduler, published, fail } = newDriver();
    const game = newGame();
    driver.start(game);
    const deadline = game.turnDeadline ?? 0;

    fail(true);
    scheduler.advanceTo(deadline);
    expect(published).toHaveLength(1);

    fail(false);
    scheduler.advanceTo(deadline + 5_000);
    expect(published).toHaveLength(2);
    expect(published[1]?.message.events[0]?.type).toBe("TimedOut");
  });

  it("saves the Room's live Seats, not the copy from when the game started", () => {
    const { driver, scheduler, saved, state } = newDriver();
    const game = newGame();
    driver.start(game);
    const replaced: SeatRecord[] = [
      { ...SEATS[0]!, sessionId: "s1", tokenHash: "h1" },
      SEATS[1]!,
      {
        playerId: "p3",
        name: { adjective: "test", noun: "three" },
        sessionId: "s3",
        tokenHash: "h3",
      },
    ];
    state.seats = replaced;

    scheduler.advanceTo(game.turnDeadline ?? 0);

    expect(saved.at(-1)?.room.seats).toEqual(
      replaced.map(({ playerId, name, tokenHash }) => ({ playerId, name, tokenHash })),
    );
    expect(saved.at(-1)?.room.seats).toHaveLength(3);
  });
});

describe("restoring and saving the Room", () => {
  it("resume arms a stored deadline without saving or publishing, and a stored game-over ends", () => {
    const { driver, scheduler, published, ended } = newDriver();
    const game = newGame();
    driver.resume(game);
    expect(published).toEqual([]);
    scheduler.advanceTo(game.turnDeadline ?? 0);
    expect(published).toHaveLength(1);
    expect(ended).toEqual([]);

    const { driver: second, saved, ended: secondEnded } = newDriver();
    second.resume({ ...game, phase: { kind: "gameOver", winner: "p1", reason: "lastPlayer" } });
    expect(secondEnded).toEqual([T0]);
    expect(saved.at(-1)?.room.endedAt).toBe(T0);
  });

  it("saveSeats writes the live snapshot with the Seats its caller is about to have", () => {
    const { driver, saved, state } = newDriver();
    const game = newGame();
    driver.start(game);
    const joined: SeatRecord[] = [
      ...SEATS,
      {
        playerId: "p3",
        name: { adjective: "test", noun: "three" },
        sessionId: null,
        tokenHash: "hash",
      },
    ];

    driver.saveSeats(joined);

    expect(saved.at(-1)).toEqual({
      room: {
        code: "ABC123",
        ...ROOM,
        seats: joined.map(({ playerId, name, tokenHash }) => ({ playerId, name, tokenHash })),
        game,
        endedAt: null,
      },
      events: [],
    });
    expect(state.seats).toBe(SEATS);
  });
});

describe("the game ending", () => {
  it("publishes the final state, records the end and only then arms the retention wake-up", () => {
    const { driver, scheduler, saved, published, ended, deleted, retained } = newDriver();
    // 15 "minutes" of 100 ms: the Minute limit runs out before the first deadline.
    const game = newGame({ minuteMs: 100 });
    driver.start(game);
    const deadline = game.turnDeadline ?? 0;
    expect(game.endsAt).toBeLessThan(deadline);

    scheduler.advanceTo(deadline);

    expect(published).toHaveLength(2);
    expect(published[1]?.message.events.at(-1)).toEqual({
      type: "GameEnded",
      winner: "p2",
      reason: "timeUp",
    });
    expect(ended).toEqual([deadline]);
    expect(saved.at(-1)?.room).toMatchObject({
      endedAt: deadline,
      game: { phase: { kind: "gameOver" } },
    });

    scheduler.advanceTo(deadline + RETENTION_MS - 1);
    expect(deleted).toEqual([]);
    scheduler.advanceTo(deadline + RETENTION_MS);
    expect(deleted).toEqual(["ABC123"]);
    expect(retained).toEqual(["ABC123"]);
  });

  it("endGame finishes a game-over state (the restore self-heal) and never wakes up for Turns again", () => {
    const { driver, scheduler, state, saved, published, ended, deleted } = newDriver();
    const game = newGame();
    driver.start(game);

    driver.endGame();
    expect(ended).toEqual([T0]);
    expect(state.endedAt).toBe(T0);
    expect(saved.at(-1)?.room.endedAt).toBe(T0);
    expect(published).toHaveLength(1);

    driver.endGame(); // already ended: nothing changes
    expect(ended).toEqual([T0]);

    scheduler.advanceTo(T0 + RETENTION_MS);
    expect(published).toHaveLength(1);
    expect(deleted).toEqual(["ABC123"]);
  });
});
