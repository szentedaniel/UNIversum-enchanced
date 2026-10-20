import { matchMaker, Room, ServerError, updateLobby, type Client } from "@colyseus/core";
import {
  CLOSE_CODE,
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
import { deleteAfterRetention } from "#store/retention.ts";
import type { RoomStore, StoredRoom } from "#store/room-store.ts";

/**
 * A taken Seat; `sessionId` is `null` while nobody is connected to it (e.g.
 * after a restore). `tokenHash`: the hash of its Guest's token, `null` if the
 * Guest sent none (then only the reconnection token brings them back).
 */
export type SeatRecord = LobbySeat & { sessionId: string | null; tokenHash: string | null };

/** How long a Lobby Seat is held for a Player who dropped (spec: Seat hold). */
export const LOBBY_SEAT_HOLD_MS = 60_000;

/**
 * A Seat held for its absent Player. `release` gives up the Colyseus
 * reconnection of a dropped client (Colyseus then calls `onLeave`); a Seat
 * restored without a connection has none. `until`: when a Lobby frees it;
 * `null` in a running game, which holds it until the game ends.
 */
type Hold = { release: (() => void) | null; until: number | null; cancel: () => void };

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
 * control #37).
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
  /** Cancels the one pending wake-up (the Turn deadline, or deletion once the game ended). */
  #cancelWakeUp: (() => void) | null = null;
  /** Set when the process shuts down: Seats and the stored Room must then stay as they are. */
  #shuttingDown = false;
  /** Seats held for absent Players, by public Player id (spec: Seat hold). */
  readonly #holds = new Map<string, Hold>();

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
    if (!(room instanceof GameRoom)) throw refuse(404, "ROOM_NOT_FOUND");
    // A Guest taking their own Seat back gets in, game started or not (#35).
    if (room.seatOfToken(join.data.guestToken ?? null)) return { code: room.roomId };
    if (room.game) throw refuse(404, "ROOM_NOT_FOUND");
    // Seats, not clients: held and restored Seats have no client (maxClients leaves them room).
    if (room.seats.length >= room.settings.maxPlayers) throw refuse(409, "ROOM_FULL");
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
    // Room for every Seat's client plus a Guest taking a held Seat back (a held
    // Seat counts as a client until it is released); `onAuth` and `onJoin` cap the Seats.
    this.maxClients = this.settings.maxPlayers * 2;
    this.metadata = this.listing();
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
      // until it ends; a deadline that passed while the server was down fires at once.
      this.unlist();
      this.scheduleDeadline(this.game);
    } else {
      // A Lobby holds each Seat for its 60 s, as if its Player had just dropped.
      for (const seat of this.seats) this.hold(seat, null);
    }
  }

  override async onJoin(client: Client, options: unknown, auth?: JoinAuth): Promise<void> {
    const token = guestTokenIn(options);
    const own = this.seatOfToken(token);
    if (own) return this.takeBack(own, client);
    // The creator brings the password in its create options. Anyone else who
    // reached a Seat without `onAuth` admitting a join to this Room must too.
    if (auth?.code !== this.roomId && !(await this.passwordMatches(passwordIn(options)))) {
      throw refuse(403, "WRONG_PASSWORD");
    }
    if (this.game) throw refuse(404, "ROOM_NOT_FOUND");
    if (this.seats.length >= this.settings.maxPlayers) {
      throw refuse(409, "ROOM_FULL");
    }
    const seat: SeatRecord = {
      playerId: newPlayerId(),
      name: newPlayerName(this.seats.map((s) => s.name)),
      sessionId: client.sessionId,
      tokenHash: token && hashGuestToken(token),
    };
    // Saved first: a Seat the store doesn't have isn't taken (the join fails).
    this.save([...this.seats, seat], this.game, []);
    this.seats.push(seat);
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
    if (!this.game) this.broadcastLobby();
  }

  /** Back by the reconnection token after a short drop: the same Seat, and the current state. */
  override onReconnect(client: Client): void {
    const seat = this.seatOf(client);
    if (!seat) return;
    this.unhold(seat.playerId);
    this.sendCurrent(client);
  }

  override onLeave(client: Client): void {
    // In a running game the Seat stays (its Turns time out); a Lobby frees it.
    // On shutdown nothing changes: the Room comes back as it was.
    if (this.game || this.#shuttingDown) return;
    const seat = this.seatOf(client);
    if (seat) this.freeSeat(seat.playerId);
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
    this.sendCurrent(client);
  }

  /** Brings a returning client up to date: the game view, or the Lobby (to everyone, as the Seat is no longer held). */
  private sendCurrent(client: Client): void {
    if (this.game) {
      const message: GameMessage = { view: publicView(this.game), events: [], now: this.now() };
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
  private unhold(playerId: string): void {
    const hold = this.#holds.get(playerId);
    if (!hold) return;
    hold.cancel();
    this.#holds.delete(playerId);
    this.waitIfRestored();
  }

  /** A Lobby Seat's 60 s ran out: it is freed. */
  private expire(playerId: string): void {
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
  private freeSeat(playerId: string): void {
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
    this.#cancelWakeUp?.();
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
      seed: newSeed(),
      now: this.now(),
    });
    const refused = this.commit(game, []);
    if (refused) return refused;
    // The game outlives its connections: Seats are held until it ends.
    this.autoDispose = false;
    this.unlist();
    for (const [playerId, hold] of this.#holds) {
      hold.cancel();
      this.#holds.set(playerId, { ...hold, until: null, cancel: () => {} });
    }
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
    // Seats were held until the game ends (spec: Seat hold).
    this.releaseHolds();
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
   * Takes a started Room off the Lobby list. An unlisted Room sends Lobby-list
   * updates no more, so the removal is sent first; the private flag is never
   * used (spec). The Room is not locked: Colyseus would then refuse a Guest
   * taking their Seat back before `onAuth`, which refuses everyone else.
   */
  private unlist(): void {
    updateLobby(this, true);
    void this.setMatchmaking({ unlisted: true });
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
        roomName: this.displayName,
        password: this.password && encodePassword(this.password),
        seats: seats.map(({ playerId, name, tokenHash }) => ({ playerId, name, tokenHash })),
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
    client.send(MESSAGE.rejected, { code } satisfies RejectionMessage);
  }
}
