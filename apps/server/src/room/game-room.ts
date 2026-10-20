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
  type GameEvent,
  type GameState,
  type PlayerIntent,
} from "@universum/rules";
import { FloodMeter } from "#abuse/flood.ts";
import { REQUEST_ID_HEADER, type AbuseGuard } from "#abuse/guard.ts";
import { ipBucket } from "#abuse/ip.ts";
import { newPlayerId, newSeed } from "#room/ids.ts";
import { newPlayerName } from "#room/player-names.ts";
import { hashPassword, passwordMatches, type PasswordHash } from "#room/password.ts";
import { releaseRoomCode, reserveRoomCode } from "#room/room-code.ts";
import { checkRoomName } from "#room/room-name.ts";
import { systemScheduler, type Scheduler } from "#room/scheduler.ts";

export type SeatRecord = LobbySeat & { sessionId: string };

/**
 * `client.auth` of a Guest `onAuth` admitted: the IP bucket and Seat
 * reservation it is counted under, whether it creates the Room, and for a
 * join the Room code (the Room is not full, the password matched).
 */
type SeatAuth = { bucket: string; reservation: string; creates: boolean; code?: string };

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
 * One game Room (ADR-0002). No Schema state: the Room sends its own messages,
 * the full public view plus each intent's events to everyone, and Rejections
 * to the sender only. While it is a Lobby it sends the Seats instead.
 *
 * Extension points: `commit` (store write before broadcast #34; it also
 * schedules the Turn deadline, which #34 reschedules on restore), `onJoin`/`onLeave` (Guest token and Seat hold #35),
 * `ROOM_INTENTS` (Room-level intents), `onIntent` (flood control #37).
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
  /** The clock and wake-ups; `createGameServer` swaps in a test scheduler. */
  scheduler: Scheduler = systemScheduler;
  /** The server's abuse protection; `createGameServer` sets it. */
  guard!: AbuseGuard;
  /** Cancels the one pending Turn-deadline wake-up. */
  #cancelWakeUp: (() => void) | null = null;
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
    if (room.hasReachedMaxClients()) throw refuse("ROOM_FULL");
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
    const parsed = createOptionsSchema.safeParse(options);
    if (!parsed.success) throw refuse("MALFORMED");
    const { roomName, password, maxPlayers, minuteLimit } = parsed.data;
    const name = checkRoomName(roomName ?? "");
    if (!name.ok) throw refuse(name.code);
    this.settings = { maxPlayers, minuteLimit };
    this.displayName = name.name;
    this.password = password ? await hashPassword(password) : null;
    this.roomId = reserveRoomCode();
    this.maxClients = maxPlayers;
    this.seatReservationTimeout = this.guard.limits.seatReservationSeconds;
    this.guard.lobbyOpened(this.roomId);
    this.metadata = this.listing();
    this.onMessage(MESSAGE.intent, (client: Client, message: unknown) => {
      if (this.admit(client)) this.onIntent(client, message);
    });
    // Any other message type: refuse it, but keep the connection (spec: MALFORMED).
    this.onMessage("*", (client: Client) => {
      if (this.admit(client)) this.reject(client, "MALFORMED");
    });
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
    const seat: SeatRecord = {
      playerId: newPlayerId(),
      name: newPlayerName(this.seats.map((s) => s.name)),
      sessionId: client.sessionId,
    };
    this.seats.push(seat);
    client.send(MESSAGE.welcome, { playerId: seat.playerId } satisfies WelcomeMessage);
    this.broadcastLobby();
  }

  override onLeave(client: Client): void {
    this.#flood.delete(client.sessionId);
    // In a running game the Seat stays (its Turns time out); a Lobby frees it.
    if (this.game) return;
    this.seats = this.seats.filter((s) => s.sessionId !== client.sessionId);
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

  override onDispose(): void {
    this.guard.lobbyClosed(this.roomId);
    this.#cancelWakeUp?.();
    releaseRoomCode(this.roomId);
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
    this.unlist();
    this.commit(game, []);
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
    if (verdict === "warn") this.reject(client, "SLOW_DOWN");
    if (verdict === "close") client.leave(CloseCode.WITH_ERROR);
    return verdict === "accept";
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
    this.commit(result.state, result.events);
  }

  /**
   * Accepts a new game state: store it (#34), push the view and events to
   * everyone, and wake up at its Turn deadline.
   */
  private commit(state: GameState, events: GameEvent[]): void {
    this.game = state;
    const message: GameMessage = { view: publicView(state), events, now: this.now() };
    this.broadcast(MESSAGE.game, message);
    this.scheduleDeadline(state);
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
    if (!this.game) return;
    let result;
    try {
      result = apply(this.game, { type: "TurnTimedOut", turn }, { actor: SYSTEM, now: this.now() });
    } catch {
      // The Room keeps its last good state (logging and reporting: #44).
      return;
    }
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
    client.send(MESSAGE.rejected, { code } satisfies RejectionMessage);
  }
}
