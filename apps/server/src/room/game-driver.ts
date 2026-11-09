import type { GameMessage, LobbySeat, RejectionCode } from "@universum/protocol";
import {
  isRejection,
  publicView,
  SYSTEM,
  type Actor,
  type Applied,
  type apply,
  type GameEvent,
  type GameState,
  type Intent,
  type Rejection,
  type Seed,
} from "@universum/rules";
import type { ErrorContext, ErrorReporter } from "#observability/error-reporting.ts";
import type { Logger } from "#observability/logger.ts";
import type { GameMetrics } from "#observability/metrics.ts";
import { deleteAfterRetention } from "#store/retention.ts";
import type { RoomStore, StoredRoom } from "#store/room-store.ts";
import type { Scheduler } from "#room/scheduler.ts";

/**
 * A taken Seat; `sessionId` is `null` while nobody is connected to it (e.g.
 * after a restore). `tokenHash`: the hash of its Guest's token, `null` if the
 * Guest sent none (then only the reconnection token brings them back).
 */
export type SeatRecord = LobbySeat & { sessionId: string | null; tokenHash: string | null };

/**
 * Test-only overrides (`GAME_TURN_LIMIT_MS`, `GAME_MINUTE_MS`, `GAME_SEED`),
 * so a full game fits an e2e run and its dice and cards are the same on every
 * run. Empty in production, which uses the rules constants and a fresh seed.
 */
export type GameTiming = { turnLimitMs?: number; minuteMs?: number; seed?: Seed };

/** The Room's identity, the part of its snapshot that never changes during a game. */
export type DriverRoom = Pick<StoredRoom, "settings" | "roomName" | "creatorId" | "password">;

/** What a submitted intent did: a Rejection for its sender, or the state everyone now has. */
export type Outcome = { rejected: RejectionCode } | { committed: GameState };

/** This many engine throws in a row in one Room are logged at `fatal` (spec: Engine throws). */
const ENGINE_THROWS_FATAL = 3;
/** A Turn deadline the engine or the store failed on is tried again after this, doubling each time… */
const DEADLINE_RETRY_MS = 5_000;
/** …up to this. */
const DEADLINE_RETRY_MAX_MS = 60_000;

export type GameDriverOptions = {
  /** The rules engine's `apply` (tests pass one that throws). */
  engine: typeof apply;
  /** The clock and wake-ups; the driver keeps at most one armed. */
  scheduler: Scheduler;
  /** Where the Room's snapshot and each intent's events are written. */
  store: RoomStore;
  metrics: GameMetrics;
  log: Logger;
  reporter: ErrorReporter;
  timing: GameTiming;
  /** The Room code stored with every snapshot and scheduled for retention. */
  roomCode: string;
  /** The Room's identity fields, read afresh for each write. */
  room: () => DriverRoom;
  /** Everyone hears a committed state; called only after the store has it. */
  publish: (state: GameState, message: GameMessage) => void;
  /** The game is over: the Room records the time and releases its Seats. */
  ended: (endedAt: number) => void;
  /** The retention period has run out: the Room disconnects. */
  retention: () => void;
};

/**
 * The commit pipeline of one Room: from an accepted intent to the next
 * wake-up. It runs the engine, writes the snapshot before anyone hears of a
 * new state, and keeps exactly one wake-up — the Turn deadline, its retry
 * back-off or the retention timer once the game has ended.
 *
 * It knows no Colyseus types, so tests drive it with a manual scheduler and a
 * throwing store or engine, without a socket (see `game-driver.test.ts`).
 */
export class GameDriver {
  readonly #engine: typeof apply;
  readonly #scheduler: Scheduler;
  readonly #store: RoomStore;
  readonly #metrics: GameMetrics;
  readonly #log: Logger;
  readonly #reporter: ErrorReporter;
  readonly #timing: GameTiming;
  readonly #roomCode: string;
  readonly #room: () => DriverRoom;
  readonly #publish: (state: GameState, message: GameMessage) => void;
  readonly #ended: (endedAt: number) => void;
  readonly #retention: () => void;
  /** The last state the engine accepted and the store wrote (the Room's `game`). */
  #game: GameState | null = null;
  /** The Seats to write with the next snapshot. */
  #seats: readonly SeatRecord[] = [];
  /** When the game ended (epoch ms), or `null` while it is playing. */
  #endedAt: number | null = null;
  /** Engine throws in a row in this Room; the third is logged at `fatal` (spec: Engine throws). */
  #throwsInARow = 0;
  /** Failed tries of the current Turn deadline, for the retry back-off. */
  #deadlineRetries = 0;
  /** Cancels the one pending wake-up (a deadline, its retry, or retention). */
  #cancelWakeUp: (() => void) | null = null;

  constructor(options: GameDriverOptions) {
    this.#engine = options.engine;
    this.#scheduler = options.scheduler;
    this.#store = options.store;
    this.#metrics = options.metrics;
    this.#log = options.log;
    this.#reporter = options.reporter;
    this.#timing = options.timing;
    this.#roomCode = options.roomCode;
    this.#room = options.room;
    this.#publish = options.publish;
    this.#ended = options.ended;
    this.#retention = options.retention;
  }

  /** The server's clock for the rules engine. */
  now(): number {
    return this.#scheduler.now();
  }

  /**
   * Commits the state a start built: stores it, publishes it and arms its
   * first Turn deadline. No engine call and no events.
   */
  start(game: GameState, seats: readonly SeatRecord[]): Outcome {
    return this.#commit({ state: game, events: [], reveals: [] }, "Start", seats, this.#endedAt);
  }

  /** Arms a restored game's deadline without writing or publishing anything. */
  resume(game: GameState, seats: readonly SeatRecord[], endedAt: number | null): void {
    this.#game = game;
    this.#seats = seats;
    this.#endedAt = endedAt;
    if (game.phase.kind === "gameOver") {
      this.#end(game, seats);
    } else if (endedAt === null) {
      this.#scheduleDeadline(game);
    }
  }

  /**
   * Runs one intent and commits its result. A Rejection leaves the last good
   * state and its wake-up alone; an engine throw or a failed write is
   * `INTERNAL` and tells no one.
   */
  submit(
    game: GameState,
    intent: Intent,
    actor: Actor,
    seats: readonly SeatRecord[],
    endedAt: number | null,
  ): Outcome {
    this.#game = game;
    this.#seats = seats;
    this.#endedAt = endedAt;
    const result = this.#run(game, intent, actor);
    if (result === null) return { rejected: "INTERNAL" };
    if (isRejection(result)) return { rejected: result.code };
    return this.#commit(result, intent.type, seats, endedAt);
  }

  /**
   * The deadline of Turn `turn` has passed: the engine applies the Timeout
   * outcome. A stale wake-up (the Turn moved on) is ignored, an early one is
   * re-armed for the deadline, and a throw or failed write is tried again a
   * little later, so Turn deadlines keep the game moving (spec: Engine throws).
   */
  timeOut(turn: number): void {
    const game = this.#game;
    if (!game || this.#endedAt !== null) return;
    const result = this.#run(game, { type: "TurnTimedOut", turn }, SYSTEM);
    if (result !== null && isRejection(result)) {
      this.#rearmEarly(turn);
      return;
    }
    if (
      result !== null &&
      !("rejected" in this.#commit(result, "TurnTimedOut", this.#seats, this.#endedAt))
    ) {
      return;
    }
    const delay = Math.min(DEADLINE_RETRY_MS * 2 ** this.#deadlineRetries, DEADLINE_RETRY_MAX_MS);
    this.#deadlineRetries += 1;
    this.#cancelWakeUp?.();
    this.#cancelWakeUp = this.#scheduler.at(this.now() + delay, () => this.timeOut(turn));
  }

  /**
   * The game is over (`commit` calls this when the game-over phase arrives,
   * and a restore finishes a game-over state a crash left unfinished): the
   * Room records when, stops waking up for Turns, and is deleted with its
   * events 24 h later (spec: Retention).
   */
  endGame(): void {
    if (!this.#game) return;
    this.#end(this.#game, this.#seats);
  }

  /** Cancels the one pending wake-up: the Room is disposing. */
  dispose(): void {
    this.#cancelWakeUp?.();
    this.#cancelWakeUp = null;
  }

  /** Accepts a new game state, in this order: store it with its events, publish it, arm its wake-up. */
  #commit(
    applied: Applied,
    intent: string,
    seats: readonly SeatRecord[],
    endedAt: number | null,
  ): Outcome {
    const { state, events, reveals } = applied;
    try {
      this.#save(state, events, seats, endedAt);
    } catch (error) {
      // The Room keeps its last good state.
      this.#failed(error, "Room not saved", intent);
      return { rejected: "INTERNAL" };
    }
    this.#game = state;
    this.#seats = seats;
    this.#endedAt = endedAt;
    this.#publish(state, {
      view: publicView(state, this.#timing),
      events,
      reveals,
      now: this.now(),
    });
    if (state.phase.kind === "gameOver") this.#end(state, seats);
    else this.#scheduleDeadline(state);
    return { committed: state };
  }

  /**
   * Runs the rules engine. A throw (an engine bug) is logged and reported,
   * and gives `null`: the Room keeps its last good state (spec: Engine throws).
   */
  #run(game: GameState, intent: Intent, actor: Actor): Applied | Rejection | null {
    try {
      const result = this.#engine(game, intent, {
        actor,
        now: this.now(),
        turnLimitMs: this.#timing.turnLimitMs,
      });
      this.#throwsInARow = 0;
      return result;
    } catch (error) {
      this.#throwsInARow += 1;
      this.#failed(error, "Engine threw", intent.type);
      if (this.#throwsInARow === ENGINE_THROWS_FATAL) {
        this.#log.fatal({ throwsInARow: this.#throwsInARow }, "Engine keeps throwing");
      }
      return null;
    }
  }

  /**
   * Logs an error at `error` and reports it, with the Room code, the game's
   * `version` and `phase`, and the intent type: never the snapshot or payload.
   */
  #failed(error: unknown, message: string, intent: string): void {
    const context: ErrorContext = { intent };
    if (this.#game) {
      context.version = this.#game.version;
      context.phase = this.#game.phase.kind;
    }
    this.#log.error({ err: error, ...context }, message);
    this.#reporter.report(error, { roomCode: this.#roomCode, ...context });
  }

  /** Writes the Room's snapshot and an intent's events; throws if the write fails. */
  #save(
    game: GameState,
    events: readonly GameEvent[],
    seats: readonly SeatRecord[],
    endedAt: number | null,
  ): void {
    this.#metrics.timeStoreWrite(() =>
      this.#store.save(
        {
          code: this.#roomCode,
          ...this.#room(),
          seats: seats.map(({ playerId, name, tokenHash }) => ({ playerId, name, tokenHash })),
          game,
          endedAt,
        },
        events,
      ),
    );
  }

  /** Keeps one wake-up per Room, for the current `turnDeadline` (none once the game is over). */
  #scheduleDeadline(state: GameState): void {
    this.#cancelWakeUp?.();
    this.#cancelWakeUp = null;
    this.#deadlineRetries = 0;
    const { turn, turnDeadline } = state;
    if (turnDeadline === null) return;
    this.#cancelWakeUp = this.#scheduler.at(turnDeadline, () => this.timeOut(turn));
  }

  /**
   * A wake-up can fire up to about a millisecond before `turnDeadline` (Node
   * timers don't wait), and the engine then refuses `TurnTimedOut` as
   * `NOT_OFFERED`. The deadline is still ahead, so wake up at it again; a
   * wake-up for a Turn already over is left to the deadline `commit` set.
   */
  #rearmEarly(turn: number): void {
    const game = this.#game;
    if (!game || game.turn !== turn || game.turnDeadline === null) return;
    if (game.turnDeadline <= this.now()) return;
    this.#cancelWakeUp?.();
    this.#cancelWakeUp = this.#scheduler.at(game.turnDeadline, () => this.timeOut(turn));
  }

  /** Records the end, stores it and swaps the Turn deadline for the retention wake-up. */
  #end(game: GameState, seats: readonly SeatRecord[]): void {
    if (this.#endedAt !== null) return;
    const endedAt = this.now();
    this.#endedAt = endedAt;
    this.#cancelWakeUp?.();
    this.#cancelWakeUp = null;
    try {
      this.#save(game, [], seats, endedAt);
    } catch (error) {
      // The final state is already stored; a restore finishes the Room (see `resume`).
      this.#log.error({ err: error }, "Room end not saved");
    }
    this.#log.info("Room ended");
    this.#ended(endedAt);
    this.#cancelWakeUp = deleteAfterRetention(
      this.#store,
      this.#scheduler,
      this.#roomCode,
      endedAt,
      this.#retention,
    );
  }
}
