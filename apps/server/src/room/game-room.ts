import {
  CloseCode,
  matchMaker,
  Room,
  ServerError,
  updateLobby,
  type AuthContext,
  type Client,
  type Deferred,
} from "@colyseus/core";
import {
  CLOSE_CODE,
  chatSchema,
  createOptionsSchema,
  DEFAULT_SETTINGS,
  intentSchema,
  joinOptionsSchema,
  MESSAGE,
  refusalMessage,
  type ChatEvent,
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
  type GameState,
  type PlayerId,
  type PlayerIntent,
} from "@universum/rules";
import { FloodMeter } from "#abuse/flood.ts";
import { REQUEST_ID_HEADER, type AbuseGuard } from "#abuse/guard.ts";
import { ipBucket } from "#abuse/ip.ts";
import { noReporter, type ErrorReporter } from "#observability/error-reporting.ts";
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
import {
  castVote,
  rematchRetryDelay,
  seatsAfterRematch,
  shouldReturn,
  votersOf,
  windowExpired,
  windowExpiresAt,
  withdrawVote,
  type RematchTrigger,
  type RematchVote,
} from "#room/rematch.ts";
import { checkRoomName } from "#room/room-name.ts";
import { GameDriver, type GameTiming, type SeatRecord } from "#room/game-driver.ts";
import { systemScheduler, type Scheduler } from "#room/scheduler.ts";
import type { RoomStore, StoredRoom } from "#store/room-store.ts";

export type { GameTiming, SeatRecord } from "#room/game-driver.ts";

/** How long a Lobby Seat is held for a Player who dropped (spec: Seat hold). */
export const LOBBY_SEAT_HOLD_MS = 60_000;

/**
 * A Seat held for its absent Player. `release` gives up the Colyseus
 * reconnection of a dropped client (Colyseus then calls `onLeave`); a Seat
 * restored without a connection, or whose client dropped before it finished
 * joining, has none. `until`: when a Lobby frees it; `null` in a running game,
 * which holds it until the game ends.
 */
type Hold = { release: (() => void) | null; until: number | null; cancel: () => void };

/**
 * The one wake-up a first rematch vote armed (spec #175, decision 2). The
 * object itself is the handle a late fire is compared against: a wake-up for a
 * window that was cancelled or replaced returns nothing.
 */
type RematchWindow = { cancel: () => void };

/**
 * What `allowReconnection` hands back: a `Deferred`, whose `reject` gives the
 * hold up — except for a client that never finished its join handshake (or a
 * Room already disposing), where Colyseus answers with a plain rejected
 * promise and there is no reconnection to give up.
 */
type PendingReconnection = Omit<Deferred<Client>, "reject"> & {
  reject?: Deferred<Client>["reject"];
};

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
 * Intents the Room handles itself, outside the rules engine (Start, the
 * Lobby's Bots, the Podium's rematch votes). Every other intent goes to the
 * rules engine.
 */
const ROOM_INTENTS: { [K in RoomIntent["type"]]: RoomIntentHandler<K> } = {
  Start: (room) => room.startGame(),
  AddBot: (room) => room.addBot(),
  RemoveBot: (room, _seat, intent) => room.removeBot(intent.playerId),
  Rematch: (room, seat) => room.rematch(seat),
  WithdrawRematch: (room, seat) => room.withdrawRematch(seat),
};

const isRoomIntent = (intent: ClientIntent): intent is RoomIntent => intent.type in ROOM_INTENTS;

/**
 * Runs one Room intent through its handler. The switch is exhaustive, so a
 * new Room intent fails typecheck until its handler is registered above.
 */
function dispatchRoomIntent(
  room: GameRoom,
  seat: SeatRecord,
  intent: RoomIntent,
): RejectionCode | void {
  switch (intent.type) {
    case "Start":
      return ROOM_INTENTS.Start(room, seat, intent);
    case "AddBot":
      return ROOM_INTENTS.AddBot(room, seat, intent);
    case "RemoveBot":
      return ROOM_INTENTS.RemoveBot(room, seat, intent);
    case "Rematch":
      return ROOM_INTENTS.Rematch(room, seat, intent);
    case "WithdrawRematch":
      return ROOM_INTENTS.WithdrawRematch(room, seat, intent);
  }
}

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
  /** The commit pipeline: the engine, the store, the broadcast and the one wake-up; `onCreate` creates it. */
  #driver: GameDriver | null = null;
  /** Set when the process shuts down: Seats and the stored Room must then stay as they are. */
  #shuttingDown = false;
  /** Set when retention disposes the Room: the forced client closes must not return it to Lobby. */
  #closing = false;
  /** Seats held for absent Players, by public Player id (spec: Seat hold). */
  readonly #holds = new Map<PlayerId, Hold>();
  /**
   * The rematch votes of the ended Room, by public Player id: Room memory only,
   * never in the store (spec #175, decision 6).
   */
  #rematchVotes: ReadonlySet<PlayerId> = new Set();
  /**
   * The one wake-up the first rematch vote armed (spec #175, decision 2): a
   * later vote never restarts the window.
   */
  #rematchWindow: RematchWindow | null = null;
  /**
   * The IP bucket of the Guest who took the creator's Seat, for the open-Lobby
   * accounting; `null` until then, and after a restore (the guard's counters
   * reset with the process anyway).
   */
  #creatorBucket: string | null = null;
  /** The server's abuse protection; `createGameServer` sets it. */
  guard!: AbuseGuard;
  /** Intent flood control, per connected client. */
  readonly #flood = new Map<string, FloodMeter>();
  /** Quick-chat flood control, per connected client: the same ladder at its own rate (spec #176). */
  readonly #chatFlood = new Map<string, FloodMeter>();
  /** Whether this Lobby is on the Lobby list; a full one is not (ticket #196). */
  #listed = true;

  /** The commit pipeline; `onCreate` creates it once every dependency is set. */
  private get driver(): GameDriver {
    if (this.#driver === null) throw new Error("the driver is created in onCreate");
    return this.#driver;
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
      // Seats, not clients: held and restored Seats have no client (maxClients
      // leaves them room). A Bot never keeps a Guest out of a full Lobby: the
      // joining Guest takes its Seat instead (ticket #197).
      if (
        room.seats.length >= room.settings.maxPlayers &&
        !room.seats.some((seat) => seat.bot === true)
      ) {
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
      const { roomName, password, maxPlayers, minuteLimit, startingCash, roundBonus, turnLimitMs } =
        parsed.data;
      const name = checkRoomName(roomName ?? "");
      if (!name.ok) throw refuse(name.code);
      this.settings = { maxPlayers, minuteLimit, startingCash, roundBonus, turnLimitMs };
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
    this.#driver = new GameDriver({
      engine: this.engine,
      scheduler: this.scheduler,
      store: this.store,
      metrics: this.metrics,
      log: this.log,
      reporter: this.reporter,
      timing: this.timing,
      roomCode: this.roomId,
      readRoom: () => ({
        settings: this.settings,
        roomName: this.displayName,
        creatorId: this.creatorId,
        password: this.password && encodePassword(this.password),
      }),
      readState: () => ({ game: this.game, seats: this.seats, endedAt: this.endedAt }),
      publish: (state, message) => {
        this.game = state;
        this.broadcast(MESSAGE.game, this.withVotes(message));
      },
      onEnded: (endedAt) => {
        this.endedAt = endedAt;
        this.releaseHolds();
      },
      onRetention: () => {
        // Colyseus closes the clients on dispose; their `onLeave` must not revive the Room.
        this.#closing = true;
        void this.disconnect();
      },
      isSeatConnected: (seat) => this.isSeatConnected(seat),
    });
    this.metrics.trackRoom(this);
    if (restored) {
      this.log.info({ playing: this.game !== null, seats: this.seats.length }, "Room restored");
      // A running game re-arms its deadline; one a crash left game-over (the
      // final save landed, `endedAt` did not) is finished now, so retention
      // applies; an ended Room re-arms its retention and keeps its Podium.
      if (this.game) this.driver.resume(this.game);
      // A restored Lobby with every Seat taken is not listed (ticket #196).
      this.syncListing();
    } else {
      this.log.info({ ...this.settings, hasPassword: this.password !== null }, "Room created");
    }
    this.onMessage(MESSAGE.intent, (client: Client, message: unknown) => {
      if (this.admit(client, this.#flood)) this.onIntent(client, message);
    });
    // A quick chat is not an intent: it never reaches the engine (spec #176).
    this.onMessage(MESSAGE.chat, (client: Client, message: unknown) => {
      if (!this.admit(client, this.#flood)) return;
      if (this.admit(client, this.#chatFlood, this.guard.limits.chatsPerSecond)) {
        this.onChat(client, message);
      }
    });
    // Any other message type: refuse it, but keep the connection (spec: MALFORMED).
    this.onMessage("*", (client: Client) => {
      if (this.admit(client, this.#flood)) this.reject(client, "MALFORMED");
    });
  }

  /** Rebuilds the Room from its stored snapshot (the game already migrated). */
  private restore(stored: StoredRoom): void {
    this.roomId = stored.code;
    claimRoomCode(stored.code);
    this.settings = { ...DEFAULT_SETTINGS, ...stored.settings };
    this.displayName = stored.roomName;
    this.creatorId = stored.creatorId;
    this.password = stored.password && decodePassword(stored.password);
    this.seats = stored.seats.map(({ playerId, name, tokenHash = null, bot }) => ({
      playerId,
      name,
      sessionId: null,
      tokenHash,
      ...(bot === true && { bot: true }),
    }));
    this.game = stored.game;
    // An ended Room comes back ended: its Podium offers the rematch again and
    // its stored end time keeps the same retention deadline (spec #175, decision 6).
    this.endedAt = stored.endedAt;
    // Nobody is connected yet: the Room waits for its Players instead of disposing.
    this.autoDispose = false;
    if (this.game) {
      // A running game lives on with nobody connected: its Turn timers keep
      // running until a Guest comes back (the Bot takes the absent Seats'
      // Decisions from that first connection change on) or the game ends.
      // `onCreate` arms its deadline once the driver exists.
      this.unlist();
    } else {
      // A Lobby holds each Guest's Seat for its 60 s, as if its Player had just
      // dropped; a Bot has nobody to come back, so its Seat needs no hold.
      for (const seat of this.seats) if (seat.bot !== true) this.hold(seat, null);
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
      this.#creatorBucket = auth.bucket;
      this.guard.lobbyCreatedBy(this.roomId, auth.bucket);
    }
    if (this.game) throw refuse("ROOM_NOT_FOUND");
    // A full Lobby takes the Guest in place of a Bot, if it has one (ticket #197).
    const full = this.seats.length >= this.settings.maxPlayers;
    const replaced = full ? this.seats.findIndex((seat) => seat.bot === true) : -1;
    if (full && replaced === -1) {
      throw refuse("ROOM_FULL");
    }
    const seat: SeatRecord = {
      playerId: newPlayerId(),
      name: newPlayerName(this.seats.map((s) => s.name)),
      sessionId: client.sessionId,
      tokenHash: token && hashGuestToken(token),
    };
    if (auth?.creates && this.seats.length === 0) this.creatorId = seat.playerId;
    const seats = this.seats.slice();
    if (replaced === -1) seats.push(seat);
    else seats[replaced] = seat;
    // Saved first: a Seat the store doesn't have isn't taken (the join fails).
    this.driver.saveSeats(seats);
    this.seats = seats;
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
    const reconnection: PendingReconnection = this.allowReconnection(client, "manual");
    // Rejected when the hold is released: that is how it ends, not an error.
    reconnection.catch(() => {});
    // Without a rejection the client never finished joining: its Seat is held
    // for the Guest token alone, and there is no reconnection to give up.
    const reject = reconnection.reject;
    this.hold(seat, reject ? () => reject() : null);
    this.metrics.seatDropped();
    this.log.info({ playerId: seat.playerId }, "Seat dropped");
    // A running game's absent Guest has their Decisions played by the Bot.
    this.driver.refreshBot();
    if (!this.game) this.broadcastLobby();
  }

  /** Back by the reconnection token after a short drop: the same Seat, and the current state. */
  override onReconnect(client: Client): void {
    const seat = this.seatOf(client);
    if (!seat) return;
    this.unhold(seat.playerId);
    // The Guest decides the open Decision again: any pending Bot action is cancelled.
    this.driver.refreshBot();
    this.seatReconnected(seat);
    this.sendCurrent(client);
  }

  override onLeave(client: Client): void {
    this.#flood.delete(client.sessionId);
    this.#chatFlood.delete(client.sessionId);
    // In a running game the Seat stays (a Bot plays its Decisions from then);
    // a Lobby frees it. On shutdown nothing changes: the Room comes back as it was.
    if (this.#shuttingDown) return;
    const seat = this.seatOf(client);
    if (!seat) {
      // Taken back from another connection, already freed, or released by a
      // rematch: the Room may now be an empty Lobby.
      this.disposeIfAbandoned();
      return;
    }
    if (this.game) {
      // Left a running game on purpose: the Seat stays (a Bot stands in), as for a drop.
      // (After a drop, `onLeave` only runs once the game has ended or the Seat was taken back.)
      if (this.endedAt === null) {
        this.metrics.seatDropped();
        this.log.info({ playerId: seat.playerId }, "Seat dropped");
        // A Guest who left is absent too: the Bot plays their Decisions.
        this.driver.refreshBot();
      } else if (!this.#closing) {
        // The Podium: a Guest who is gone no longer blocks the others' rematch.
        this.returnIfAgreed("PodiumLeft");
      }
      return;
    }
    this.freeSeat(seat.playerId);
    this.disposeIfAbandoned();
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
    // The Guest is back: any pending Bot action for the open Decision is cancelled.
    this.driver.refreshBot();
    this.seatReconnected(seat);
    this.sendCurrent(client);
  }

  /** Brings a returning client up to date: the game view, or the Lobby (to everyone, as the Seat is no longer held). */
  private sendCurrent(client: Client): void {
    if (this.game) client.send(MESSAGE.game, this.gamePush(this.game));
    else this.broadcastLobby();
  }

  /** The push of the Room's current state: its view, and the Podium's votes once the game ended. */
  private gamePush(game: GameState): GameMessage {
    return this.withVotes({
      view: publicView(game, this.timing),
      events: [],
      reveals: [],
      now: this.now(),
    });
  }

  /** Adds the rematch votes to a push once the game has ended; a running game's push is unchanged. */
  private withVotes(message: GameMessage): GameMessage {
    return this.rematchOffered()
      ? { ...message, rematch: votersOf(this.#rematchVotes, this.seats) }
      : message;
  }

  /**
   * Whether the Podium is up: the game has ended, or this push is the one that
   * ended it (`endedAt` lands just after the broadcast).
   */
  private rematchOffered(): boolean {
    const game = this.game;
    return game !== null && (this.endedAt !== null || game.phase.kind === "gameOver");
  }

  /**
   * Holds the Seat for its absent Player: a Lobby frees it 60 s from now, a
   * running game keeps it until the game ends. `release` gives up the dropped
   * client's reconnection; `null` for a Seat restored without a connection, or
   * whose client dropped before it finished joining.
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
  }

  /** A Lobby Seat's 60 s ran out: it is freed. */
  private expire(playerId: PlayerId): void {
    const hold = this.#holds.get(playerId);
    if (!hold) return;
    this.#holds.delete(playerId);
    // Colyseus then calls `onLeave`, which frees the Seat; a restored Seat has no client.
    if (hold.release) hold.release();
    else this.freeSeat(playerId);
    this.disposeIfAbandoned();
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
   * A Room whose `autoDispose` is off — a restored one, or one a game
   * returned to Lobby — is disposed here once nobody is connected and no Seat
   * waits for a Guest to come back: an emptied Lobby is done (and is then
   * deleted). Colyseus removes a leaving client from `clients` before it calls
   * `onLeave`, so the last Guest's leave sees an empty Room. A Lobby that never
   * played keeps Colyseus's own `autoDispose`; switching that flag off leaves
   * a cleared timer handle that would block every later disposal, so it stays
   * off for good.
   */
  private disposeIfAbandoned(): void {
    if (this.game || this.autoDispose || this.clients.length > 0) return;
    if ([...this.#holds.values()].some((hold) => hold.release === null)) return;
    void this.disconnect();
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
    // A window must not return a Room that retention deleted.
    this.cancelRematchWindow();
    releaseRoomCode(this.roomId);
    // A Lobby that nobody is in any more (the last Guest left, or nobody came
    // back to a restored one) is deleted right away (spec: Retention).
    if (!this.#shuttingDown && !this.game) this.store.delete(this.roomId);
  }

  /** The server's clock for the rules engine. */
  now(): number {
    return this.scheduler.now();
  }

  /**
   * A Bot on the next empty Seat (ticket #196): any seated Player may, while
   * the Room is a Lobby. Bots get a generated Player name like a Guest.
   */
  addBot(): RejectionCode | void {
    if (this.game) return "NOT_OFFERED";
    if (this.seats.length >= this.settings.maxPlayers) return "ROOM_FULL";
    const seat: SeatRecord = {
      playerId: newPlayerId(),
      name: newPlayerName(this.seats.map((s) => s.name)),
      sessionId: null,
      tokenHash: null,
      bot: true,
    };
    this.driver.saveSeats([...this.seats, seat]);
    this.seats.push(seat);
    this.log.info({ playerId: seat.playerId }, "Bot seated");
    this.broadcastLobby();
  }

  /** Takes a Bot off its Seat (ticket #196); a Guest's Seat is refused. */
  removeBot(playerId: PlayerId): RejectionCode | void {
    if (this.game) return "NOT_OFFERED";
    const seat = this.seats.find((s) => s.playerId === playerId);
    if (seat?.bot !== true) return "NOT_OFFERED";
    this.log.info({ playerId }, "Bot removed");
    this.freeSeat(playerId);
  }

  /**
   * A Player asks for a rematch on the Podium (ticket #223): the vote is kept
   * in Room memory and everyone hears who has agreed. Refused while no game
   * has ended. Once every connected Guest has agreed, the Room is a Lobby
   * again (ticket #225).
   */
  rematch(seat: SeatRecord): RejectionCode | void {
    const refusal = this.voteRefusal(seat);
    if (refusal) return refusal;
    this.#rematchVotes = castVote(this.#rematchVotes, seat.playerId);
    this.afterVoteChange("Rematch");
  }

  /** A Player takes their rematch vote back (ticket #223); repeating it is harmless. */
  withdrawRematch(seat: SeatRecord): RejectionCode | void {
    const refusal = this.voteRefusal(seat);
    if (refusal) return refusal;
    this.#rematchVotes = withdrawVote(this.#rematchVotes, seat.playerId);
    this.afterVoteChange("WithdrawRematch");
  }

  /**
   * A vote changed: the Room returns to Lobby if the table agreed, else the
   * votes go out.
   */
  private afterVoteChange(intent: RematchVote): void {
    this.syncRematchWindow();
    if (!this.returnIfAgreed(intent)) this.broadcastVotes();
  }

  /**
   * Keeps the fixed window in step with the votes (spec #175, decision 2): the
   * first vote of an ended Room arms one wake-up, later votes never restart
   * it, and an empty vote set cancels it.
   */
  private syncRematchWindow(): void {
    if (this.#rematchVotes.size === 0) {
      this.cancelRematchWindow();
      return;
    }
    if (this.#rematchWindow !== null || this.game === null || this.endedAt === null) return;
    this.armRematchWindow(this.now());
  }

  /**
   * Arms the one wake-up for the window a first vote at `firstVoteAt` opened,
   * replacing any pending one. `retries` is the failed returns so far: after a
   * failed write the next try waits a back-off, not the whole window again.
   */
  private armRematchWindow(firstVoteAt: number, retries = 0): void {
    this.cancelRematchWindow();
    const window: RematchWindow = { cancel: () => {} };
    this.#rematchWindow = window;
    const at =
      retries === 0 ? windowExpiresAt(firstVoteAt) : this.now() + rematchRetryDelay(retries);
    window.cancel = this.scheduler.at(at, () =>
      this.expireRematchWindow(window, firstVoteAt, retries),
    );
  }

  /** Drops the pending window: the votes are gone, the Room returned to Lobby, or it is going away. */
  private cancelRematchWindow(): void {
    this.#rematchWindow?.cancel();
    this.#rematchWindow = null;
  }

  /**
   * The window ran out: the Room returns to Lobby with the Seats that agreed,
   * releasing the Guests who ignored the Podium (spec #175, story 6). A wake-up
   * for a window that was cancelled or replaced does nothing, and the live
   * state decides, because the Room may have returned, restarted or been
   * disposed in between. A failed Lobby write arms the next try, so a passing
   * store error does not leave the ignoring Guests in the Room.
   */
  private expireRematchWindow(window: RematchWindow, firstVoteAt: number, retries: number): void {
    if (this.#rematchWindow !== window) return;
    this.#rematchWindow = null;
    // Retention or shutdown closes the Room asynchronously: a wake-up in that
    // gap must not save it back as a Lobby.
    if (this.#closing || this.#shuttingDown) return;
    if (this.game === null || this.endedAt === null || this.#rematchVotes.size === 0) return;
    // A wake-up that fired before the window ended waits for the rest of it.
    if (!windowExpired(this.now(), firstVoteAt)) {
      this.armRematchWindow(firstVoteAt);
      return;
    }
    if (!this.returnToLobby("RematchExpired")) this.armRematchWindow(firstVoteAt, retries + 1);
  }

  /**
   * Returns the Room to Lobby state when the connected Guests have all agreed
   * (at least one voting); tells whether it returned. A vote change can
   * complete the agreement, and so can a Guest leaving the Podium: a non-voter
   * who is gone no longer blocks the others. A failed write leaves it ended.
   */
  private returnIfAgreed(cause: RematchTrigger): boolean {
    if (!shouldReturn(this.seats, this.#rematchVotes, (seat) => this.isSeatConnected(seat))) {
      return false;
    }
    return this.returnToLobby(cause);
  }

  /** Why this Seat cannot vote for a rematch, if it cannot: no game has ended, or it is a Bot's. */
  private voteRefusal(seat: SeatRecord): RejectionCode | null {
    if (this.game === null || this.endedAt === null) return "REMATCH_NOT_OFFERED";
    // A Bot has no vote; a Guest's Seat keeps its vote while they are away.
    if (seat.bot === true) return "NOT_OFFERED";
    return null;
  }

  /** Tells everyone the Podium's votes (ticket #223). */
  private broadcastVotes(): void {
    if (this.game) this.broadcast(MESSAGE.game, this.gamePush(this.game));
  }

  /**
   * The agreed Seats are the Room again (spec #175): the driver stores one
   * Lobby snapshot and cancels the old game's retention, then the Room takes
   * the kept Seats and drops the votes. Seats whose Player did not agree are
   * released, so a Guest can take them from the Lobby list again. Room
   * identity and settings stay. Tells whether it returned: a failed write
   * leaves the Room ended.
   */
  private returnToLobby(cause: RematchTrigger): boolean {
    const seats = seatsAfterRematch(this.seats, this.#rematchVotes);
    try {
      this.driver.saveLobby(seats);
    } catch (error) {
      // The votes stand and the retention deletion stays armed; the window's
      // wake-up tries again, and a later vote or Podium leave tries now.
      this.driver.failed(error, "Room not saved", cause);
      return false;
    }
    this.game = null;
    this.endedAt = null;
    this.seats = seats;
    this.#rematchVotes = new Set();
    this.cancelRematchWindow();
    // The game took the Room off the Lobby accounting; a Lobby counts again.
    this.guard.lobbyReopened(this.roomId, this.#creatorBucket);
    // A returned Lobby stays off `autoDispose` (the game needed it off) and
    // disposes when it is abandoned, as a restored Lobby does. A kept Seat
    // nobody is connected to is held the same way: the Guest comes back by
    // Guest token, and there is no reconnection to give up.
    this.autoDispose = false;
    for (const seat of seats) {
      if (seat.bot !== true && !this.isSeatConnected(seat)) this.hold(seat, null);
    }
    this.log.info("Room returned to Lobby");
    this.broadcastLobby();
    return true;
  }

  /** Start (R5): any Player, once every Seat is taken. */
  startGame(): RejectionCode | void {
    if (this.game || this.seats.length < this.settings.maxPlayers) return "NOT_OFFERED";
    // A new game starts with no votes or window from the old Podium.
    this.#rematchVotes = new Set();
    this.cancelRematchWindow();
    const game = setupGame({
      seats: this.seats.map(({ playerId, name, bot }) => ({ playerId, name, bot })),
      settings: this.settings,
      seed: this.timing.seed ?? newSeed(),
      now: this.now(),
      turnLimitMs: this.timing.turnLimitMs,
      minuteMs: this.timing.minuteMs,
    });
    const outcome = this.driver.start(game);
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
   * The game is over (the driver's commit calls this when the game-over phase
   * arrives, and a restore finishes a game-over state a crash left unfinished):
   * the driver records when, swaps the Turn deadline for the retention
   * wake-up and tells this Room to release its Seats (spec: Retention, Seat hold).
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
    this.hideFromList();
  }

  /**
   * Keeps the Lobby list in step with the Seats (ticket #196): a Lobby with no
   * empty Seat leaves the list, so strangers do not try to join it, and comes
   * back once a Seat opens. Only a Lobby is listed.
   */
  private syncListing(): void {
    if (this.game) return;
    if (this.seats.length >= this.settings.maxPlayers) this.hideFromList();
    else this.listAgain();
  }

  /** Removes the Lobby's entry from the Lobby list, if it is on it. */
  private hideFromList(): void {
    if (!this.#listed) return;
    this.#listed = false;
    updateLobby(this, true);
    void this.setMatchmaking({ unlisted: true });
  }

  /** Puts the Lobby back on the Lobby list once a Seat has opened. */
  private listAgain(): void {
    if (this.#listed) return;
    this.#listed = true;
    // `unlisted` first: the LobbyRoom reads the Room's listing when it sees the add.
    void this.setMatchmaking({ unlisted: false }).then(() => updateLobby(this));
  }

  /**
   * Flood control for one connection: whether to handle this client's message.
   * Extras over `perSecond` are dropped, the first with `SLOW_DOWN`; a
   * sustained or heavy flood closes the socket, as a drop (never a consented
   * leave), so the Seat stays held. Every message counts once in the intent
   * meter; a chat counts once in its own, tighter meter as well.
   */
  private admit(
    client: Client,
    meters: Map<string, FloodMeter>,
    perSecond = this.guard.limits.intentsPerSecond,
  ): boolean {
    let meter = meters.get(client.sessionId);
    if (!meter) {
      meter = new FloodMeter(this.meterLimits(perSecond));
      meters.set(client.sessionId, meter);
    }
    const verdict = meter.record(performance.now());
    if (verdict === "warn" || verdict === "close") {
      this.guard.refused("intent_flood", bucketOf(client), null);
    }
    if (verdict === "warn") this.reject(client, "SLOW_DOWN");
    if (verdict === "close") client.leave(CloseCode.WITH_ERROR);
    return verdict === "accept";
  }

  /** The ladder's thresholds, at `perSecond`: the intent meter's rate, or chat's tighter one. */
  private meterLimits(perSecond: number): ConstructorParameters<typeof FloodMeter>[0] {
    const { intentFloodCloseSeconds, intentBurstClose } = this.guard.limits;
    return { intentsPerSecond: perSecond, intentFloodCloseSeconds, intentBurstClose };
  }

  /**
   * A quick chat (spec #176): a catalogue id, broadcast to every client with
   * the sender's Seat. Chat never touches the game state, the store or the
   * Turn clock, and the sender is the connection's Seat, never the payload.
   */
  private onChat(client: Client, message: unknown): void {
    const seat = this.seatOf(client);
    // Not seated right now (a spectator, or a Seat taken back elsewhere): nothing to send under.
    if (!seat) return;
    const parsed = chatSchema.safeParse(message);
    if (!parsed.success) {
      this.reject(client, "MALFORMED");
      return;
    }
    // The sender's Seat is the Player's `seat` in the view: join order during a game.
    this.broadcast(MESSAGE.chat, {
      seat: this.seats.indexOf(seat),
      id: parsed.data.id,
    } satisfies ChatEvent);
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
          ? dispatchRoomIntent(this, seat, intent)
          : this.play(seat, intent);
      } catch (error) {
        // A bug outside the engine's own call (say, in game setup): same as an engine throw.
        this.driver.failed(error, "Intent failed", intent.type);
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
   * Whether that Seat's Player is connected right now: a live client holds its
   * `sessionId`. A Bot's Seat has none, and a Guest who dropped keeps the stale
   * one (the Seat is held for them).
   */
  private isSeatConnected(seat: SeatRecord): boolean {
    return seat.sessionId !== null && this.clients.get(seat.sessionId) !== undefined;
  }

  /**
   * The Room's numbers for the `rooms`, `players_connected` and
   * `seats_held_disconnected` gauges. Held: every Guest Seat with no live
   * client (dropped and held, or restored and not yet taken back), until the
   * game ends; a Bot's Seat is neither connected nor held.
   */
  gauges(): RoomGauges {
    const guests = this.seats.filter((s) => s.bot !== true);
    const connected = guests.filter((seat) => this.isSeatConnected(seat)).length;
    const state = this.game === null ? "lobby" : this.endedAt === null ? "playing" : null;
    return { state, connected, held: state === null ? 0 : guests.length - connected };
  }

  /** Runs a Player intent through the commit pipeline. */
  private play(seat: SeatRecord, intent: PlayerIntent): RejectionCode | void {
    if (!this.game) return "NOT_OFFERED";
    const outcome = this.driver.submit(this.game, intent, seat.playerId);
    return "rejected" in outcome ? outcome.rejected : undefined;
  }

  /** A Lobby change nobody can refuse (a Guest left): a failed write is caught up by the next one. */
  private trySave(): void {
    try {
      this.driver.saveSeats(this.seats);
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
      settings: this.settings,
      hasPassword: this.password !== null,
    };
  }

  /** Sends the Seats to the Room, and the Players count to the Lobby list. */
  private broadcastLobby(): void {
    void this.setMetadata(this.listing());
    this.syncListing();
    const lobby: LobbyMessage = {
      code: this.roomId,
      roomName: this.displayName,
      creatorId: this.creatorId,
      hasPassword: this.password !== null,
      settings: this.settings,
      // Public Player ids and names only: never a session id or token hash.
      seats: this.seats.map(({ playerId, name, bot }) => {
        const heldUntil = this.#holds.get(playerId)?.until;
        return {
          playerId,
          name,
          ...(bot === true && { bot: true }),
          ...(typeof heldUntil === "number" && { heldUntil }),
        };
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
