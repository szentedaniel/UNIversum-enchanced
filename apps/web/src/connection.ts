/**
 * The one connection to the Room server, and the only writer of `roomStore`.
 * It owns the `@colyseus/sdk` client; screens call these functions and read
 * the store. Reconnection by `reconnectionToken` and Guest token lands here (#35).
 * It also streams the Lobby list (`watchLobbyList`), which lives outside the store.
 */
import { Client, MatchMakeError, type Room } from "@colyseus/sdk";
import {
  GAME_ROOM,
  LOBBY_LIST_MESSAGE,
  LOBBY_ROOM,
  matchmakeRejection,
  MESSAGE,
  type ClientIntent,
  type CreateOptions,
  type GameMessage,
  type JoinOptions,
  type LobbyListing,
  type LobbyListingMetadata,
  type LobbyMessage,
  type RejectionCode,
  type RejectionMessage,
  type WelcomeMessage,
} from "@universum/protocol/messages";
import { initialRoomState, roomStore } from "#stores/room-store.ts";

/** Vite (dev) and Caddy (production) forward this path to the Room server. */
const COLYSEUS_PATH = "/colyseus";

const sdk = new Client(COLYSEUS_PATH);
let room: Room | null = null;
let seq = 0;

/** A failed create or join, as a Rejection code the screens can show. */
export class JoinError extends Error {
  readonly code: RejectionCode;
  constructor(code: RejectionCode) {
    super(code);
    this.code = code;
  }
}

/** Creates a Room and takes its first Seat; resolves with the Room code. */
export async function createRoom(options: CreateOptions = {}): Promise<string> {
  return attach(() => sdk.create(GAME_ROOM, options));
}

/** Joins the Room with this code; a password Lobby refuses a missing or wrong password (`WRONG_PASSWORD`). */
export async function joinRoom(code: string, password?: string): Promise<string> {
  const options: JoinOptions = password === undefined ? { code } : { code, password };
  return attach(() => sdk.joinById(code, options));
}

let joining: { code: string; done: Promise<string> } | null = null;

/** Joins the Room with this code unless this client is already in it or joining it. */
export async function ensureJoined(code: string): Promise<void> {
  const { code: current, status } = roomStore.getState();
  if (current === code && status !== "lost" && status !== "idle") return;
  if (joining?.code !== code) {
    const done = joinRoom(code).finally(() => {
      if (joining?.done === done) joining = null;
    });
    joining = { code, done };
  }
  await joining.done;
}

export function sendIntent(intent: ClientIntent): void {
  room?.send(MESSAGE.intent, intent);
}

export async function leaveRoom(): Promise<void> {
  const leaving = room;
  room = null;
  roomStore.setState(initialRoomState);
  if (leaving?.connection.isOpen) await leaving.leave();
}

async function attach(connect: () => Promise<Room>): Promise<string> {
  await leaveRoom();
  roomStore.setState({ status: "connecting" });
  let joined: Room;
  try {
    joined = await connect();
  } catch (error) {
    roomStore.setState({ status: "idle" });
    throw new JoinError(error instanceof MatchMakeError ? matchmakeRejection(error) : "INTERNAL");
  }
  // Register every handler before the next await: the server sends on join.
  room = joined;
  joined.onMessage(MESSAGE.welcome, (message: WelcomeMessage) => {
    roomStore.setState({ me: message.playerId });
  });
  joined.onMessage(MESSAGE.lobby, (lobby: LobbyMessage) => {
    roomStore.setState({ lobby });
  });
  joined.onMessage(MESSAGE.game, ({ view, events, now }: GameMessage) => {
    roomStore.setState({ push: { view, events, seq: ++seq, clockOffset: now - Date.now() } });
  });
  joined.onMessage(MESSAGE.rejected, ({ code }: RejectionMessage) => {
    roomStore.setState({ rejection: { code, seq: ++seq } });
  });
  joined.onDrop(() => roomStore.setState({ status: "reconnecting" }));
  joined.onReconnect(() => roomStore.setState({ status: "connected" }));
  joined.onLeave(() => {
    if (room === joined) roomStore.setState({ status: "lost" });
  });
  roomStore.setState({ status: "connected", code: joined.roomId });
  return joined.roomId;
}

type ListingCache = { roomId: string; metadata?: LobbyListingMetadata };

/**
 * Streams the Lobby list: calls `onChange` with every open Lobby whenever it
 * changes, until the returned function stops it. Lobbies whose game has
 * started are never in it (the server unlists them).
 */
export function watchLobbyList(onChange: (lobbies: LobbyListing[]) => void): () => void {
  const lobbies = new Map<string, LobbyListing>();
  const set = ({ roomId, metadata }: ListingCache) => {
    if (metadata) lobbies.set(roomId, { ...metadata, code: roomId });
  };
  let stopped = false;
  let lobbyRoom: Room | null = null;
  const publish = () => {
    if (!stopped) onChange([...lobbies.values()]);
  };

  async function open(): Promise<void> {
    let joined: Room;
    try {
      joined = await sdk.joinOrCreate(LOBBY_ROOM);
    } catch {
      return; // No list (server unreachable): the screen keeps showing it as loading.
    }
    lobbyRoom = joined;
    // Registered before any await: the list arrives on join.
    joined.onMessage(LOBBY_LIST_MESSAGE.rooms, (listings: ListingCache[]) => {
      lobbies.clear();
      listings.forEach(set);
      publish();
    });
    joined.onMessage(LOBBY_LIST_MESSAGE.add, ([, listing]: [string, ListingCache]) => {
      set(listing);
      publish();
    });
    joined.onMessage(LOBBY_LIST_MESSAGE.remove, (code: string) => {
      lobbies.delete(code);
      publish();
    });
    // Stopped while joining (the screen closed): leave again.
    if (stopped) await joined.leave();
  }

  void open();
  return () => {
    stopped = true;
    if (lobbyRoom?.connection.isOpen) void lobbyRoom.leave();
  };
}
