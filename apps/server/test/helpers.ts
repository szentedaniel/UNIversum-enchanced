/**
 * Room-server test helpers: an in-process server on a free port, and real
 * `@colyseus/sdk` clients that record every message they receive.
 */
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
import type { Scheduler } from "#room/scheduler.ts";
import { createGameServer } from "#server.ts";

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

export type TestServer = {
  sdk: Client;
  /** Every Room's clock and wake-ups. */
  scheduler: ManualScheduler;
  /** A Guest creates a Room. */
  create(options?: CreateOptions): Promise<TestClient>;
  /** A Guest joins a Room by its Room code. */
  join(code: string): Promise<TestClient>;
  stop(): Promise<void>;
};

export async function startTestServer(): Promise<TestServer> {
  const scheduler = new ManualScheduler();
  const server = createGameServer({ gracefullyShutdown: false, scheduler });
  await server.listen(0, "127.0.0.1");
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
    create: async (options = {}) => track(new TestClient(await sdk.create(GAME_ROOM, options))),
    join: async (code) => track(new TestClient(await sdk.joinById(code, {}))),
    async stop() {
      await Promise.all(clients.map((c) => c.leave()));
      await server.gracefullyShutdown(false);
    },
  };
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
