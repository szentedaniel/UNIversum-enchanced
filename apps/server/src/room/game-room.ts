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
import { releaseRoomCode, reserveRoomCode } from "#room/room-code.ts";
import { systemScheduler, type Scheduler } from "#room/scheduler.ts";

export type SeatRecord = LobbySeat & { sessionId: string };

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
export class GameRoom extends Room {
  settings!: RoomSettings;
  /** Taken Seats in join order (R6). */
  seats: SeatRecord[] = [];
  /** The running game, or `null` while the Room is a Lobby. */
  game: GameState | null = null;
  /** The clock and wake-ups; `createGameServer` swaps in a test scheduler. */
  scheduler: Scheduler = systemScheduler;
  /** Cancels the one pending Turn-deadline wake-up. */
  #cancelWakeUp: (() => void) | null = null;

  override onCreate(options: unknown): void {
    const parsed = createOptionsSchema.safeParse(options);
    if (!parsed.success) throw new ServerError(400, "MALFORMED" satisfies RejectionCode);
    this.settings = parsed.data;
    this.roomId = reserveRoomCode();
    this.maxClients = this.settings.maxPlayers;
    this.onMessage(MESSAGE.intent, (client: Client, message: unknown) =>
      this.onIntent(client, message),
    );
    // Any other message type: refuse it, but keep the connection (spec: MALFORMED).
    this.onMessage("*", (client: Client) => this.reject(client, "MALFORMED"));
  }

  override onJoin(client: Client): void {
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
    void this.lock();
    this.commit(game, []);
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
