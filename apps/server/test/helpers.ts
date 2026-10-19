/**
 * Room-server test helpers: an in-process server on a free port, and real
 * `@colyseus/sdk` clients that record every message they receive.
 */
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
  /** A Guest joins a Room by its Room code (the client repeats the code in the options). */
  join(code: string, options?: Omit<JoinOptions, "code">): Promise<TestClient>;
  /** A Guest opens the Lobby list. */
  watchLobbyList(): Promise<TestLobbyList>;
  stop(): Promise<void>;
};

export async function startTestServer(): Promise<TestServer> {
  const server = createGameServer({ gracefullyShutdown: false });
  await server.listen(0, "127.0.0.1");
  const address = server.transport.server?.address();
  if (!address || typeof address === "string") throw new Error("the server has no TCP port");
  const sdk = new Client(`ws://127.0.0.1:${address.port}`);
  const clients: { leave(): Promise<void> }[] = [];
  const track = <T extends { leave(): Promise<void> }>(client: T) => {
    clients.push(client);
    return client;
  };
  return {
    sdk,
    create: async (options = {}) => track(new TestClient(await sdk.create(GAME_ROOM, options))),
    join: async (code, options = {}) =>
      track(new TestClient(await sdk.joinById(code, { code, ...options } satisfies JoinOptions))),
    watchLobbyList: async () => track(new TestLobbyList(await sdk.joinOrCreate(LOBBY_ROOM))),
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
