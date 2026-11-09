import {
  apply,
  isRejection,
  SYSTEM,
  type Actor,
  type Applied,
  type GameState,
  type Intent,
  type Rejection,
} from "@universum/rules";
import type { RejectionCode } from "@universum/protocol";
import type { Logger } from "#observability/logger.ts";
import type { Scheduler } from "#room/scheduler.ts";

/** This many engine throws in a row in one Room are logged at `fatal` (spec: Engine throws). */
const ENGINE_THROWS_FATAL = 3;
/** A Turn deadline the engine or the store failed on is tried again after this, doubling each time… */
const DEADLINE_RETRY_MS = 5_000;
/** …up to this. */
const DEADLINE_RETRY_MAX_MS = 60_000;

/** The rules-engine overrides a clock needs; `GameRoom.timing` is one. */
export type TurnClockTiming = { turnLimitMs?: number };

export type TurnClockOptions = {
  /** The Room's clock and wake-ups. */
  scheduler: Scheduler;
  /** The rules engine's `apply`; a Room's injected one included. */
  engine: typeof apply;
  /** Shorter Turn limits for e2e runs; the rules constants when empty. */
  timing: TurnClockTiming;
  /** Where the third engine throw in a row is logged at `fatal`. */
  log: Logger;
  /**
   * Logs an engine throw and reports it (the Room's `failed`): the Game's
   * `version` and `phase` and the intent type, never the snapshot.
   */
  onError: (error: unknown, intent: string) => void;
  /**
   * Accepts a Turn's timeout (the Room's `commit`). A Rejection code means it
   * failed (a write failure), and the clock tries the deadline again.
   */
  onTimeout: (result: Applied) => RejectionCode | void;
};

/**
 * The Turn deadline's one wake-up, its retry back-off and the engine-throw
 * count (spec: Deadlines, Engine throws). `arm` keeps one wake-up for the
 * current `turnDeadline`; a wake-up that fires before it re-arms, a stale one
 * is ignored, and a failed engine call or commit is retried with back-off.
 *
 * `run` is the only way an intent reaches the engine, so Player intents and
 * `TurnTimedOut` share one throw policy: an engine bug keeps the last good
 * state, is logged and reported, and the third throw in a row is `fatal`.
 */
export class TurnClock {
  readonly #scheduler: Scheduler;
  readonly #engine: typeof apply;
  readonly #turnLimitMs: number | undefined;
  readonly #log: Logger;
  readonly #onError: (error: unknown, intent: string) => void;
  readonly #onTimeout: (result: Applied) => RejectionCode | void;
  /** Cancels the one pending wake-up. */
  #cancelWakeUp: (() => void) | null = null;
  /** The state the pending wake-up was armed for; `null` while none is pending. */
  #state: GameState | null = null;
  /** Failed tries of the current Turn deadline, for the retry back-off. */
  #retries = 0;
  /** Engine throws in a row in this Room; the third is logged at `fatal` (spec: Engine throws). */
  #throwsInARow = 0;

  constructor(options: TurnClockOptions) {
    this.#scheduler = options.scheduler;
    this.#engine = options.engine;
    this.#turnLimitMs = options.timing.turnLimitMs;
    this.#log = options.log;
    this.#onError = options.onError;
    this.#onTimeout = options.onTimeout;
  }

  /**
   * Keeps one wake-up per Room for the state's `turnDeadline` (none once the
   * game is over, and none while the Playback before a decision runs). The
   * retry back-off starts afresh for each new deadline.
   */
  arm(state: GameState): void {
    this.cancel();
    this.#state = state;
    const { turn, turnDeadline } = state;
    if (turnDeadline === null) return;
    this.#cancelWakeUp = this.#scheduler.at(turnDeadline, () => this.#timeOut(turn));
  }

  /** Drops the pending wake-up: the game is over, or the Room is going away. */
  cancel(): void {
    this.#cancelWakeUp?.();
    this.#cancelWakeUp = null;
    this.#state = null;
  }

  /**
   * Runs an intent through the rules engine. A throw (an engine bug) is
   * logged and reported, and gives `null`: the Room keeps its last good
   * state (spec: Engine throws).
   */
  run(game: GameState, intent: Intent, actor: Actor): Applied | Rejection | null {
    try {
      const result = this.#engine(game, intent, {
        actor,
        now: this.#scheduler.now(),
        turnLimitMs: this.#turnLimitMs,
      });
      this.#throwsInARow = 0;
      return result;
    } catch (error) {
      this.#throwsInARow += 1;
      this.#onError(error, intent.type);
      if (this.#throwsInARow === ENGINE_THROWS_FATAL) {
        this.#log.fatal({ throwsInARow: this.#throwsInARow }, "Engine keeps throwing");
      }
      return null;
    }
  }

  /**
   * The deadline of Turn `turn` has passed: the engine applies the Timeout
   * outcome and the Room commits it. A stale wake-up (the Turn moved on) is
   * rejected and ignored. If the engine throws or the write fails, the Room
   * keeps its state and tries again a little later, so Turn deadlines keep it
   * moving (spec: Engine throws).
   */
  #timeOut(turn: number): void {
    const state = this.#state;
    if (state === null) return;
    const result = this.run(state, { type: "TurnTimedOut", turn }, SYSTEM);
    if (result === null) {
      this.#retry(turn);
      return;
    }
    if (isRejection(result)) {
      this.#rearmEarly(turn);
      return;
    }
    const refused = this.#onTimeout(result);
    if (refused !== undefined) this.#retry(turn);
  }

  /** Waits 5 s, doubling each try up to a minute, then runs the deadline again. */
  #retry(turn: number): void {
    const delay = Math.min(DEADLINE_RETRY_MS * 2 ** this.#retries, DEADLINE_RETRY_MAX_MS);
    this.#retries += 1;
    this.#cancelWakeUp?.();
    this.#cancelWakeUp = this.#scheduler.at(this.#scheduler.now() + delay, () =>
      this.#timeOut(turn),
    );
  }

  /**
   * A wake-up can fire up to about a millisecond before `turnDeadline` (Node
   * timers don't wait), and the engine then refuses `TurnTimedOut` as
   * `NOT_OFFERED`. The deadline is still ahead, so wake up at it again; a
   * wake-up for a Turn already over is left to the deadline `commit` set.
   */
  #rearmEarly(turn: number): void {
    const state = this.#state;
    if (state === null || state.turn !== turn || state.turnDeadline === null) return;
    if (state.turnDeadline <= this.#scheduler.now()) return;
    this.#cancelWakeUp?.();
    this.#cancelWakeUp = this.#scheduler.at(state.turnDeadline, () => this.#timeOut(turn));
  }
}
