import type { GameMessage, LobbySeat, RejectionCode } from "@universum/protocol";
import {
  botIntent,
  isRejection,
  publicView,
  type Actor,
  type apply,
  type Applied,
  type GameEvent,
  type GameState,
  type Intent,
  type Seed,
} from "@universum/rules";
import type { ErrorContext, ErrorReporter } from "#observability/error-reporting.ts";
import type { Logger } from "#observability/logger.ts";
import type { GameMetrics } from "#observability/metrics.ts";
import { deleteAfterRetention } from "#store/retention.ts";
import type { RoomStore, StoredRoom } from "#store/room-store.ts";
import type { Scheduler } from "#room/scheduler.ts";
import { TurnClock } from "#room/turn-clock.ts";

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

/** The Room's mutable snapshot fields, read live: the driver never keeps a stale copy. */
export type DriverState = {
  game: GameState | null;
  seats: readonly SeatRecord[];
  endedAt: number | null;
};

/** What a submitted intent did: a Rejection for its sender, or the state everyone now has. */
export type Outcome = { rejected: RejectionCode } | { committed: GameState };

/** Why a state was committed: a Player intent type, a Turn timeout, or the first Start. */
export type CommitReason = Intent["type"] | "Start";

/**
 * How long a Bot waits after its Decision gate before the Room plays its
 * intent: about 1–2 s, so the table can follow the action, and well inside the
 * Turn timer (spec: Bots, story 10).
 */
export const BOT_DELAY_MS = 1_500;

/**
 * How long a game whose Guests have all dropped keeps its Seats before it
 * ends with no recorded result (spec: Bots, story 19). The Room's usual Seat
 * retention: long enough for a reload, short enough that nobody plays a
 * Bot-only game out.
 */
export const BOT_ONLY_RETENTION_MS = 60_000;

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
  readRoom: () => DriverRoom;
  /** The Room's game, Seats and end time, read afresh for each write. */
  readState: () => DriverState;
  /** Everyone hears a committed state; called only after the store has it. */
  publish: (state: GameState, message: GameMessage) => void;
  /** The game is over: the Room records the time and releases its Seats. */
  onEnded: (endedAt: number) => void;
  /** The retention period has run out: the Room disconnects. */
  onRetention: () => void;
  /**
   * Whether that Seat's Player has a live connection right now. The Room's
   * fact, not the snapshot's: a restored Seat's `sessionId` is stale, and a
   * Guest who dropped keeps the one they had.
   */
  isSeatConnected: (seat: SeatRecord) => boolean;
};

/**
 * The commit pipeline of one Room: from an accepted intent to the next
 * wake-up. It composes the `TurnClock` (the engine's throw policy and the one
 * Turn deadline, its retry back-off and early re-arm) with the store write,
 * the broadcast and the retention timer.
 *
 * The `TurnClock` runs the engine; the driver writes the snapshot before
 * anyone hears of a new state and reads the Room's live Seats and end time at
 * that moment, so it never commits a stale copy.
 *
 * It knows no Colyseus types, so tests drive it with a manual scheduler and a
 * throwing store or engine, without a socket (see `game-driver.test.ts`).
 */
export class GameDriver {
  readonly #scheduler: Scheduler;
  readonly #store: RoomStore;
  readonly #metrics: GameMetrics;
  readonly #log: Logger;
  readonly #reporter: ErrorReporter;
  readonly #timing: GameTiming;
  readonly #roomCode: string;
  readonly #readRoom: () => DriverRoom;
  readonly #readState: () => DriverState;
  readonly #publish: (state: GameState, message: GameMessage) => void;
  readonly #onEnded: (endedAt: number) => void;
  readonly #onRetention: () => void;
  readonly #isSeatConnected: (seat: SeatRecord) => boolean;
  readonly #clock: TurnClock;
  /** Cancels the retention deletion once the game ended (its own wake-up, not the Turn's). */
  #cancelDeletion: (() => void) | null = null;
  /** Cancels the pending Bot action, if any: a commit, a reconnect or the game's end replaces it. */
  #cancelBot: (() => void) | null = null;
  /** Cancels the Bot-only game's end, if armed: a Guest came back, or the game ended. */
  #cancelBotRetention: (() => void) | null = null;

  constructor(options: GameDriverOptions) {
    this.#scheduler = options.scheduler;
    this.#store = options.store;
    this.#metrics = options.metrics;
    this.#log = options.log;
    this.#reporter = options.reporter;
    this.#timing = options.timing;
    this.#roomCode = options.roomCode;
    this.#readRoom = options.readRoom;
    this.#readState = options.readState;
    this.#publish = options.publish;
    this.#onEnded = options.onEnded;
    this.#onRetention = options.onRetention;
    this.#isSeatConnected = options.isSeatConnected;
    this.#clock = new TurnClock({
      scheduler: options.scheduler,
      engine: options.engine,
      timing: options.timing,
      log: options.log,
      onError: (error, intent) => this.failed(error, "Engine threw", intent),
      onTimeout: (result) => {
        // A deadline that slipped through after the end changes nothing.
        if (this.#readState().endedAt !== null) return undefined;
        const outcome = this.#commit(result, "TurnTimedOut");
        return "rejected" in outcome ? outcome.rejected : undefined;
      },
    });
  }

  /** The server's clock for the rules engine. */
  now(): number {
    return this.#scheduler.now();
  }

  /**
   * Commits the state a start built: stores it, publishes it and arms its
   * first Turn deadline. No engine call and no events.
   */
  start(game: GameState): Outcome {
    return this.#commit({ state: game, events: [], reveals: [] }, "Start");
  }

  /**
   * Arms a restored Room without writing or publishing anything: an ended
   * Room's retention deletion (its Podium stays until then), a running game's
   * deadline, or the end a crash left unrecorded.
   */
  resume(game: GameState): void {
    const { endedAt } = this.#readState();
    if (endedAt !== null) {
      this.#cancelDeletion = deleteAfterRetention(
        this.#store,
        this.#scheduler,
        this.#roomCode,
        endedAt,
        this.#onRetention,
      );
      return;
    }
    if (game.phase.kind === "gameOver") this.#end(game);
    else {
      this.#clock.arm(game);
      // A restored game has had no connection to lose since this server
      // started it: its Guests keep their Turn timers and no Bot plays until
      // the Room's first connection change re-evaluates them (spec: Bots).
      this.#armBot(game, this.#botPlays(game));
    }
  }

  /**
   * Runs one intent and commits its result. A Rejection leaves the last good
   * state and its wake-up alone; an engine throw or a failed write is
   * `INTERNAL` and tells no one.
   */
  submit(game: GameState, intent: Intent, actor: Actor): Outcome {
    const result = this.#clock.run(game, intent, actor);
    if (result === null) return { rejected: "INTERNAL" };
    if (isRejection(result)) return { rejected: result.code };
    return this.#commit(result, intent.type);
  }

  /**
   * The game is over (a commit calls this when the game-over phase arrives,
   * and a restore finishes a game-over state a crash left unfinished): the
   * Room records when, stops waking up for Turns, and is deleted with its
   * events 24 h later (spec: Retention).
   */
  endGame(): void {
    const game = this.#readState().game;
    if (game) this.#end(game);
  }

  /** Writes the Room's live snapshot with these Seats; the one writer of its shape. */
  saveSeats(seats: readonly SeatRecord[]): void {
    const { game, endedAt } = this.#readState();
    this.#save(game, [], seats, endedAt);
  }

  /**
   * Saves the Room as a Lobby again (spec #175): one write clears the ended
   * game and its end time with the kept Seats, then the old game's retention
   * deletion is cancelled. A failed write throws before either, so the Room
   * stays ended with its deletion armed; a later end arms retention again.
   */
  saveLobby(seats: readonly SeatRecord[]): void {
    this.#save(null, [], seats, null);
    this.#cancelDeletion?.();
    this.#cancelDeletion = null;
  }

  /**
   * Logs an error at `error` and reports it, with the Room code, the game's
   * `version` and `phase`, and the intent type: never the snapshot or payload.
   */
  failed(error: unknown, message: string, intent: string): void {
    const context: ErrorContext = { intent };
    const game = this.#readState().game;
    if (game) {
      context.version = game.version;
      context.phase = game.phase.kind;
    }
    this.#log.error({ err: error, ...context }, message);
    this.#reporter.report(error, { roomCode: this.#roomCode, ...context });
  }

  /** Cancels the Turn clock, the Bot's wake-up and the retention deletion: the Room is disposing. */
  dispose(): void {
    this.#clock.cancel();
    this.#cancelBot?.();
    this.#cancelBot = null;
    this.#cancelBotRetention?.();
    this.#cancelBotRetention = null;
    this.#cancelDeletion?.();
    this.#cancelDeletion = null;
  }

  /**
   * A Seat's connection changed (a Guest dropped or left, reconnected, or took
   * their Seat back from another tab): the open Decision's Bot action is
   * re-evaluated. An absent Guest's Seat gets one; a Guest who is back has any
   * pending one cancelled, so they answer the Decision from here. A Bot action
   * already applied stands: its commit armed the next Decision's wake-up.
   *
   * With no Guest connected the Bots stop, and the game ends with no recorded
   * result once its Seats' retention runs out (spec: Bots, story 19) — unless
   * a Guest comes back first.
   */
  refreshBot(): void {
    const { game, endedAt } = this.#readState();
    if (game === null || endedAt !== null) return;
    if (this.#guestsConnected()) {
      this.#cancelBotRetention?.();
      this.#cancelBotRetention = null;
    } else {
      this.#armBotRetention();
    }
    const plays = this.#botPlays(game);
    // The pending action is for this Decision already: another Seat's
    // connection change must not push it later.
    if (plays && this.#cancelBot !== null) return;
    this.#armBot(game, plays);
  }

  /**
   * Whether the Bot policy answers this state's open Decision: a seated Bot,
   * or a Guest's Seat with no live connection (a drop, or a leave), so a Guest
   * who is not there costs the table no Turn timer (spec: Bots). Never with no
   * Guest connected: Bots do not play a game out among themselves.
   */
  #botPlays(state: GameState): boolean {
    if (!this.#guestsConnected()) return false;
    if (state.players.find((p) => p.id === state.currentPlayer)?.bot === true) return true;
    const seat = this.#readState().seats.find((s) => s.playerId === state.currentPlayer);
    return seat !== undefined && !this.#isSeatConnected(seat);
  }

  /** Whether any Guest's Seat has a live connection; a Bot's Seat never counts. */
  #guestsConnected(): boolean {
    return this.#readState().seats.some((seat) => seat.bot !== true && this.#isSeatConnected(seat));
  }

  /**
   * Arms the game's one end for a Bot-only game: `BOT_ONLY_RETENTION_MS` after
   * its last Guest dropped, unless one comes back and `refreshBot` cancels it.
   */
  #armBotRetention(): void {
    if (this.#cancelBotRetention !== null) return;
    this.#cancelBotRetention = this.#scheduler.at(this.now() + BOT_ONLY_RETENTION_MS, () => {
      this.#cancelBotRetention = null;
      const { game, endedAt } = this.#readState();
      if (game === null || endedAt !== null || this.#guestsConnected()) return;
      // Nobody came back: the game ends where it stood, with no result recorded.
      this.#log.info("Room ended with no Guest connected");
      this.#end(game);
    });
  }

  /**
   * Arms the Bot's one wake-up for the state's open Decision (spec: Bots), if
   * it plays: about a second and a half after the Playback ends, well inside
   * the Turn timer. A new commit or a connection change replaces an older one.
   */
  #armBot(state: GameState, plays: boolean): void {
    this.#cancelBot?.();
    this.#cancelBot = null;
    if (!plays || state.phase.kind === "gameOver") return;
    // The gate may already be open (a restore): the pause counts from now then.
    const at = Math.max(state.actsAfter, this.now()) + BOT_DELAY_MS;
    const version = state.version;
    this.#cancelBot = this.#scheduler.at(at, () => this.#playBot(version));
  }

  /**
   * The Bot's pause is over: the policy answers the open Decision and the
   * intent goes through the rules engine as any Player's would. A stale
   * wake-up (the version moved on) changes nothing. A policy bug shows up as a
   * refused intent in the log; the Turn timer still moves the game along.
   */
  #playBot(version: number): void {
    this.#cancelBot = null;
    const { game, endedAt } = this.#readState();
    if (game === null || endedAt !== null || game.version !== version) return;
    // A Guest's reconnect cancels the wake-up; this keeps a race from answering
    // a Decision the Guest is back for.
    if (!this.#botPlays(game)) return;
    const actor = game.currentPlayer;
    const intent = botIntent(publicView(game, this.#timing));
    if (intent === null) return;
    const outcome = this.submit(game, intent, actor);
    if ("rejected" in outcome) {
      this.#log.error({ code: outcome.rejected, intent: intent.type }, "Bot intent refused");
    }
  }

  /** Accepts a new game state, in this order: store it with its events, publish it, arm its wake-up. */
  #commit(applied: Applied, reason: CommitReason): Outcome {
    const { state, events, reveals } = applied;
    const { seats, endedAt } = this.#readState();
    try {
      this.#save(state, events, seats, endedAt);
    } catch (error) {
      // The Room keeps its last good state.
      this.failed(error, "Room not saved", reason);
      return { rejected: "INTERNAL" };
    }
    this.#publish(state, {
      view: publicView(state, this.#timing),
      events,
      reveals,
      now: this.now(),
    });
    if (state.phase.kind === "gameOver") this.#end(state);
    else {
      this.#clock.arm(state);
      this.#armBot(state, this.#botPlays(state));
    }
    return { committed: state };
  }

  /** Writes the Room's snapshot and an intent's events; throws if the write fails. */
  #save(
    game: GameState | null,
    events: readonly GameEvent[],
    seats: readonly SeatRecord[],
    endedAt: number | null,
  ): void {
    this.#metrics.timeStoreWrite(() =>
      this.#store.save(
        {
          code: this.#roomCode,
          ...this.#readRoom(),
          seats: seats.map(({ playerId, name, tokenHash, bot }) => ({
            playerId,
            name,
            tokenHash,
            ...(bot === true && { bot: true }),
          })),
          game,
          endedAt,
        },
        events,
      ),
    );
  }

  /** Records the end, stores it and swaps the Turn deadline for the retention wake-up. */
  #end(game: GameState): void {
    const { seats, endedAt: current } = this.#readState();
    if (current !== null) return;
    const endedAt = this.now();
    this.#clock.cancel();
    this.#cancelBot?.();
    this.#cancelBot = null;
    this.#cancelBotRetention?.();
    this.#cancelBotRetention = null;
    try {
      this.#save(game, [], seats, endedAt);
    } catch (error) {
      // The final state is already stored; a restore finishes the Room (see `resume`).
      this.#log.error({ err: error }, "Room end not saved");
    }
    this.#log.info("Room ended");
    this.#onEnded(endedAt);
    this.#cancelDeletion = deleteAfterRetention(
      this.#store,
      this.#scheduler,
      this.#roomCode,
      endedAt,
      this.#onRetention,
    );
  }
}
