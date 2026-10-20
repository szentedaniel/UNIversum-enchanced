/**
 * Room-server test helpers: an in-process server on a free port, and real
 * `@colyseus/sdk` clients that record every message they receive.
 */
import { randomBytes } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { matchMaker } from "@colyseus/core";
import { Client, type Room } from "@colyseus/sdk";
import {
  GAME_ROOM,
  LOBBY_LIST_MESSAGE,
  LOBBY_ROOM,
  MESSAGE,
  type CreateOptions,
  type GameMessage,
  type JoinOptions,
  type LobbyListing,
  type LobbyListingMetadata,
  type LobbyMessage,
  matchmakeRefusal,
  type Refusal,
  type RejectionMessage,
  type WelcomeMessage,
} from "@universum/protocol";
import type { Logger } from "#observability/logger.ts";
import { GameMetrics } from "#observability/metrics.ts";
import { DEFAULT_LIMITS, type Limits } from "#limits.ts";
import { GameRoom } from "#room/game-room.ts";
import type { Scheduler } from "#room/scheduler.ts";
import { createGameServer, restoreRooms } from "#server.ts";
import type { RoomStore } from "#store/room-store.ts";
import { openSqliteRoomStore } from "#store/sqlite-room-store.ts";

type Messages = {
  welcome: WelcomeMessage;
  lobby: LobbyMessage;
  game: GameMessage;
  rejected: RejectionMessage;
};
type MessageType = keyof Messages;

const TIMEOUT_MS = 3_000;

/** A fixed start for the test clock: 2026-10-19 12:00:00 UTC. */
export const T0 = Date.UTC(2026, 9, 19, 12, 0, 0);

type Task = { time: number; run: () => void; cancelled: boolean; done: boolean };

/**
 * A scheduler whose time moves only when a test says so; nothing ever fires
 * by itself, so Room tests never sleep and never race real timers.
 */
export class ManualScheduler implements Scheduler {
  #time: number;
  readonly #tasks: Task[] = [];

  constructor(start = T0) {
    this.#time = start;
  }

  now(): number {
    return this.#time;
  }

  at(time: number, run: () => void): () => void {
    const task: Task = { time, run, cancelled: false, done: false };
    this.#tasks.push(task);
    return () => {
      task.cancelled = true;
    };
  }

  /** Moves the clock to `time` and runs every task due by then, in time order. */
  advanceTo(time: number): void {
    this.#time = Math.max(this.#time, time);
    for (;;) {
      const due = this.#tasks
        .filter((t) => !t.cancelled && !t.done && t.time <= this.#time)
        .toSorted((a, b) => a.time - b.time)[0];
      if (!due) return;
      due.done = true;
      due.run();
    }
  }

  /** The most recently scheduled task for `time`, to run by hand (a late or stale wake-up). */
  lastTaskAt(time: number): () => void {
    const task = this.#tasks.findLast((t) => t.time === time);
    if (!task) throw new Error(`nothing is scheduled at ${time}`);
    return task.run;
  }
}

/**
 * Test servers keep the production limits, except the per-IP ones every test
 * Guest shares (they all come from 127.0.0.1), which are raised as e2e does.
 */
export const TEST_LIMITS: Limits = {
  ...DEFAULT_LIMITS,
  roomCreationsPerMinute: 10_000,
  roomCreationsPerHour: 10_000,
  openLobbiesPerIp: 10_000,
  joinsPerMinute: 10_000,
  seatReservationsPerIp: 10_000,
  socketsPerIp: 10_000,
};

/** A Guest on its own IP (sent as `X-Real-IP`, as Caddy does). */
export type TestGuest = {
  create(options?: CreateOptions): Promise<TestClient>;
  join(code: string, options?: Omit<JoinOptions, "code">): Promise<TestClient>;
};

export type TestServerOptions = {
  /** Abuse-protection limits over `TEST_LIMITS`. */
  limits?: Partial<Limits>;
  /** The SQLite file; a new temp file by default. Pass the last server's to restart on it. */
  databasePath?: string;
  /** The clock; a new `ManualScheduler` at `T0` by default. */
  scheduler?: ManualScheduler;
  /** Wraps the SQLite store, e.g. to make writes fail. */
  wrapStore?: (store: RoomStore) => RoomStore;
  /** The server's logger (e.g. `createLogger` on a `captureLogs()` stream); silent by default. */
  log?: Logger;
};

export type TestServer = {
  sdk: Client;
  port: number;
  /** Every Room's clock and wake-ups. */
  scheduler: ManualScheduler;
  /** The SQLite file, to start the next server on after `stop()`. */
  databasePath: string;
  /** The store the server writes (read it to see what survives a restart). */
  store: RoomStore;
  /** How many Rooms the boot restored. */
  restored: number;
  /** This server's metrics (what `/metrics` serves): `await metrics.scrape()`. */
  metrics: GameMetrics;
  /** A Guest creates a Room. */
  create(options?: CreateOptions): Promise<TestClient>;
  /** A Guest joins a Room by its Room code (the client repeats the code in the options). */
  join(code: string, options?: Omit<JoinOptions, "code">): Promise<TestClient>;
  /** A Guest opens the Lobby list. */
  watchLobbyList(): Promise<TestLobbyList>;
  /** A dropped client comes back by its `reconnectionToken`, as the SDK does after a short drop. */
  reconnect(dropped: TestClient): Promise<TestClient>;
  /**
   * The live Room under `code`, if any. Only for what no client can see yet:
   * a restored game's Seats have no connection until rejoin lands (#35).
   */
  room(code: string): GameRoom | undefined;
  /** A Guest whose requests come from `ip`. */
  from(ip: string): TestGuest;
  /**
   * A raw matchmaking request from `ip` that never opens its WebSocket (the
   * Seat, if any, stays reserved until it lapses). `null`: accepted.
   */
  matchmake(
    path: string,
    body: unknown,
    options?: { ip?: string; rawBody?: string },
  ): Promise<Refusal | null>;
  /** Shuts down the way a deploy does (clients still connected), then closes the store. */
  stop(): Promise<void>;
};

/**
 * Starts the Room server in-process the way `main.ts` does: listen, then
 * restore every unfinished Room from the store. One at a time per test file:
 * Colyseus' matchmaker is a process-wide singleton.
 */
export async function startTestServer(options: TestServerOptions = {}): Promise<TestServer> {
  const scheduler = options.scheduler ?? new ManualScheduler();
  const databasePath =
    options.databasePath ?? join(mkdtempSync(join(tmpdir(), "universum-server-")), "rooms.sqlite");
  const sqlite = openSqliteRoomStore(databasePath);
  const store = options.wrapStore?.(sqlite) ?? sqlite;
  const metrics = new GameMetrics({ release: "test" });
  const { log } = options;
  const server = createGameServer({
    gracefullyShutdown: false,
    scheduler,
    store,
    limits: { ...TEST_LIMITS, ...options.limits },
    metrics,
    log,
  });
  await server.listen(0, "127.0.0.1");
  const restored = await restoreRooms({ store, scheduler, metrics, log });
  const address = server.transport.server?.address();
  if (!address || typeof address === "string") throw new Error("the server has no TCP port");
  const { port } = address;
  const sdk = new Client(`ws://127.0.0.1:${port}`);
  const clients: { leave(): Promise<void> }[] = [];
  const track = <T extends { leave(): Promise<void> }>(client: T) => {
    clients.push(client);
    return client;
  };
  const guest = (client: Client): TestGuest => ({
    create: async (createOptions = {}) =>
      track(new TestClient(await client.create(GAME_ROOM, createOptions))),
    join: async (code, joinOptions = {}) =>
      track(
        new TestClient(await client.joinById(code, { code, ...joinOptions } satisfies JoinOptions)),
      ),
  });
  return {
    sdk,
    port,
    scheduler,
    databasePath,
    store,
    restored,
    metrics,
    ...guest(sdk),
    from: (ip) => guest(new Client(`ws://127.0.0.1:${port}`, { headers: { "x-real-ip": ip } })),
    async matchmake(path, body, { ip, rawBody } = {}) {
      const response = await fetch(`http://127.0.0.1:${port}/matchmake/${path}`, {
        method: "POST",
        headers: { "content-type": "application/json", ...(ip && { "x-real-ip": ip }) },
        body: rawBody ?? JSON.stringify(body),
      });
      if (response.ok) return null;
      const answer: unknown = await response.json();
      const error =
        typeof answer === "object" &&
        answer !== null &&
        "error" in answer &&
        typeof answer.error === "string"
          ? answer.error
          : "";
      return matchmakeRefusal({ code: response.status, message: error });
    },
    watchLobbyList: async () => track(new TestLobbyList(await sdk.joinOrCreate(LOBBY_ROOM))),
    reconnect: async (dropped) =>
      track(new TestClient(await sdk.reconnect(dropped.reconnectionToken))),
    room(code) {
      const room = matchMaker.getLocalRoomById(code);
      return room instanceof GameRoom ? room : undefined;
    },
    async stop() {
      await server.gracefullyShutdown(false);
      await Promise.all(clients.map((c) => c.leave()));
      sqlite.close();
    },
  };
}

/** A pino destination that keeps every line, to read back in a test. */
export function captureLogs() {
  const chunks: string[] = [];
  return {
    stream: { write: (line: string) => void chunks.push(line) },
    /** Everything written, as one string. */
    text: () => chunks.join(""),
    /** Every line, parsed. */
    lines: (): Record<string, unknown>[] =>
      chunks
        .join("")
        .split("\n")
        .filter((l) => l !== "")
        .map((l) => {
          const line: Record<string, unknown> = JSON.parse(l);
          return line;
        }),
  };
}

/** Waits until `check` stops throwing (for effects no client is told about, like a deleted Room). */
export async function eventually(check: () => void, timeoutMs = TIMEOUT_MS): Promise<void> {
  const until = Date.now() + timeoutMs;
  for (;;) {
    try {
      check();
      return;
    } catch (error) {
      if (Date.now() > until) throw error;
      // oxlint-disable-next-line no-await-in-loop -- polling until the effect lands
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }
}

/** A new random Guest token, as a browser creates once. */
export const newGuestToken = (): string => randomBytes(16).toString("hex");

/** One Guest's connection. Messages are queued per type until a test takes them. */
export class TestClient {
  readonly room: Room;
  /** Every message received, raw, to check that no secret ever reaches a client. */
  readonly received: unknown[] = [];
  /** The reconnection token this connection had when it dropped. */
  reconnectionToken = "";
  /** Resolves with the close code once this connection is closed. */
  readonly closed: Promise<number>;
  readonly #queues: { [K in MessageType]: Messages[K][] } = {
    welcome: [],
    lobby: [],
    game: [],
    rejected: [],
  };
  readonly #waiters: { [K in MessageType]?: (message: Messages[K]) => void } = {};

  constructor(room: Room) {
    this.room = room;
    // Tests reconnect by hand (`server.reconnect`), never the SDK by itself.
    room.reconnection.enabled = false;
    this.closed = new Promise((resolve) => room.onLeave((code) => resolve(code)));
    // Handlers must be registered before the first await after joining, or
    // the SDK drops the messages the server sends on join.
    this.#listen("welcome");
    this.#listen("lobby");
    this.#listen("game");
    this.#listen("rejected");
  }

  // oxlint-disable-next-line typescript/no-unnecessary-type-parameters -- ties the queue to the message type
  #listen<T extends MessageType>(type: T): void {
    this.room.onMessage(MESSAGE[type], (message: Messages[T]) => {
      this.received.push(message);
      const waiter = this.#waiters[type];
      if (waiter) {
        delete this.#waiters[type];
        waiter(message);
      } else {
        this.#queues[type].push(message);
      }
    });
  }

  get code(): string {
    return this.room.roomId;
  }

  /** The next message of `type`, waiting for it if none is queued. */
  next<T extends MessageType>(type: T): Promise<Messages[T]> {
    const queued = this.#queues[type].shift();
    if (queued !== undefined) return Promise.resolve(queued);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`no "${type}" message within ${TIMEOUT_MS} ms`)),
        TIMEOUT_MS,
      );
      const waiter = (message: Messages[T]) => {
        clearTimeout(timer);
        resolve(message);
      };
      Object.assign(this.#waiters, { [type]: waiter });
    });
  }

  /** Takes messages of `type` until one matches `predicate`, and returns it. */
  async until<T extends MessageType>(
    type: T,
    predicate: (message: Messages[T]) => boolean,
  ): Promise<Messages[T]> {
    for (;;) {
      // oxlint-disable-next-line no-await-in-loop -- messages arrive one after another
      const message = await this.next(type);
      if (predicate(message)) return message;
    }
  }

  /** Messages of `type` received and not yet taken. */
  pending<T extends MessageType>(type: T): Messages[T][] {
    const queue: Messages[T][] = this.#queues[type];
    return [...queue];
  }

  /** Sends an `intent` message (anything, so tests can send malformed ones). */
  send(intent: unknown): void {
    this.room.send(MESSAGE.intent, intent);
  }

  async leave(): Promise<void> {
    if (this.room.connection.isOpen) await this.room.leave();
  }

  /** The connection drops without a goodbye (a network blip, a closed tab). */
  async drop(): Promise<void> {
    this.reconnectionToken = this.room.reconnectionToken;
    await this.room.leave(false);
  }
}

type RoomCache = { roomId: string; metadata: LobbyListingMetadata };

/** A Guest on the Lobby list: the live list of Lobbies, as the LobbyRoom streams it. */
export class TestLobbyList {
  readonly room: Room;
  /** Every message the LobbyRoom sent, raw, to check that no secret ever leaves the server. */
  readonly received: unknown[] = [];
  readonly #lobbies = new Map<string, LobbyListing>();
  #changed: (() => void) | null = null;

  constructor(room: Room) {
    this.room = room;
    const set = ({ roomId, metadata }: RoomCache) =>
      this.#lobbies.set(roomId, { code: roomId, ...metadata });
    this.room.onMessage(LOBBY_LIST_MESSAGE.rooms, (rooms: RoomCache[]) => {
      this.received.push(rooms);
      this.#lobbies.clear();
      rooms.forEach(set);
      this.#changed?.();
    });
    this.room.onMessage(LOBBY_LIST_MESSAGE.add, (message: [string, RoomCache]) => {
      this.received.push(message);
      set(message[1]);
      this.#changed?.();
    });
    this.room.onMessage(LOBBY_LIST_MESSAGE.remove, (code: string) => {
      this.received.push(code);
      this.#lobbies.delete(code);
      this.#changed?.();
    });
  }

  /** The Lobby with this Room code, if listed. */
  get(code: string): LobbyListing | undefined {
    return this.#lobbies.get(code);
  }

  /** Waits until the list matches `predicate`. */
  async until(predicate: (list: this) => boolean): Promise<void> {
    if (predicate(this)) return;
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#changed = null;
        reject(new Error(`the Lobby list did not change as expected within ${TIMEOUT_MS} ms`));
      }, TIMEOUT_MS);
      this.#changed = () => {
        if (!predicate(this)) return;
        clearTimeout(timer);
        this.#changed = null;
        resolve();
      };
    });
  }

  async leave(): Promise<void> {
    if (this.room.connection.isOpen) await this.room.leave();
  }
}
