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
  CLOSE_CODE,
  createOptionsSchema,
  intentSchema,
  joinOptionsSchema,
  MESSAGE,
  refusalMessage,
  type ClientIntent,
  type GameMessage,
  type LobbyListingMetadata,
  type LobbyMessage,
  type Refusal,
  type RejectionCode,
  type RejectionMessage,
  type RoomIntent,
  type RoomSettings,
  type WelcomeMessage,
} from "@universum/protocol";
import {
  apply,
  publicView,
  setupGame,
  type GameEvent,
  type GameState,
  type PlayerId,
  type PlayerIntent,
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
import { guestTokenIn, hashGuestToken } from "#room/guest-token.ts";
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
import { GameDriver, type GameTiming, type SeatRecord } from "#room/game-driver.ts";
import type { RoomStore, StoredRoom } from "#store/room-store.ts";

export type { GameTiming, SeatRecord } from "#room/game-driver.ts";

/** How long a Lobby Seat is held for a Player who dropped (spec: Seat hold). */
export const LOBBY_SEAT_HOLD_MS = 60_000;

/**
 * A Seat held for its absent Player. `release` gives up the Colyseus
 * reconnection of a dropped client (Colyseus then calls `onLeave`); a Seat
 * restored without a connection has none. `until`: when a Lobby frees it;
 * `null` in a running game, which holds it until the game ends.
 */
type Hold = { release: (() => void) | null; until: number | null; cancel: () => void };

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
 * Extension points: `driver` (`GameDriver`: the one place a game state is
 * accepted — store, broadcast, deadline), `endGame` (#32), `onJoin`/`onLeave`
 * (Guest token and Seat hold #35), `ROOM_INTENTS` (Room-level intents),
 * `onIntent` (flood control #37), `seatReconnected` (#35: log + metric when a
 * held Seat is back).
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
  /** The creator's public Player id (the Lobby's crown), or `null` until they take a Seat. */
  creatorId: PlayerId | null = null;
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
  /** Shorter Turns and minutes for e2e runs; empty in production. */
  timing: GameTiming = {};
  /** The commit pipeline: the engine, the store, the broadcast and the one wake-up. */
  #driver: GameDriver | null = null;
  /** Set when the process shuts down: Seats and the stored Room must then stay as they are. */
  #shuttingDown = false;
  /** Seats held for absent Players, by public Player id (spec: Seat hold). */
  readonly #holds = new Map<PlayerId, Hold>();
  /** The server's abuse protection; `createGameServer` sets it. */
  guard!: AbuseGuard;
  /** Intent flood control, per connected client. */
  readonly #flood = new Map<string, FloodMeter>();

  /** The pipeline for this Room, wired to its Colyseus concerns once its fields are set. */
  private get driver(): GameDriver {
    return (this.#driver ??= new GameDriver({
      engine: this.engine,
      scheduler: this.scheduler,
      store: this.store,
      metrics: this.metrics,
      log: this.log,
      reporter: this.reporter,
      timing: this.timing,
      roomCode: this.roomId,
      room: () => ({
        settings: this.settings,
        roomName: this.displayName,
        creatorId: this.creatorId,
        password: this.password && encodePassword(this.password),
      }),
      publish: (state, message) => {
        this.game = state;
        this.broadcast(MESSAGE.game, message);
      },
      ended: (endedAt) => {
        this.endedAt = endedAt;
        this.releaseHolds();
      },
      retention: () => {
        void this.disconnect();
      },
    }));
  }

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
    if (!(room instanceof GameRoom)) throw refuse("ROOM_NOT_FOUND");
    // A Guest taking their own Seat back gets in, game started or not, with no
    // password asked (#35). Everyone else needs an open Lobby Seat.
    if (!room.seatOfToken(join.data.guestToken ?? null)) {
      if (room.game) throw refuse("ROOM_NOT_FOUND");
      // Seats, not clients: held and restored Seats have no client (maxClients leaves them room).
      if (room.seats.length >= room.settings.maxPlayers) throw refuse("ROOM_FULL");
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
    // Room for every Seat's client plus a Guest taking a held Seat back (a held
    // Seat counts as a client until it is released); `onAuth` and `onJoin` cap the Seats.
    this.maxClients = this.settings.maxPlayers * 2;
    this.seatReservationTimeout = this.guard.limits.seatReservationSeconds;
    if (!this.game) this.guard.lobbyOpened(this.roomId);
    this.metadata = this.listing();
    this.log = this.log.child({ roomCode: this.roomId });
    this.metrics.trackRoom(this);
    if (restored) {
      this.log.info({ playing: this.game !== null, seats: this.seats.length }, "Room restored");
      // A running game re-arms its deadline; one a crash left game-over (the
      // final save landed, `endedAt` did not) is finished now, so retention applies.
      if (this.game) this.driver.resume(this.game, this.seats, this.endedAt);
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
    this.creatorId = stored.creatorId;
    this.password = stored.password && decodePassword(stored.password);
    this.seats = stored.seats.map(({ playerId, name, tokenHash = null }) => ({
      playerId,
      name,
      sessionId: null,
      tokenHash,
    }));
    this.game = stored.game;
    // Nobody is connected yet: the Room waits for its Players instead of disposing.
    this.autoDispose = false;
    if (this.game) {
      // A running game lives on with nobody connected (its Turns time out),
      // until it ends; `resume` arms a deadline that passed while the server
      // was down, and it fires at once.
      this.unlist();
    } else {
      // A Lobby holds each Seat for its 60 s, as if its Player had just dropped.
      for (const seat of this.seats) this.hold(seat, null);
    }
  }

  override async onJoin(client: Client, options: unknown, auth?: SeatAuth): Promise<void> {
    if (auth) this.guard.release(auth.reservation);
    const token = guestTokenIn(options);
    const own = this.seatOfToken(token);
    if (own) return this.takeBack(own, client);
    // The creator brings the password in its create options. Anyone else who
    // reached a Seat without `onAuth` admitting a join to this Room must too.
    if (auth?.code !== this.roomId && !(await this.passwordMatches(passwordIn(options)))) {
      throw refuse("WRONG_PASSWORD");
    }
    if (auth?.creates && this.seats.length === 0) {
      this.guard.lobbyCreatedBy(this.roomId, auth.bucket);
    }
    if (this.game) throw refuse("ROOM_NOT_FOUND");
    if (this.seats.length >= this.settings.maxPlayers) {
      throw refuse("ROOM_FULL");
    }
    const seat: SeatRecord = {
      playerId: newPlayerId(),
      name: newPlayerName(this.seats.map((s) => s.name)),
      sessionId: client.sessionId,
      tokenHash: token && hashGuestToken(token),
    };
    if (auth?.creates && this.seats.length === 0) this.creatorId = seat.playerId;
    // Saved first: a Seat the store doesn't have isn't taken (the join fails).
    this.save([...this.seats, seat], this.game, []);
    this.seats.push(seat);
    this.log.info({ playerId: seat.playerId }, "Seat taken");
    client.send(MESSAGE.welcome, { playerId: seat.playerId } satisfies WelcomeMessage);
    this.broadcastLobby();
  }

  /**
   * The connection dropped without a goodbye: the Seat is held (spec: Seat
   * hold), in a running game until it ends, in a Lobby for 60 s. The Player
   * comes back by the reconnection token (`onReconnect`) or by Guest token
   * (`takeBack`); if neither happens, Colyseus calls `onLeave` once the hold
   * is released.
   */
  override onDrop(client: Client): void {
    if (this.#shuttingDown || this.endedAt !== null) return;
    const seat = this.seatOf(client);
    if (!seat) return; // its Seat was already taken back from another connection
    const reconnection = this.allowReconnection(client, "manual");
    // Rejected when the hold is released: that is how it ends, not an error.
    reconnection.catch(() => {});
    this.hold(seat, () => reconnection.reject());
    this.metrics.seatDropped();
    this.log.info({ playerId: seat.playerId }, "Seat dropped");
    if (!this.game) this.broadcastLobby();
  }

  /** Back by the reconnection token after a short drop: the same Seat, and the current state. */
  override onReconnect(client: Client): void {
    const seat = this.seatOf(client);
    if (!seat) return;
    this.unhold(seat.playerId);
    this.seatReconnected(seat);
    this.sendCurrent(client);
  }

  override onLeave(client: Client): void {
    this.#flood.delete(client.sessionId);
    // In a running game the Seat stays (its Turns time out); a Lobby frees it.
    // On shutdown nothing changes: the Room comes back as it was.
    if (this.#shuttingDown) return;
    const seat = this.seatOf(client);
    if (!seat) return; // taken back from another connection, or already freed
    if (this.game) {
      // Left a running game on purpose: the Seat stays (its Turns time out), as for a drop.
      // (After a drop, `onLeave` only runs once the game has ended or the Seat was taken back.)
      if (this.endedAt === null) {
        this.metrics.seatDropped();
        this.log.info({ playerId: seat.playerId }, "Seat dropped");
      }
      return;
    }
    this.freeSeat(seat.playerId);
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

  /** The Seat whose Guest token this is, if any. */
  seatOfToken(token: string | null): SeatRecord | undefined {
    if (token === null) return undefined;
    const tokenHash = hashGuestToken(token);
    return this.seats.find((s) => s.tokenHash === tokenHash);
  }

  private seatOf(client: Client): SeatRecord | undefined {
    return this.seats.find((s) => s.sessionId === client.sessionId);
  }

  /**
   * The Guest is back by Guest token (reload, new tab, server restart): the
   * new connection takes the Seat. A held reconnection is given up, and a
   * connection still open elsewhere is closed with `seatTaken`.
   */
  private takeBack(seat: SeatRecord, client: Client): void {
    const previous = seat.sessionId;
    seat.sessionId = client.sessionId;
    const held = this.#holds.get(seat.playerId);
    this.unhold(seat.playerId);
    held?.release?.();
    // Its `onDrop` and `onLeave` find no Seat any more, so they change nothing.
    this.clients.find((c) => c.sessionId === previous)?.leave(CLOSE_CODE.seatTaken);
    client.send(MESSAGE.welcome, { playerId: seat.playerId } satisfies WelcomeMessage);
    this.seatReconnected(seat);
    this.sendCurrent(client);
  }

  /** Brings a returning client up to date: the game view, or the Lobby (to everyone, as the Seat is no longer held). */
  private sendCurrent(client: Client): void {
    if (this.game) {
      const message: GameMessage = {
        view: publicView(this.game, this.timing),
        events: [],
        reveals: [],
        now: this.now(),
      };
      client.send(MESSAGE.game, message);
    } else {
      this.broadcastLobby();
    }
  }

  /**
   * Holds the Seat for its absent Player: a Lobby frees it 60 s from now, a
   * running game keeps it until the game ends. `release` gives up the dropped
   * client's reconnection; `null` for a Seat restored without a connection.
   */
  private hold(seat: SeatRecord, release: (() => void) | null): void {
    this.unhold(seat.playerId);
    if (this.game) {
      this.#holds.set(seat.playerId, { release, until: null, cancel: () => {} });
      return;
    }
    const until = this.now() + LOBBY_SEAT_HOLD_MS;
    const cancel = this.scheduler.at(until, () => this.expire(seat.playerId));
    this.#holds.set(seat.playerId, { release, until, cancel });
  }

  /** The Player is back: the Seat is no longer held (nothing is released). */
  private unhold(playerId: PlayerId): void {
    const hold = this.#holds.get(playerId);
    if (!hold) return;
    hold.cancel();
    this.#holds.delete(playerId);
    this.waitIfRestored();
  }

  /** A Lobby Seat's 60 s ran out: it is freed. */
  private expire(playerId: PlayerId): void {
    const hold = this.#holds.get(playerId);
    if (!hold) return;
    this.#holds.delete(playerId);
    // Colyseus then calls `onLeave`, which frees the Seat; a restored Seat has no client.
    if (hold.release) hold.release();
    else this.freeSeat(playerId);
    this.waitIfRestored();
  }

  /**
   * Gives up every hold: the game is over (or the Room is going away), so
   * nobody needs a Seat kept any more.
   */
  private releaseHolds(): void {
    for (const hold of this.#holds.values()) {
      hold.cancel();
      hold.release?.();
    }
    this.#holds.clear();
  }

  /**
   * A restored Room waits for its Players instead of disposing. Once no Lobby
   * Seat is left waiting for a Player who never reconnected after the restart,
   * the Lobby disposes as usual when it is empty (and is then deleted).
   */
  private waitIfRestored(): void {
    if (this.game || this.autoDispose) return;
    if ([...this.#holds.values()].some((h) => h.release === null)) return;
    this.autoDispose = true;
  }

  /** Frees a Lobby Seat: the others see it open; an emptied Lobby is deleted when it disposes. */
  private freeSeat(playerId: PlayerId): void {
    this.log.info({ playerId }, "Seat freed");
    this.unhold(playerId);
    this.seats = this.seats.filter((s) => s.playerId !== playerId);
    if (this.seats.length === 0) return; // emptied: deleted when the Room disposes, right after
    this.trySave();
    this.broadcastLobby();
  }

  override onBeforeShutdown(): void {
    this.#shuttingDown = true;
    super.onBeforeShutdown();
  }

  override onDispose(): void {
    this.guard.lobbyClosed(this.roomId);
    this.metrics.untrackRoom(this);
    this.log.info("Room closed");
    this.#driver?.dispose();
    // Colyseus gives up the held reconnections itself; only the 60 s wake-ups are left.
    for (const hold of this.#holds.values()) hold.cancel();
    this.#holds.clear();
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
      seed: this.timing.seed ?? newSeed(),
      now: this.now(),
      turnLimitMs: this.timing.turnLimitMs,
      minuteMs: this.timing.minuteMs,
    });
    const outcome = this.driver.start(game, this.seats);
    if ("rejected" in outcome) return outcome.rejected;
    this.log.info("Room started");
    // The game outlives its connections: Seats are held until it ends.
    this.autoDispose = false;
    this.unlist();
    for (const [playerId, hold] of this.#holds) {
      hold.cancel();
      this.#holds.set(playerId, { ...hold, until: null, cancel: () => {} });
    }
  }

  /**
   * The game is over (`commit` calls this when the game-over phase arrives,
   * and a restore finishes a game-over state a crash left unfinished): the
   * driver records when, swaps the Turn deadline for the retention wake-up
   * and tells this Room to release its Seats (spec: Retention, Seat hold).
   */
  endGame(): void {
    this.driver.endGame();
  }

  /**
   * Takes a started Room off the Lobby list. An unlisted Room sends Lobby-list
   * updates no more, so the removal is sent first; the private flag is never
   * used (spec). The Room is not locked: Colyseus would then refuse a Guest
   * taking their Seat back before `onAuth`, which refuses everyone else.
   */
  private unlist(): void {
    this.guard.lobbyClosed(this.roomId);
    updateLobby(this, true);
    void this.setMatchmaking({ unlisted: true });
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

  /**
   * The Room's numbers for the `rooms`, `players_connected` and
   * `seats_held_disconnected` gauges. Held: every Seat with no live client
   * (dropped and held, or restored and not yet taken back), until the game ends.
   */
  gauges(): RoomGauges {
    const live = new Set(this.clients.map((c) => c.sessionId));
    const connected = this.seats.filter(
      (s) => s.sessionId !== null && live.has(s.sessionId),
    ).length;
    const state = this.game === null ? "lobby" : this.endedAt === null ? "playing" : null;
    return { state, connected, held: state === null ? 0 : this.seats.length - connected };
  }

  /**
   * Logs a bug outside the engine's own call and reports it, with the Room
   * code, the game's `version` and `phase`, and the intent type: never the
   * snapshot or payload. (The driver reports its own engine and store errors.)
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

  /** Runs a Player intent through the commit pipeline. */
  private play(seat: SeatRecord, intent: PlayerIntent): RejectionCode | void {
    if (!this.game) return "NOT_OFFERED";
    const outcome = this.driver.submit(this.game, intent, seat.playerId, this.seats, this.endedAt);
    return "rejected" in outcome ? outcome.rejected : undefined;
  }

  /** Writes the Room's snapshot (and an intent's events) to the store; throws if the write fails. */
  private save(seats: SeatRecord[], game: GameState | null, events: GameEvent[]): void {
    this.metrics.timeStoreWrite(() =>
      this.store.save(
        {
          code: this.roomId,
          settings: this.settings,
          roomName: this.displayName,
          creatorId: this.creatorId,
          password: this.password && encodePassword(this.password),
          seats: seats.map(({ playerId, name, tokenHash }) => ({ playerId, name, tokenHash })),
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
      creatorId: this.creatorId,
      hasPassword: this.password !== null,
      settings: this.settings,
      // Public Player ids and names only: never a session id or token hash.
      seats: this.seats.map(({ playerId, name }) => {
        const heldUntil = this.#holds.get(playerId)?.until;
        return typeof heldUntil === "number" ? { playerId, name, heldUntil } : { playerId, name };
      }),
      now: this.now(),
    };
    this.broadcast(MESSAGE.lobby, lobby);
  }

  private reject(client: Client, code: RejectionCode): void {
    this.metrics.rejected(code);
    client.send(MESSAGE.rejected, { code } satisfies RejectionMessage);
  }
}
