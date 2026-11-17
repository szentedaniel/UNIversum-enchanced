/**
 * The one connection to the Room server. It owns the `@colyseus/sdk` client,
 * feeds `roomStore` every push and Rejection, and streams the Lobby list
 * (`watchLobbyList`), which lives outside the store. Screens call these
 * functions and read the store.
 *
 * Reconnecting (spec: Client → State): a short drop is the SDK's own
 * reconnection by `reconnectionToken`; anything else (server restart, the SDK
 * giving up, a drop in the first 5 s) rejoins the same Seat by Guest token,
 * with back-off and jitter, until it works, the Room is gone or the Guest
 * goes home. A reload or a new tab rejoins by Guest token too (`ensureJoined`).
 * The status is `connected | reconnecting | lost`, and a reconnected client
 * never shows an older `version` than it had.
 *
 * A spectator (spec #179) joins by Room code with `watch: true`: no Seat, no
 * Guest token and no game intents. Its drop is not held by the Room, so it
 * rejoins the same way, by Room code, and gives up with the same lost state.
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
  type ChatEvent,
  type ChatId,
  type ClientChat,
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
import { chatStore } from "#stores/chat-store.ts";
import {
  isSpectator,
  markIntentSent,
  receiveLobby,
  receivePush,
  receiveRejection,
  reset,
  roomStore,
} from "#stores/room-store.ts";

/** Vite (dev) and Caddy (production) forward this path to the Room server. */
const COLYSEUS_PATH = "/colyseus";

const sdk = new Client(COLYSEUS_PATH);
let room: Room | null = null;
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

/**
 * The options of a join. A spectator asks for no Seat, so it carries no Guest
 * token (there is no Seat to give back) and never touches the one a Player in
 * another tab uses (spec #179, decision 3).
 */
const joinOptions = (code: string, password?: string, watch = false): JoinOptions => ({
  code,
  ...(password === undefined ? {} : { password }),
  ...(watch ? { watch: true } : { guestToken: guestToken() }),
});

/**
 * The role a join takes, as `attach`'s `spectator` flag: a Player takes a
 * Seat (or gets its own back), a Spectator none (spec #179).
 */
const AS_PLAYER = false;
const AS_SPECTATOR = true;

/** Creates a Room and takes its first Seat; resolves with the Room code. */
export async function createRoom(options: CreateOptions = {}): Promise<string> {
  return attach(() => sdk.create(GAME_ROOM, { ...options, guestToken: guestToken() }), AS_PLAYER);
}

/**
 * Joins the Room with this code; a password Lobby refuses a missing or wrong
 * password (`WRONG_PASSWORD`). If this browser already has a Seat there, it
 * gets that Seat back, in a running game too.
 */
export async function joinRoom(code: string, password?: string): Promise<string> {
  return attach(() => sdk.joinById(code, joinOptions(code, password)), AS_PLAYER);
}

/**
 * Watches the Room with this code (spec #179): the same Room, password gate
 * and pushes as a Player, with no Seat, no Guest token and no game intents.
 * A password Room asks for its password as a Seat does. A dropped spectator
 * rejoins by Room code, not by token (see `tryRejoin`).
 */
export async function watchRoom(code: string, password?: string): Promise<string> {
  return attach(() => sdk.joinById(code, joinOptions(code, password, true)), AS_SPECTATOR);
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
  // A spectator has no Seat to act for; the Room rejects it too (presentation guard).
  if (isSpectator(roomStore.getState())) return;
  // No optimistic UI: the lock is set even with no Room attached (the latest
  // answer is 0 then); the push a rejoin brings has a later `seq` and clears it.
  markIntentSent();
  room?.send(MESSAGE.intent, intent);
}

/**
 * Sends one catalogue quick-chat id to the Room; without a Room it does
 * nothing. Chat is not an intent (ADR-0001): it changes no game state, so it
 * sets no in-flight lock, and the Room's flood ladder answers a burst.
 */
export function sendChat(id: ChatId): void {
  room?.send(MESSAGE.chat, { id } satisfies ClientChat);
}

export async function leaveRoom(): Promise<void> {
  clearTimeout(rejoinTimer);
  const leaving = room;
  room = null;
  reset();
  chatStore.getState().reset();
  if (leaving?.connection.isOpen) await leaving.leave();
}

/** `spectator` is the join's role: no Seat, rejoined by Room code (spec #179). */
async function attach(connect: () => Promise<Room>, spectator: boolean): Promise<string> {
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
  listen(joined, spectator);
  return joined.roomId;
}

/** Makes `joined` this client's Room: every handler, registered before the next await (the server sends on join). */
function listen(joined: Room, spectator: boolean): void {
  room = joined;
  joined.reconnection.maxRetries = RECONNECT.sdkRetries;
  joined.reconnection.backoff = (attempt, delay) =>
    backoffDelay(attempt, delay, RECONNECT.sdk.maxMs);
  const mine = () => room === joined;
  joined.onMessage(MESSAGE.welcome, (message: WelcomeMessage) => {
    if (mine()) roomStore.setState({ me: message.playerId });
  });
  joined.onMessage(MESSAGE.lobby, (lobby: LobbyMessage) => {
    if (mine()) receiveLobby(lobby, Date.now());
  });
  joined.onMessage(MESSAGE.game, (push: GameMessage) => {
    if (mine()) receivePush(push, Date.now());
  });
  joined.onMessage(MESSAGE.chat, (event: ChatEvent) => {
    if (mine()) chatStore.getState().show(event.seat, event.id, Date.now());
  });
  joined.onMessage(MESSAGE.rejected, ({ code }: RejectionMessage) => {
    if (mine()) receiveRejection(code);
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
      // A Seat was taken back elsewhere: a spectator holds no Seat, so it
      // never sees this code and keeps its own waiting to come back.
      roomStore.setState({ status: "lost", takenElsewhere: true });
    } else {
      rejoin(joined.roomId, 1, spectator);
    }
  });
  roomStore.setState({
    status: "connected",
    code: joined.roomId,
    takenElsewhere: false,
    role: spectator ? "spectator" : "player",
  });
}

/**
 * Rejoins by Room code, attempt `attempt` (1, 2, …), keeping what the screen
 * shows meanwhile: a Player by Guest token (its Seat), a spectator with the
 * watch flag (there is no Seat or token to hold).
 */
function rejoin(code: string, attempt: number, spectator: boolean): void {
  roomStore.setState({ status: "reconnecting" });
  clearTimeout(rejoinTimer);
  rejoinTimer = setTimeout(
    () => void tryRejoin(code, attempt, spectator),
    backoffDelay(attempt, RECONNECT.guest.baseMs, RECONNECT.guest.maxMs),
  );
}

async function tryRejoin(code: string, attempt: number, spectator: boolean): Promise<void> {
  const stillWanted = () => room === null && roomStore.getState().code === code;
  if (!stillWanted()) return;
  let joined: Room;
  try {
    joined = await sdk.joinById(code, joinOptions(code, undefined, spectator));
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
      rejoin(code, attempt + 1, spectator);
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
  listen(joined, spectator);
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
