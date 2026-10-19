import { Room, ServerError, type Client } from "@colyseus/core";
import {
  createOptionsSchema,
  intentSchema,
  MESSAGE,
  type ClientIntent,
  type GameMessage,
  type LobbyMessage,
  type LobbySeat,
  type RejectionCode,
  type RejectionMessage,
  type RoomIntent,
  type RoomSettings,
  type WelcomeMessage,
} from "@universum/protocol";
import {
  apply,
  isRejection,
  publicView,
  setupGame,
  SYSTEM,
  type GameEvent,
  type GameState,
  type PlayerIntent,
} from "@universum/rules";
import { newPlayerId, newSeed } from "#room/ids.ts";
import { newPlayerName } from "#room/player-names.ts";
import { claimRoomCode, releaseRoomCode, reserveRoomCode } from "#room/room-code.ts";
import { systemScheduler, type Scheduler } from "#room/scheduler.ts";
import { deleteAfterRetention } from "#store/retention.ts";
import type { RoomStore, StoredRoom } from "#store/room-store.ts";

/** A taken Seat; `sessionId` is `null` while nobody is connected to it (e.g. after a restore). */
export type SeatRecord = LobbySeat & { sessionId: string | null };

type RoomIntentHandler<K extends RoomIntent["type"]> = (
  room: GameRoom,
  seat: SeatRecord,
  intent: Extract<RoomIntent, { type: K }>,
) => RejectionCode | void;

/**
 * Intents the Room handles itself, outside the rules engine (Start; later
 * Lobby actions). Every other intent goes to the rules engine.
 */
const ROOM_INTENTS: { [K in RoomIntent["type"]]: RoomIntentHandler<K> } = {
  Start: (room) => room.startGame(),
};

const isRoomIntent = (intent: ClientIntent): intent is RoomIntent => intent.type in ROOM_INTENTS;

/**
 * Create options that rebuild a Room from the store on boot. A class
 * instance, so no client's JSON create options can ever pose as one.
 */
export class RestoreRoom {
  readonly stored: StoredRoom;
  constructor(stored: StoredRoom) {
    this.stored = stored;
  }
}

/** Server-side create options for a restore: `matchMaker.createRoom(GAME_ROOM, restoreOptions(room))`. */
export const restoreOptions = (stored: StoredRoom) => ({ restore: new RestoreRoom(stored) });

function restoreFrom(options: unknown): StoredRoom | null {
  if (typeof options !== "object" || options === null || !("restore" in options)) return null;
  return options.restore instanceof RestoreRoom ? options.restore.stored : null;
}

/**
 * One game Room (ADR-0002). No Schema state: the Room sends its own messages,
 * the full public view plus each intent's events to everyone, and Rejections
 * to the sender only. While it is a Lobby it sends the Seats instead.
 *
 * Every change is written to the `RoomStore` before anyone hears of it, and a
 * Room is rebuilt from its stored snapshot on boot (spec: Restore on boot).
 *
 * Extension points: `commit` (the one place a game state is accepted: store,
 * broadcast, deadline), `endGame` (#32), `onJoin`/`onLeave` (Guest token and
 * Seat hold #35), `ROOM_INTENTS` (Room-level intents), `onIntent` (flood
 * control #37).
 */
export class GameRoom extends Room {
  settings!: RoomSettings;
  /** Taken Seats in join order (R6). */
  seats: SeatRecord[] = [];
  /** The running game, or `null` while the Room is a Lobby. */
  game: GameState | null = null;
  /** When the game ended (epoch ms), or `null`. */
  endedAt: number | null = null;
  /** The clock and wake-ups; `createGameServer` swaps in the real one or a test one. */
  scheduler: Scheduler = systemScheduler;
  /** Where the Room is saved; `createGameServer` sets it. */
  store!: RoomStore;
  /** Cancels the one pending wake-up (the Turn deadline, or deletion once the game ended). */
  #cancelWakeUp: (() => void) | null = null;
  /** Set when the process shuts down: Seats and the stored Room must then stay as they are. */
  #shuttingDown = false;

  override onCreate(options: unknown): void {
    const restored = restoreFrom(options);
    if (restored) {
      this.restore(restored);
    } else {
      const parsed = createOptionsSchema.safeParse(options);
      if (!parsed.success) throw new ServerError(400, "MALFORMED" satisfies RejectionCode);
      this.settings = parsed.data;
      this.roomId = reserveRoomCode((code) => this.store.isCodeInUse(code));
    }
    this.maxClients = this.settings.maxPlayers;
    this.onMessage(MESSAGE.intent, (client: Client, message: unknown) =>
      this.onIntent(client, message),
    );
    // Any other message type: refuse it, but keep the connection (spec: MALFORMED).
    this.onMessage("*", (client: Client) => this.reject(client, "MALFORMED"));
  }

  /** Rebuilds the Room from its stored snapshot (the game already migrated). */
  private restore(stored: StoredRoom): void {
    this.roomId = stored.code;
    claimRoomCode(stored.code);
    this.settings = stored.settings;
    this.seats = stored.seats.map(({ playerId, name }) => ({ playerId, name, sessionId: null }));
    this.game = stored.game;
    if (this.game) {
      // A running game lives on with nobody connected (its Turns time out),
      // until it ends; a deadline that passed while the server was down fires at once.
      this.autoDispose = false;
      void this.lock();
      this.scheduleDeadline(this.game);
    }
  }

  override onJoin(client: Client): void {
    if (this.seats.length >= this.settings.maxPlayers) {
      throw new ServerError(409, "NOT_OFFERED" satisfies RejectionCode);
    }
    const seat: SeatRecord = {
      playerId: newPlayerId(),
      name: newPlayerName(this.seats.map((s) => s.name)),
      sessionId: client.sessionId,
    };
    // Saved first: a Seat the store doesn't have isn't taken (the join fails).
    this.save([...this.seats, seat], this.game, []);
    this.seats.push(seat);
    client.send(MESSAGE.welcome, { playerId: seat.playerId } satisfies WelcomeMessage);
    this.broadcastLobby();
  }

  override onLeave(client: Client): void {
    // In a running game the Seat stays (its Turns time out); a Lobby frees it.
    // On shutdown nothing changes: the Room comes back as it was.
    if (this.game || this.#shuttingDown) return;
    this.seats = this.seats.filter((s) => s.sessionId !== client.sessionId);
    if (this.seats.length === 0) return; // emptied: deleted when the Room disposes, right after
    this.trySave();
    this.broadcastLobby();
  }

  override onBeforeShutdown(): void {
    this.#shuttingDown = true;
    super.onBeforeShutdown();
  }

  override onDispose(): void {
    this.#cancelWakeUp?.();
    releaseRoomCode(this.roomId);
    // A Lobby that nobody is in any more (the last Guest left, or nobody came
    // back to a restored one) is deleted right away (spec: Retention).
    if (!this.#shuttingDown && !this.game) this.store.delete(this.roomId);
  }

  /** The server's clock for the rules engine. */
  now(): number {
    return this.scheduler.now();
  }

  /** Start (R5): any Player, once every Seat is taken. */
  startGame(): RejectionCode | void {
    if (this.game || this.seats.length < this.settings.maxPlayers) return "NOT_OFFERED";
    const game = setupGame({
      seats: this.seats.map(({ playerId, name }) => ({ playerId, name })),
      settings: this.settings,
      seed: newSeed(),
      now: this.now(),
    });
    const refused = this.commit(game, []);
    if (refused) return refused;
    // The game outlives its connections: Seats are held until it ends.
    this.autoDispose = false;
    void this.lock();
  }

  /**
   * The game is over (#32 calls this when the game-over phase arrives): the
   * Room records when, stops waking up for Turns, and is deleted with its
   * events 24 h later (spec: Retention).
   */
  endGame(): void {
    if (!this.game || this.endedAt !== null) return;
    this.endedAt = this.now();
    this.save(this.seats, this.game, []);
    this.#cancelWakeUp?.();
    this.#cancelWakeUp = deleteAfterRetention(
      this.store,
      this.scheduler,
      this.roomId,
      this.endedAt,
      () => {
        void this.disconnect();
      },
    );
  }

  private onIntent(client: Client, message: unknown): void {
    const seat = this.seats.find((s) => s.sessionId === client.sessionId);
    if (!seat) return;
    const parsed = intentSchema.safeParse(message);
    if (!parsed.success) return this.reject(client, "MALFORMED");
    const intent = parsed.data;
    const refused = isRoomIntent(intent)
      ? ROOM_INTENTS[intent.type](this, seat, intent)
      : this.play(seat, intent);
    if (refused) this.reject(client, refused);
  }

  /** Runs a Player intent through the rules engine. */
  private play(seat: SeatRecord, intent: PlayerIntent): RejectionCode | void {
    if (!this.game) return "NOT_OFFERED";
    let result;
    try {
      result = apply(this.game, intent, { actor: seat.playerId, now: this.now() });
    } catch {
      // The Room keeps its last good state (logging and reporting: #44).
      return "INTERNAL";
    }
    if (isRejection(result)) return result.code;
    return this.commit(result.state, result.events);
  }

  /**
   * Accepts a new game state, in this order: store it with its events, push
   * the view and events to everyone, and wake up at its Turn deadline. A
   * failed write changes nothing and tells no one (the sender gets INTERNAL).
   */
  private commit(state: GameState, events: GameEvent[]): RejectionCode | void {
    try {
      this.save(this.seats, state, events);
    } catch {
      // The Room keeps its last good state (logging and reporting: #44).
      return "INTERNAL";
    }
    this.game = state;
    const message: GameMessage = { view: publicView(state), events, now: this.now() };
    this.broadcast(MESSAGE.game, message);
    this.scheduleDeadline(state);
  }

  /** Writes the Room's snapshot (and an intent's events) to the store; throws if the write fails. */
  private save(seats: SeatRecord[], game: GameState | null, events: GameEvent[]): void {
    this.store.save(
      {
        code: this.roomId,
        settings: this.settings,
        seats: seats.map(({ playerId, name }) => ({ playerId, name })),
        game,
        endedAt: this.endedAt,
      },
      events,
    );
  }

  /** A Lobby change nobody can refuse (a Guest left): a failed write is caught up by the next one. */
  private trySave(): void {
    try {
      this.save(this.seats, this.game, []);
    } catch {
      // Logging: #43. The next successful save writes the current Seats.
    }
  }

  /** Keeps one wake-up per Room, for the current `turnDeadline`. */
  private scheduleDeadline(state: GameState): void {
    this.#cancelWakeUp?.();
    const { turn } = state;
    this.#cancelWakeUp = this.scheduler.at(state.turnDeadline, () => this.timeOut(turn));
  }

  /**
   * The deadline of Turn `turn` has passed: the engine applies the Timeout
   * outcome. A stale wake-up (the Turn moved on) is rejected and ignored.
   */
  private timeOut(turn: number): void {
    if (!this.game || this.endedAt !== null) return;
    let result;
    try {
      result = apply(this.game, { type: "TurnTimedOut", turn }, { actor: SYSTEM, now: this.now() });
    } catch {
      // The Room keeps its last good state (logging and reporting: #44).
      return;
    }
    // A failed write leaves the Turn as it was (retry and reporting: #44).
    if (!isRejection(result)) this.commit(result.state, result.events);
  }

  private broadcastLobby(): void {
    const lobby: LobbyMessage = {
      code: this.roomId,
      settings: this.settings,
      seats: this.seats.map(({ playerId, name }) => ({ playerId, name })),
    };
    this.broadcast(MESSAGE.lobby, lobby);
  }

  private reject(client: Client, code: RejectionCode): void {
    client.send(MESSAGE.rejected, { code } satisfies RejectionMessage);
  }
}
