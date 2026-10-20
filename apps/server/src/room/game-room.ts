import {
  CloseCode,
  matchMaker,
  Room,
  ServerError,
  updateLobby,
  type AuthContext,
  type Client,
} from "@colyseus/core";
import {
  createOptionsSchema,
  intentSchema,
  joinOptionsSchema,
  MESSAGE,
  refusalMessage,
  type ClientIntent,
  type GameMessage,
  type LobbyListingMetadata,
  type LobbyMessage,
  type LobbySeat,
  type Refusal,
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
  type Actor,
  type Applied,
  type GameEvent,
  type GameState,
  type Intent,
  type PlayerIntent,
  type Rejection,
} from "@universum/rules";
import { FloodMeter } from "#abuse/flood.ts";
import { REQUEST_ID_HEADER, type AbuseGuard } from "#abuse/guard.ts";
import { ipBucket } from "#abuse/ip.ts";
import {
  noReporter,
  type ErrorContext,
  type ErrorReporter,
} from "#observability/error-reporting.ts";
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

/**
 * `client.auth` of a Guest `onAuth` admitted: the IP bucket and Seat
 * reservation it is counted under, whether it creates the Room, and for a
 * join the Room code (the Room is not full, the password matched).
 */
type SeatAuth = { bucket: string; reservation: string; creates: boolean; code?: string };

/** The IP bucket `onAuth` admitted a client under (see `SeatAuth`), for the refusal log's IP tag. */
function bucketOf(client: Client): string {
  const auth: unknown = client.auth;
  return typeof auth === "object" &&
    auth !== null &&
    "bucket" in auth &&
    typeof auth.bucket === "string"
    ? auth.bucket
    : "unknown";
}

/** This many engine throws in a row in one Room are logged at `fatal` (spec: Engine throws). */
const ENGINE_THROWS_FATAL = 3;
/** A Turn deadline the engine or the store failed on is tried again after this, doubling each time… */
const DEADLINE_RETRY_MS = 5_000;
/** …up to this. */
const DEADLINE_RETRY_MAX_MS = 60_000;

/** The HTTP status Colyseus answers a refused create or join with. */
const STATUS: Partial<Record<RejectionCode, number>> = {
  MALFORMED: 400,
  ROOM_NAME_INVALID: 400,
  ROOM_NAME_BLOCKED: 400,
  WRONG_PASSWORD: 403,
  ROOM_NOT_FOUND: 404,
  ROOM_FULL: 409,
  PASSWORD_LOCKED: 429,
  RATE_LIMITED: 429,
  SERVER_BUSY: 503,
};

/** A matchmaking refusal: an HTTP status, and the Refusal (code, maybe a wait) as its message. */
const refuse = (refusal: Refusal | RejectionCode) => {
  const r = typeof refusal === "string" ? { code: refusal } : refusal;
  return new ServerError(STATUS[r.code] ?? 500, refusalMessage(r));
};

/** The matchmaking method (`create`, `joinById`, …) of the request `onAuth` runs for, if known. */
function matchmakeMethod(context: AuthContext): string | null {
  const req: unknown = context.req;
  if (typeof req !== "object" || req === null || !("url" in req)) return null;
  return typeof req.url === "string" ? (/\/matchmake\/(\w+)\//.exec(req.url)?.[1] ?? null) : null;
}

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
  /** Where errors are reported; `createGameServer` sets it. */
  reporter: ErrorReporter = noReporter;
  /** The rules engine's `apply`; `createGameServer` sets it (tests pass one that throws). */
  engine: typeof apply = apply;
  /** Engine throws in a row in this Room; the third is logged at `fatal` (spec: Engine throws). */
  #throwsInARow = 0;
  /** Failed tries of the current Turn deadline, for the retry back-off. */
  #deadlineRetries = 0;
  /** Cancels the one pending wake-up (the Turn deadline, or deletion once the game ended). */
  #cancelWakeUp: (() => void) | null = null;
  /** Set when the process shuts down: Seats and the stored Room must then stay as they are. */
  #shuttingDown = false;
  /** The server's abuse protection; `createGameServer` sets it. */
  guard!: AbuseGuard;
  /** Intent flood control, per connected client. */
  readonly #flood = new Map<string, FloodMeter>();

  /**
   * Static `onAuth` (bound to the server's guard by `createGameServer`): runs
   * before a Seat is reserved, for create and join alike. Colyseus gives it no
   * Room, so a join names its Room code in the options. Refusals here hold no
   * Seat: the live-Lobby cap and open Lobbies per IP (create), outstanding
   * Seat reservations per IP, an unknown or full Lobby, and the password,
   * throttled before scrypt runs. The request rates are checked earlier, in
   * the HTTP gate. Create options are checked in `onCreate`.
   */
  static async authorize(
    guard: AbuseGuard,
    options: unknown,
    context: AuthContext,
  ): Promise<SeatAuth> {
    const bucket = ipBucket(context.ip);
    const request = context.headers.get(REQUEST_ID_HEADER) ?? undefined;
    const method = matchmakeMethod(context);
    const join = joinOptionsSchema.safeParse(options);
    const creates = method === null ? !join.success : method === "create";
    if (creates) {
      const refusal = guard.creationRefusal(bucket) ?? guard.reservationRefusal(bucket);
      if (refusal) throw refuse(refusal);
      return { bucket, creates, reservation: guard.reserve(bucket, "create", request) };
    }
    if (!join.success || (method !== null && method !== "joinById")) throw refuse("MALFORMED");
    const reservations = guard.reservationRefusal(bucket);
    if (reservations) throw refuse(reservations);
    const room = matchMaker.getLocalRoomById(join.data.code);
    if (!(room instanceof GameRoom) || room.game) throw refuse("ROOM_NOT_FOUND");
    // Seats restored without a connection count too (they are no clients).
    if (room.hasReachedMaxClients() || room.seats.length >= room.settings.maxPlayers) {
      throw refuse("ROOM_FULL");
    }
    if (room.password !== null) {
      const password = join.data.password ?? "";
      // No password yet: the client asks for one. Not a guess, so not counted.
      if (password === "") throw refuse("WRONG_PASSWORD");
      const locked = await guard.passwordAttempt(room.roomId, bucket);
      if (locked) throw refuse(locked);
      if (!(await room.passwordMatches(password))) {
        await guard.passwordFailed(room.roomId, bucket);
        throw refuse("WRONG_PASSWORD");
      }
      await guard.passwordMatched(room.roomId, bucket);
    }
    return {
      bucket,
      creates,
      reservation: guard.reserve(bucket, "join", request),
      code: room.roomId,
    };
  }

  override async onCreate(options: unknown): Promise<void> {
    const restored = restoreFrom(options);
    if (restored) {
      this.restore(restored);
    } else {
      const parsed = createOptionsSchema.safeParse(options);
      if (!parsed.success) throw refuse("MALFORMED");
      const { roomName, password, maxPlayers, minuteLimit } = parsed.data;
      const name = checkRoomName(roomName ?? "");
      if (!name.ok) throw refuse(name.code);
      this.settings = { maxPlayers, minuteLimit };
      this.displayName = name.name;
      this.password = password ? await hashPassword(password) : null;
      this.roomId = reserveRoomCode((code) => this.store.isCodeInUse(code));
    }
    this.maxClients = this.settings.maxPlayers;
    this.seatReservationTimeout = this.guard.limits.seatReservationSeconds;
    if (!this.game) this.guard.lobbyOpened(this.roomId);
    this.metadata = this.listing();
    this.log = this.log.child({ roomCode: this.roomId });
    this.metrics.trackRoom(this);
    if (restored) {
      this.log.info({ playing: this.game !== null, seats: this.seats.length }, "Room restored");
    } else {
      this.log.info({ ...this.settings, hasPassword: this.password !== null }, "Room created");
    }
    this.onMessage(MESSAGE.intent, (client: Client, message: unknown) => {
      if (this.admit(client)) this.onIntent(client, message);
    });
    // Any other message type: refuse it, but keep the connection (spec: MALFORMED).
    this.onMessage("*", (client: Client) => {
      if (this.admit(client)) this.reject(client, "MALFORMED");
    });
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

  override async onJoin(client: Client, options: unknown, auth?: SeatAuth): Promise<void> {
    if (auth) this.guard.release(auth.reservation);
    // The creator brings the password in its create options. Anyone else who
    // reached a Seat without `onAuth` admitting a join to this Room must too.
    if (auth?.code !== this.roomId && !(await this.passwordMatches(passwordIn(options)))) {
      throw refuse("WRONG_PASSWORD");
    }
    if (auth?.creates && this.seats.length === 0) {
      this.guard.lobbyCreatedBy(this.roomId, auth.bucket);
    }
    if (this.seats.length >= this.settings.maxPlayers) {
      throw refuse("ROOM_FULL");
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
    this.#flood.delete(client.sessionId);
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
    this.guard.lobbyClosed(this.roomId);
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
    this.guard.lobbyClosed(this.roomId);
    updateLobby(this, true);
    void this.setMatchmaking({ unlisted: true });
    void this.lock();
  }

  /**
   * Intent flood control: whether to handle this client's message. Extras over
   * the per-second limit are dropped, the first with `SLOW_DOWN`; a sustained
   * or heavy flood closes the socket, as a drop (never a consented leave), so
   * the Seat stays held.
   */
  private admit(client: Client): boolean {
    let meter = this.#flood.get(client.sessionId);
    if (!meter) {
      meter = new FloodMeter(this.guard.limits);
      this.#flood.set(client.sessionId, meter);
    }
    const verdict = meter.record(performance.now());
    if (verdict === "warn" || verdict === "close") {
      this.guard.refused("intent_flood", bucketOf(client), null);
    }
    if (verdict === "warn") this.reject(client, "SLOW_DOWN");
    if (verdict === "close") client.leave(CloseCode.WITH_ERROR);
    return verdict === "accept";
  }

  private onIntent(client: Client, message: unknown): void {
    const seat = this.seats.find((s) => s.sessionId === client.sessionId);
    if (!seat) return;
    const started = performance.now();
    const parsed = intentSchema.safeParse(message);
    const intent = parsed.success ? parsed.data : null;
    let refused: RejectionCode | void = "MALFORMED";
    if (intent !== null) {
      try {
        refused = isRoomIntent(intent)
          ? ROOM_INTENTS[intent.type](this, seat, intent)
          : this.play(seat, intent);
      } catch (error) {
        // A bug outside the engine's own call (say, in game setup): same as an engine throw.
        this.failed(error, "Intent failed", intent.type);
        refused = "INTERNAL";
      }
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
    const result = this.run(this.game, intent, seat.playerId);
    if (result === null) return "INTERNAL";
    if (isRejection(result)) return result.code;
    return this.commit(result.state, result.events, intent.type);
  }

  /**
   * Runs the rules engine. A throw (an engine bug) is logged and reported,
   * and gives `null`: the Room keeps its last good state (spec: Engine throws).
   */
  private run(game: GameState, intent: Intent, actor: Actor): Applied | Rejection | null {
    try {
      const result = this.engine(game, intent, { actor, now: this.now() });
      this.#throwsInARow = 0;
      return result;
    } catch (error) {
      this.#throwsInARow += 1;
      this.failed(error, "Engine threw", intent.type);
      if (this.#throwsInARow === ENGINE_THROWS_FATAL) {
        this.log.fatal({ throwsInARow: this.#throwsInARow }, "Engine keeps throwing");
      }
      return null;
    }
  }

  /**
   * Logs an error at `error` and reports it, with the Room code, the game's
   * `version` and `phase`, and the intent type: never the snapshot or payload.
   */
  private failed(error: unknown, message: string, intent: string): void {
    const context: ErrorContext = { intent };
    if (this.game) {
      context.version = this.game.version;
      context.phase = this.game.phase.kind;
    }
    this.log.error({ err: error, ...context }, message);
    this.reporter.report(error, { roomCode: this.roomId, ...context });
  }

  /**
   * Accepts a new game state, in this order: store it with its events, push
   * the view and events to everyone, and wake up at its Turn deadline. A
   * failed write changes nothing and tells no one (the sender gets INTERNAL).
   */
  private commit(state: GameState, events: GameEvent[], intent = "Start"): RejectionCode | void {
    try {
      this.save(this.seats, state, events);
    } catch (error) {
      // The Room keeps its last good state.
      this.failed(error, "Room not saved", intent);
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
    this.#deadlineRetries = 0;
    const { turn } = state;
    this.#cancelWakeUp = this.scheduler.at(state.turnDeadline, () => this.timeOut(turn));
  }

  /**
   * The deadline of Turn `turn` has passed: the engine applies the Timeout
   * outcome. A stale wake-up (the Turn moved on) is rejected and ignored. If
   * the engine throws or the write fails, the Room keeps its state and tries
   * again a little later, so Turn deadlines keep it moving (spec: Engine throws).
   */
  private timeOut(turn: number): void {
    if (!this.game || this.endedAt !== null) return;
    const result = this.run(this.game, { type: "TurnTimedOut", turn }, SYSTEM);
    if (result !== null && isRejection(result)) return;
    if (result !== null && this.commit(result.state, result.events, "TurnTimedOut") === undefined) {
      return;
    }
    const delay = Math.min(DEADLINE_RETRY_MS * 2 ** this.#deadlineRetries, DEADLINE_RETRY_MAX_MS);
    this.#deadlineRetries += 1;
    this.#cancelWakeUp?.();
    this.#cancelWakeUp = this.scheduler.at(this.now() + delay, () => this.timeOut(turn));
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
