import { matchMaker, Room, ServerError, updateLobby, type Client } from "@colyseus/core";
import {
  createOptionsSchema,
  intentSchema,
  joinOptionsSchema,
  MESSAGE,
  type ClientIntent,
  type GameMessage,
  type LobbyListingMetadata,
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
import { silentLogger, type Logger } from "#observability/logger.ts";
import type { GameMetrics, RoomGauges } from "#observability/metrics.ts";
import { newPlayerId, newSeed } from "#room/ids.ts";
import { newPlayerName } from "#room/player-names.ts";
import {
  decodePassword,
  encodePassword,
  hashPassword,
  passwordMatches,
  type PasswordHash,
} from "#room/password.ts";
import { claimRoomCode, releaseRoomCode, reserveRoomCode } from "#room/room-code.ts";
import { checkRoomName } from "#room/room-name.ts";
import { systemScheduler, type Scheduler } from "#room/scheduler.ts";
import { deleteAfterRetention } from "#store/retention.ts";
import type { RoomStore, StoredRoom } from "#store/room-store.ts";

/** A taken Seat; `sessionId` is `null` while nobody is connected to it (e.g. after a restore). */
export type SeatRecord = LobbySeat & { sessionId: string | null };

/** `client.auth` of a Guest whose join `onAuth` admitted (the Room is not full, the password matched). */
type JoinAuth = { code: string };

/** A matchmaking refusal: the HTTP status Colyseus answers with, and the Rejection code as its message. */
const refuse = (status: number, code: RejectionCode) => new ServerError(status, code);

/** The password a client sent in its create or join options, if any. */
const passwordIn = (options: unknown): string =>
  typeof options === "object" &&
  options !== null &&
  "password" in options &&
  typeof options.password === "string"
    ? options.password
    : "";

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
 * control #37), `seatReconnected` (#35: log + metric when a held Seat is back).
 */
export class GameRoom extends Room<{ metadata: LobbyListingMetadata }> {
  settings!: RoomSettings;
  /**
   * The checked Room name; `null` when the creator left it empty (the client
   * shows a generated one). Not `roomName`: Colyseus uses that for the Room type.
   */
  displayName: string | null = null;
  /** Never sent or logged; `null` for a Room without a password. */
  password: PasswordHash | null = null;
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
  /** The server's metrics; `createGameServer` sets it. */
  metrics!: GameMetrics;
  /** The server's logger; `onCreate` narrows it to lines carrying this Room's `roomCode`. */
  log: Logger = silentLogger;
  /** Cancels the one pending wake-up (the Turn deadline, or deletion once the game ended). */
  #cancelWakeUp: (() => void) | null = null;
  /** Set when the process shuts down: Seats and the stored Room must then stay as they are. */
  #shuttingDown = false;

  /**
   * Runs before a Seat is reserved, for create and join alike (Colyseus gives
   * it no Room, so a join names its Room code in the options). A join is
   * refused here, holding no Seat, when the Lobby is full or the password is
   * wrong; options that are not join options are a create, checked in
   * `onCreate`, and `onJoin` still holds such a client to the password.
   * Rate limits (#37) go here too.
   */
  static override async onAuth(_token: string, options: unknown): Promise<JoinAuth | true> {
    const join = joinOptionsSchema.safeParse(options);
    if (!join.success) return true;
    const room = matchMaker.getLocalRoomById(join.data.code);
    if (!(room instanceof GameRoom) || room.game) throw refuse(404, "ROOM_NOT_FOUND");
    // Seats restored without a connection count too (they are no clients).
    if (room.hasReachedMaxClients() || room.seats.length >= room.settings.maxPlayers) {
      throw refuse(409, "ROOM_FULL");
    }
    if (!(await room.passwordMatches(join.data.password ?? ""))) {
      throw refuse(403, "WRONG_PASSWORD");
    }
    return { code: room.roomId };
  }

  override async onCreate(options: unknown): Promise<void> {
    const restored = restoreFrom(options);
    if (restored) {
      this.restore(restored);
    } else {
      const parsed = createOptionsSchema.safeParse(options);
      if (!parsed.success) throw refuse(400, "MALFORMED");
      const { roomName, password, maxPlayers, minuteLimit } = parsed.data;
      const name = checkRoomName(roomName ?? "");
      if (!name.ok) throw refuse(400, "ROOM_NAME_INVALID");
      this.settings = { maxPlayers, minuteLimit };
      this.displayName = name.name;
      this.password = password ? await hashPassword(password) : null;
      this.roomId = reserveRoomCode((code) => this.store.isCodeInUse(code));
    }
    this.maxClients = this.settings.maxPlayers;
    this.metadata = this.listing();
    this.log = this.log.child({ roomCode: this.roomId });
    this.metrics.trackRoom(this);
    if (restored) {
      this.log.info({ playing: this.game !== null, seats: this.seats.length }, "Room restored");
    } else {
      this.log.info({ ...this.settings, hasPassword: this.password !== null }, "Room created");
    }
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
    this.displayName = stored.roomName;
    this.password = stored.password && decodePassword(stored.password);
    this.seats = stored.seats.map(({ playerId, name }) => ({ playerId, name, sessionId: null }));
    this.game = stored.game;
    if (this.game) {
      // A running game lives on with nobody connected (its Turns time out),
      // until it ends; a deadline that passed while the server was down fires at once.
      this.autoDispose = false;
      this.unlist();
      this.scheduleDeadline(this.game);
    }
  }

  override async onJoin(client: Client, options: unknown, auth?: JoinAuth): Promise<void> {
    // The creator brings the password in its create options. Anyone else who
    // reached a Seat without `onAuth` admitting a join to this Room must too.
    if (auth?.code !== this.roomId && !(await this.passwordMatches(passwordIn(options)))) {
      throw refuse(403, "WRONG_PASSWORD");
    }
    if (this.seats.length >= this.settings.maxPlayers) {
      throw refuse(409, "ROOM_FULL");
    }
    const seat: SeatRecord = {
      playerId: newPlayerId(),
      name: newPlayerName(this.seats.map((s) => s.name)),
      sessionId: client.sessionId,
    };
    // Saved first: a Seat the store doesn't have isn't taken (the join fails).
    this.save([...this.seats, seat], this.game, []);
    this.seats.push(seat);
    this.log.info({ playerId: seat.playerId }, "Seat taken");
    client.send(MESSAGE.welcome, { playerId: seat.playerId } satisfies WelcomeMessage);
    this.broadcastLobby();
  }

  override onLeave(client: Client): void {
    // In a running game the Seat stays (its Turns time out); a Lobby frees it.
    // On shutdown nothing changes: the Room comes back as it was.
    if (this.#shuttingDown) return;
    const seat = this.seats.find((s) => s.sessionId === client.sessionId);
    if (this.game) {
      if (seat && this.endedAt === null) {
        this.metrics.seatDropped();
        this.log.info({ playerId: seat.playerId }, "Seat dropped");
      }
      return;
    }
    if (seat) this.log.info({ playerId: seat.playerId }, "Seat freed");
    this.seats = this.seats.filter((s) => s.sessionId !== client.sessionId);
    if (this.seats.length === 0) return; // emptied: deleted when the Room disposes, right after
    this.trySave();
    this.broadcastLobby();
  }

  /**
   * Colyseus locks a Room by itself (`lock(true)`) when its last Seat is
   * reserved, and the matchmaker then answers a join with a bare "not found"
   * before `onAuth` runs. A full Lobby stays unlocked so `onAuth` can answer
   * `ROOM_FULL`; `maxClients` still caps the Seats when one is reserved.
   * An explicit `lock()` (the game started) still locks.
   */
  override async lock(...internal: unknown[]): Promise<void> {
    if (internal.length > 0) return;
    await super.lock();
  }

  async passwordMatches(password: string): Promise<boolean> {
    return this.password === null || (await passwordMatches(this.password, password));
  }

  override onBeforeShutdown(): void {
    this.#shuttingDown = true;
    super.onBeforeShutdown();
  }

  override onDispose(): void {
    this.metrics.untrackRoom(this);
    this.log.info("Room closed");
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
    this.log.info("Room started");
    // The game outlives its connections: Seats are held until it ends.
    this.autoDispose = false;
    this.unlist();
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
    this.log.info("Room ended");
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

  /**
   * Takes a started Room off the Lobby list and closes it to joins. An
   * unlisted Room sends Lobby-list updates no more, so the removal is sent
   * first; the private flag is never used (spec).
   */
  private unlist(): void {
    updateLobby(this, true);
    void this.setMatchmaking({ unlisted: true });
    void this.lock();
  }

  private onIntent(client: Client, message: unknown): void {
    const seat = this.seats.find((s) => s.sessionId === client.sessionId);
    if (!seat) return;
    const started = performance.now();
    const parsed = intentSchema.safeParse(message);
    const intent = parsed.success ? parsed.data : null;
    let refused: RejectionCode | void = "MALFORMED";
    if (intent !== null) {
      refused = isRoomIntent(intent)
        ? ROOM_INTENTS[intent.type](this, seat, intent)
        : this.play(seat, intent);
    }
    const fields = { playerId: seat.playerId, intent: intent?.type };
    if (refused) {
      this.log.debug({ ...fields, code: refused }, "Rejection");
      this.reject(client, refused);
    } else {
      this.log.debug(fields, "intent accepted");
    }
    this.metrics.intentHandled(refused ?? null, (performance.now() - started) / 1000);
  }

  /**
   * A Player is back in their held Seat. #35 calls this when a reconnect (by
   * `reconnectionToken` or Guest token) lands.
   */
  seatReconnected(seat: SeatRecord): void {
    this.metrics.seatReconnected();
    this.log.info({ playerId: seat.playerId }, "Seat reconnected");
  }

  /** The Room's numbers for the `rooms`, `players_connected` and `seats_held_disconnected` gauges. */
  gauges(): RoomGauges {
    const live = new Set(this.clients.map((c) => c.sessionId));
    const connected = this.seats.filter(
      (s) => s.sessionId !== null && live.has(s.sessionId),
    ).length;
    const state = this.game === null ? "lobby" : this.endedAt === null ? "playing" : null;
    return { state, connected, held: state === null ? 0 : this.seats.length - connected };
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
    this.metrics.timeStoreWrite(() =>
      this.store.save(
        {
          code: this.roomId,
          settings: this.settings,
          roomName: this.displayName,
          password: this.password && encodePassword(this.password),
          seats: seats.map(({ playerId, name }) => ({ playerId, name })),
          game,
          endedAt: this.endedAt,
        },
        events,
      ),
    );
  }

  /** A Lobby change nobody can refuse (a Guest left): a failed write is caught up by the next one. */
  private trySave(): void {
    try {
      this.save(this.seats, this.game, []);
    } catch (error) {
      // The next successful save writes the current Seats.
      this.log.error({ err: error }, "Seats not saved");
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

  /** The Lobby-list entry: what any Guest may see, so never the password or its hash. */
  private listing(): LobbyListingMetadata {
    return {
      roomName: this.displayName,
      players: this.seats.length,
      maxPlayers: this.settings.maxPlayers,
      minuteLimit: this.settings.minuteLimit,
      hasPassword: this.password !== null,
    };
  }

  /** Sends the Seats to the Room, and the Players count to the Lobby list. */
  private broadcastLobby(): void {
    void this.setMetadata(this.listing());
    const lobby: LobbyMessage = {
      code: this.roomId,
      roomName: this.displayName,
      hasPassword: this.password !== null,
      settings: this.settings,
      seats: this.seats.map(({ playerId, name }) => ({ playerId, name })),
    };
    this.broadcast(MESSAGE.lobby, lobby);
  }

  private reject(client: Client, code: RejectionCode): void {
    this.metrics.rejected(code);
    client.send(MESSAGE.rejected, { code } satisfies RejectionMessage);
  }
}
