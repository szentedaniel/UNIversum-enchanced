/**
 * The one connection to the Room server, and the only writer of `roomStore`.
 * It owns the `@colyseus/sdk` client; screens call these functions and read
 * the store. It also streams the Lobby list (`watchLobbyList`), which lives
 * outside the store.
 *
 * Reconnecting (spec: Client → State): a short drop is the SDK's own
 * reconnection by `reconnectionToken`; anything else (server restart, the SDK
 * giving up, a drop in the first 5 s) rejoins the same Seat by Guest token,
 * with back-off and jitter, until it works, the Room is gone or the Guest
 * goes home. A reload or a new tab rejoins by Guest token too (`ensureJoined`).
 * The status is `connected | reconnecting | lost`, and a reconnected client
 * never shows an older `version` than it had.
 */
import { Client, CloseCode, MatchMakeError, type Room } from "@colyseus/sdk";
import {
  CLOSE_CODE,
  GAME_ROOM,
  LOBBY_LIST_MESSAGE,
  LOBBY_ROOM,
  matchmakeRefusal,
  MESSAGE,
  RECONNECT,
  backoffDelay,
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
import { guestToken } from "#guest-token.ts";
import { answeredAtOf, initialRoomState, roomStore } from "#stores/room-store.ts";

/** Vite (dev) and Caddy (production) forward this path to the Room server. */
const COLYSEUS_PATH = "/colyseus";

const sdk = new Client(COLYSEUS_PATH);
let room: Room | null = null;
let seq = 0;
let rejoinTimer: ReturnType<typeof setTimeout> | undefined;

/**
 * A failed create or join, as a Rejection code the screens can show, and
 * for a refusal with a wait (`RATE_LIMITED`, `PASSWORD_LOCKED`) the seconds
 * until the button may be pressed again.
 */
export class JoinError extends Error {
  readonly code: RejectionCode;
  readonly retryAfter: number | null;
  constructor(code: RejectionCode, retryAfter: number | null = null) {
    super(code);
    this.code = code;
    this.retryAfter = retryAfter;
  }
}

const rejectionOf = (error: unknown): RejectionCode =>
  error instanceof MatchMakeError ? matchmakeRefusal(error).code : "INTERNAL";

const joinOptions = (code: string, password?: string): JoinOptions =>
  password === undefined
    ? { code, guestToken: guestToken() }
    : { code, password, guestToken: guestToken() };

/** Creates a Room and takes its first Seat; resolves with the Room code. */
export async function createRoom(options: CreateOptions = {}): Promise<string> {
  return attach(() => sdk.create(GAME_ROOM, { ...options, guestToken: guestToken() }));
}

/**
 * Joins the Room with this code; a password Lobby refuses a missing or wrong
 * password (`WRONG_PASSWORD`). If this browser already has a Seat there, it
 * gets that Seat back, in a running game too.
 */
export async function joinRoom(code: string, password?: string): Promise<string> {
  return attach(() => sdk.joinById(code, joinOptions(code, password)));
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
  // No optimistic UI: the lock is set even with no Room attached (`answeredAtOf`
  // is 0 then); the push a rejoin brings has a later `seq` and clears it.
  roomStore.setState({ sentAt: answeredAtOf(roomStore.getState()) });
  room?.send(MESSAGE.intent, intent);
}

export async function leaveRoom(): Promise<void> {
  clearTimeout(rejoinTimer);
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
    if (!(error instanceof MatchMakeError)) throw new JoinError("INTERNAL");
    const { code, retryAfter } = matchmakeRefusal(error);
    throw new JoinError(code, retryAfter);
  }
  listen(joined);
  return joined.roomId;
}

/** Makes `joined` this client's Room: every handler, registered before the next await (the server sends on join). */
function listen(joined: Room): void {
  room = joined;
  joined.reconnection.maxRetries = RECONNECT.sdkRetries;
  joined.reconnection.backoff = (attempt, delay) =>
    backoffDelay(attempt, delay, RECONNECT.sdk.maxMs);
  const mine = () => room === joined;
  joined.onMessage(MESSAGE.welcome, (message: WelcomeMessage) => {
    if (mine()) roomStore.setState({ me: message.playerId });
  });
  joined.onMessage(MESSAGE.lobby, (lobby: LobbyMessage) => {
    if (mine()) roomStore.setState({ lobby, lobbyClockOffset: lobby.now - Date.now() });
  });
  joined.onMessage(MESSAGE.game, ({ view, events, now }: GameMessage) => {
    if (!mine()) return;
    // Never back to an older state after a reconnect (spec: Client → State).
    const last = roomStore.getState().push;
    if (last && view.version < last.view.version) return;
    const receivedAt = Date.now();
    roomStore.setState({
      push: { view, events, seq: ++seq, clockOffset: now - receivedAt, receivedAt },
    });
  });
  joined.onMessage(MESSAGE.rejected, ({ code }: RejectionMessage) => {
    if (mine()) roomStore.setState({ rejection: { code, seq: ++seq } });
  });
  joined.onDrop(() => {
    if (mine()) roomStore.setState({ status: "reconnecting" });
  });
  joined.onReconnect(() => {
    if (mine()) roomStore.setState({ status: "connected" });
  });
  joined.onLeave((code) => {
    if (!mine()) return;
    room = null;
    if (code === CloseCode.CONSENTED) {
      // The server closed the Room (the game ended long ago).
      roomStore.setState({ status: "lost" });
    } else if (code === CLOSE_CODE.seatTaken) {
      roomStore.setState({ status: "lost", takenElsewhere: true });
    } else {
      rejoin(joined.roomId, 1);
    }
  });
  roomStore.setState({ status: "connected", code: joined.roomId, takenElsewhere: false });
}

/** Rejoins the Seat by Guest token, attempt `attempt` (1, 2, …), keeping what the screen shows meanwhile. */
function rejoin(code: string, attempt: number): void {
  roomStore.setState({ status: "reconnecting" });
  clearTimeout(rejoinTimer);
  rejoinTimer = setTimeout(
    () => void tryRejoin(code, attempt),
    backoffDelay(attempt, RECONNECT.guest.baseMs, RECONNECT.guest.maxMs),
  );
}

async function tryRejoin(code: string, attempt: number): Promise<void> {
  const stillWanted = () => room === null && roomStore.getState().code === code;
  if (!stillWanted()) return;
  let joined: Room;
  try {
    joined = await sdk.joinById(code, joinOptions(code));
  } catch (error) {
    if (!stillWanted()) return;
    const rejection = rejectionOf(error);
    // A server that is down (INTERNAL), busy, rate-limiting or still restoring
    // its Rooms is tried again (the back-off soon outlasts any short `retryAfter`).
    if (
      rejection === "INTERNAL" ||
      rejection === "SERVER_BUSY" ||
      rejection === "RATE_LIMITED" ||
      (rejection === "ROOM_NOT_FOUND" && attempt < RECONNECT.notFoundTries)
    ) {
      rejoin(code, attempt + 1);
    } else {
      roomStore.setState({ status: "lost" });
    }
    return;
  }
  if (!stillWanted()) {
    // The Guest went home (or elsewhere) meanwhile.
    void joined.leave();
    return;
  }
  listen(joined);
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
