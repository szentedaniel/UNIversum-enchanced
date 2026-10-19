/**
 * The one connection to the Room server, and the only writer of `roomStore`.
 * It owns the `@colyseus/sdk` client; screens call these functions and read
 * the store. Reconnection by `reconnectionToken` and Guest token lands here (#35).
 */
import { Client, MatchMakeError, type Room } from "@colyseus/sdk";
import {
  GAME_ROOM,
  MESSAGE,
  type ClientIntent,
  type CreateOptions,
  type GameMessage,
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

/** Joins the Room with this code. */
export async function joinRoom(code: string): Promise<string> {
  return attach(() => sdk.joinById(code, {}));
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
    throw new JoinError(error instanceof MatchMakeError ? "ROOM_NOT_FOUND" : "INTERNAL");
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
