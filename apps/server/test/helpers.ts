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
import { createGameServer } from "#server.ts";

type Messages = {
  welcome: WelcomeMessage;
  lobby: LobbyMessage;
  game: GameMessage;
  rejected: RejectionMessage;
};
type MessageType = keyof Messages;

const TIMEOUT_MS = 3_000;

export type TestServer = {
  sdk: Client;
  /** A Guest creates a Room. */
  create(options?: CreateOptions): Promise<TestClient>;
  /** A Guest joins a Room by its Room code. */
  join(code: string): Promise<TestClient>;
  stop(): Promise<void>;
};

export async function startTestServer(): Promise<TestServer> {
  const server = createGameServer({ gracefullyShutdown: false });
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
