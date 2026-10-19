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
import { newPlayerId, newSeed } from "#room/ids.ts";
import { newPlayerName } from "#room/player-names.ts";
import { hashPassword, passwordMatches, type PasswordHash } from "#room/password.ts";
import { releaseRoomCode, reserveRoomCode } from "#room/room-code.ts";
import { checkRoomName } from "#room/room-name.ts";
import { systemScheduler, type Scheduler } from "#room/scheduler.ts";

export type SeatRecord = LobbySeat & { sessionId: string };

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
  /** Cancels the one pending Turn-deadline wake-up. */
  #cancelWakeUp: (() => void) | null = null;

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
    if (room.hasReachedMaxClients()) throw refuse(409, "ROOM_FULL");
    if (!(await room.passwordMatches(join.data.password ?? ""))) {
      throw refuse(403, "WRONG_PASSWORD");
    }
    return { code: room.roomId };
  }

  override async onCreate(options: unknown): Promise<void> {
    const parsed = createOptionsSchema.safeParse(options);
    if (!parsed.success) throw refuse(400, "MALFORMED");
    const { roomName, password, maxPlayers, minuteLimit } = parsed.data;
    const name = checkRoomName(roomName ?? "");
    if (!name.ok) throw refuse(400, "ROOM_NAME_INVALID");
    this.settings = { maxPlayers, minuteLimit };
    this.displayName = name.name;
    this.password = password ? await hashPassword(password) : null;
    this.roomId = reserveRoomCode();
    this.maxClients = maxPlayers;
    this.metadata = this.listing();
    this.onMessage(MESSAGE.intent, (client: Client, message: unknown) =>
      this.onIntent(client, message),
    );
    // Any other message type: refuse it, but keep the connection (spec: MALFORMED).
    this.onMessage("*", (client: Client) => this.reject(client, "MALFORMED"));
  }

  override async onJoin(client: Client, options: unknown, auth?: JoinAuth): Promise<void> {
    // The creator brings the password in its create options. Anyone else who
    // reached a Seat without `onAuth` admitting a join to this Room must too.
    if (auth?.code !== this.roomId && !(await this.passwordMatches(passwordIn(options)))) {
      throw refuse(403, "WRONG_PASSWORD");
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
    updateLobby(this, true);
    void this.setMatchmaking({ unlisted: true });
    void this.lock();
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
