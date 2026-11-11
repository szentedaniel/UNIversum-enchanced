import {
  type apply,
  setupGame,
  type Actor,
  type Applied,
  type GameState,
  type Intent,
} from "@universum/rules";
import { describe, expect, it } from "vitest";
import { captureLogs, ManualScheduler } from "./helpers.ts";
import { createLogger, silentLogger } from "#observability/logger.ts";
import { TurnClock, type TurnClockOptions } from "#room/turn-clock.ts";

/** A real started game; the clock only reads `turn` and `turnDeadline` from it. */
const started = setupGame({
  seats: [
    { playerId: "p1", name: { adjective: "test", noun: "one" } },
    { playerId: "p2", name: { adjective: "test", noun: "two" } },
  ],
  settings: { maxPlayers: 2, minuteLimit: 50, startingCash: 2_500_000, roundBonus: 250_000 },
  seed: [1, 2, 3, 4],
  now: 0,
});

const stateAt = (turn: number, turnDeadline: number | null): GameState => ({
  ...started,
  turn,
  turnDeadline,
});

const applied = (state: GameState): Applied => ({ state, events: [], reveals: [] });

/** An engine that refuses a deadline that fired before it was due. */
const earlyEngine: typeof apply = (state, _intent, ctx) =>
  ctx.now < (state.turnDeadline ?? 0) ? { code: "NOT_OFFERED" } : applied(state);

/** An engine that refuses a timeout for a Turn that already passed. */
const staleEngine: typeof apply = (state, intent) =>
  intent.type === "TurnTimedOut" && intent.turn !== state.turn
    ? { code: "STALE_TURN" }
    : applied(state);

type EngineCall = { state: GameState; intent: Intent; actor: Actor; now: number };

/** An engine that records what it was given and applies everything. */
function recordingEngine() {
  const calls: EngineCall[] = [];
  const engine: typeof apply = (state, intent, ctx) => {
    calls.push({ state, intent, actor: ctx.actor, now: ctx.now });
    return applied(state);
  };
  return { engine, calls };
}

/** A clock on its own scheduler, with the Room's commit and error seams stubbed. */
type TestClockOptions = Omit<Partial<TurnClockOptions>, "scheduler"> & {
  scheduler?: ManualScheduler;
};

function startClock(options: TestClockOptions = {}) {
  const scheduler = options.scheduler ?? new ManualScheduler(0);
  const errors: { error: unknown; intent: string }[] = [];
  const commits: Applied[] = [];
  const clock = new TurnClock({
    scheduler,
    engine: (state) => applied(state),
    timing: {},
    log: silentLogger,
    onError: (error, intent) => void errors.push({ error, intent }),
    onTimeout: (result) => void commits.push(result),
    ...options,
  });
  return { clock, scheduler, errors, commits };
}

describe("TurnClock", () => {
  it("keeps one wake-up per Room: arming a new state cancels the old Turn's", () => {
    const { clock, scheduler, commits } = startClock();

    clock.arm(stateAt(1, 1_000));
    clock.arm(stateAt(2, 2_000));
    scheduler.advanceTo(1_000);
    expect(commits).toEqual([]);

    scheduler.advanceTo(2_000);
    expect(commits).toHaveLength(1);
  });

  it("runs TurnTimedOut against the armed state and hands the result to onTimeout", () => {
    const { engine, calls } = recordingEngine();
    const { clock, scheduler, commits } = startClock({ engine, timing: { turnLimitMs: 1_000 } });
    const state = stateAt(7, 5_000);
    clock.arm(state);

    scheduler.advanceTo(5_000);

    expect(calls).toEqual([
      { state, intent: { type: "TurnTimedOut", turn: 7 }, actor: null, now: 5_000 },
    ]);
    expect(commits).toEqual([applied(state)]);
  });

  it("re-arms a wake-up that fired before turnDeadline instead of timing out twice", () => {
    const { clock, scheduler, commits } = startClock({ engine: earlyEngine });
    clock.arm(stateAt(1, 1_000));

    scheduler.advanceTo(999);
    scheduler.fireEarly(1_000); // as a Node timer that fired a millisecond early
    expect(commits).toEqual([]);

    scheduler.advanceTo(1_000);
    expect(commits).toHaveLength(1);
    scheduler.advanceTo(1_000); // the re-armed wake-up does not fire twice
    expect(commits).toHaveLength(1);
  });

  it("ignores a stale wake-up once a later Turn is armed", () => {
    const { clock, scheduler, commits } = startClock({ engine: staleEngine });
    clock.arm(stateAt(1, 1_000));
    const stale = scheduler.lastTaskAt(1_000);

    clock.arm(stateAt(2, 2_000));
    stale(); // the cancelled timer slipped through anyway
    expect(commits).toEqual([]);

    scheduler.advanceTo(2_000);
    expect(commits).toHaveLength(1);
  });

  it("tries the deadline again after an engine throw, doubling the wait each time", () => {
    let throws = 2;
    const failed = new Error("engine bug");
    const engine: typeof apply = (state) => {
      if (throws > 0) {
        throws -= 1;
        throw failed;
      }
      return applied(state);
    };
    const { clock, scheduler, errors, commits } = startClock({ engine });
    clock.arm(stateAt(1, 1_000));

    scheduler.advanceTo(1_000); // first try: throws
    scheduler.advanceTo(5_999); // 5 s later is still too early
    expect(errors).toEqual([{ error: failed, intent: "TurnTimedOut" }]);
    expect(commits).toEqual([]);

    scheduler.advanceTo(6_000); // 5 s after the first try: throws again
    scheduler.advanceTo(15_999); // the next wait doubled to 10 s
    expect(errors).toHaveLength(2);
    expect(commits).toEqual([]);

    scheduler.advanceTo(16_000); // the engine applies it now
    expect(commits).toHaveLength(1);
    scheduler.advanceTo(60_000);
    expect(commits).toHaveLength(1);
  });

  it("starts the retry back-off afresh for each new deadline", () => {
    let fails = true;
    const engine: typeof apply = (state) => {
      if (fails) throw new Error("engine bug");
      return applied(state);
    };
    const { clock, scheduler, commits } = startClock({ engine });

    clock.arm(stateAt(1, 1_000));
    scheduler.advanceTo(1_000); // throws; the retry would be 5 s later
    clock.arm(stateAt(2, 7_000));
    scheduler.advanceTo(7_000); // throws again; a new deadline waits 5 s, not 10
    fails = false;
    scheduler.advanceTo(11_999);
    expect(commits).toEqual([]);
    scheduler.advanceTo(12_000);
    expect(commits).toHaveLength(1);
  });

  it("tries the deadline again when the Room cannot commit it, doubling the wait each time", () => {
    let refusals = 1;
    const { clock, scheduler, commits } = startClock({
      onTimeout: (result) => {
        commits.push(result);
        return refusals-- > 0 ? "INTERNAL" : undefined;
      },
    });
    clock.arm(stateAt(1, 1_000));

    scheduler.advanceTo(1_000);
    scheduler.advanceTo(5_999);
    expect(commits).toHaveLength(1);

    scheduler.advanceTo(6_000);
    expect(commits).toHaveLength(2);
    scheduler.advanceTo(60_000);
    expect(commits).toHaveLength(2);
  });

  it("logs the third engine throw in a row at fatal, and a good run starts the count afresh", () => {
    const logs = captureLogs();
    let throws = true;
    const engine: typeof apply = (state) => {
      if (throws) throw new Error("engine bug");
      return applied(state);
    };
    const { clock } = startClock({
      engine,
      log: createLogger({ level: "info", stream: logs.stream }),
    });
    const state = stateAt(1, null);
    const roll: Intent = { type: "Roll", turn: 1 };

    clock.run(state, roll, "p1");
    clock.run(state, roll, "p1");
    expect(logs.lines().filter((line) => line["level"] === 60)).toEqual([]);

    clock.run(state, roll, "p1");
    expect(logs.lines().filter((line) => line["level"] === 60)).toEqual([
      expect.objectContaining({ throwsInARow: 3, msg: "Engine keeps throwing" }),
    ]);

    throws = false;
    clock.run(state, roll, "p1"); // resets the count
    throws = true;
    clock.run(state, roll, "p1");
    clock.run(state, roll, "p1");
    expect(logs.lines().filter((line) => line["level"] === 60)).toHaveLength(1);
  });

  it("cancel drops the pending wake-up, even if its callback is fired by hand", () => {
    const { engine, calls } = recordingEngine();
    const { clock, scheduler, commits } = startClock({ engine });
    clock.arm(stateAt(1, 1_000));
    const wakeUp = scheduler.lastTaskAt(1_000);

    clock.cancel();
    wakeUp();
    scheduler.advanceTo(1_000);

    expect(calls).toEqual([]);
    expect(commits).toEqual([]);
  });
});
