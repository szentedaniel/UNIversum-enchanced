/**
 * Room-server test helpers: an in-process server on a free port, and real
 * `@colyseus/sdk` clients that record every message they receive.
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { matchMaker } from "@colyseus/core";
import { Client, type Room } from "@colyseus/sdk";
import {
  GAME_ROOM,
  MESSAGE,
  type CreateOptions,
  type GameMessage,
  type LobbyMessage,
  type RejectionMessage,
  type WelcomeMessage,
} from "@universum/protocol";
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

export type TestServerOptions = {
  /** The SQLite file; a new temp file by default. Pass the last server's to restart on it. */
  databasePath?: string;
  /** The clock; a new `ManualScheduler` at `T0` by default. */
  scheduler?: ManualScheduler;
  /** Wraps the SQLite store, e.g. to make writes fail. */
  wrapStore?: (store: RoomStore) => RoomStore;
};

export type TestServer = {
  sdk: Client;
  /** Every Room's clock and wake-ups. */
  scheduler: ManualScheduler;
  /** The SQLite file, to start the next server on after `stop()`. */
  databasePath: string;
  /** The store the server writes (read it to see what survives a restart). */
  store: RoomStore;
  /** How many Rooms the boot restored. */
  restored: number;
  /** A Guest creates a Room. */
  create(options?: CreateOptions): Promise<TestClient>;
  /** A Guest joins a Room by its Room code. */
  join(code: string): Promise<TestClient>;
  /**
   * The live Room under `code`, if any. Only for what no client can see yet:
   * a restored game's Seats have no connection until rejoin lands (#35).
   */
  room(code: string): GameRoom | undefined;
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
  const server = createGameServer({ gracefullyShutdown: false, scheduler, store });
  await server.listen(0, "127.0.0.1");
  const restored = await restoreRooms({ store, scheduler });
  const address = server.transport.server?.address();
  if (!address || typeof address === "string") throw new Error("the server has no TCP port");
  const sdk = new Client(`ws://127.0.0.1:${address.port}`);
  const clients: TestClient[] = [];
  const track = (client: TestClient) => {
    clients.push(client);
    return client;
  };
  return {
    sdk,
    scheduler,
    databasePath,
    store,
    restored,
    create: async (createOptions = {}) =>
      track(new TestClient(await sdk.create(GAME_ROOM, createOptions))),
    join: async (code) => track(new TestClient(await sdk.joinById(code, {}))),
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

/** One Guest's connection. Messages are queued per type until a test takes them. */
export class TestClient {
  readonly room: Room;
  readonly #queues: { [K in MessageType]: Messages[K][] } = {
    welcome: [],
    lobby: [],
    game: [],
    rejected: [],
  };
  readonly #waiters: { [K in MessageType]?: (message: Messages[K]) => void } = {};

  constructor(room: Room) {
    this.room = room;
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
}
