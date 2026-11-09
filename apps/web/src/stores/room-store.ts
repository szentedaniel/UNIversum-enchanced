/**
 * What the server last told this client, and the one counter behind it. The
 * connection module (`#connection.ts`) writes pushes, Rejections and the
 * in-flight lock through the functions below; the e2e test hooks fake the same
 * writes, so a made-up push cannot collide with a real answer. Screens and the
 * Board read and subscribe.
 */
import type { LobbyMessage, RejectionCode } from "@universum/protocol/messages";
import type { GameEvent, PlayerId, PublicView, Reveal } from "@universum/rules";
import { subscribeWithSelector } from "zustand/middleware";
import { createStore } from "zustand/vanilla";

export type ConnectionStatus = "idle" | "connecting" | "connected" | "reconnecting" | "lost";

/** One full-view push from the server: the view and the events that led to it. */
export type Push = {
  view: PublicView;
  /** To animate in order; empty for the first view of a game. */
  events: readonly GameEvent[];
  /** One board snapshot per event, in the same order (ADR-0005); empty without events. */
  reveals: readonly Reveal[];
  /** Grows with every push, so a push with no events still differs from the last. */
  seq: number;
  /** The server's clock minus this client's, when the push arrived (for the Turn timer). */
  clockOffset: number;
  /** This client's clock when the push arrived: its local Playback starts here. */
  receivedAt: number;
};

export type RoomState = {
  status: ConnectionStatus;
  /** The Room code of the Room this client is in. */
  code: string | null;
  /** This client's own public Player id. */
  me: PlayerId | null;
  /** The Seats while the Room is a Lobby. */
  lobby: LobbyMessage | null;
  /** The latest game push; `null` until the game starts. */
  push: Push | null;
  /** The latest Rejection of one of this client's intents. */
  rejection: { code: RejectionCode; seq: number } | null;
  /** The latest answered `seq` when this client sent its last intent; see `inFlightOf`. */
  sentAt: number | null;
  /** The server's clock minus this client's, when the last Lobby message arrived (for held Seats' countdowns). */
  lobbyClockOffset: number;
  /** `lost` because this Guest took the Seat in another tab (it must not try to win it back). */
  takenElsewhere: boolean;
};

const initialRoomState: RoomState = {
  status: "idle",
  code: null,
  me: null,
  lobby: null,
  push: null,
  rejection: null,
  sentAt: null,
  lobbyClockOffset: 0,
  takenElsewhere: false,
};

/**
 * The one counter pushes and Rejections share, so the newer of the two is the
 * later answer and neither can take the other's `seq`.
 */
let seq = 0;

/** The latest `seq` the server has answered at. */
const answeredAtOf = (state: RoomState): number =>
  Math.max(state.push?.seq ?? 0, state.rejection?.seq ?? 0);

/** One full-view push as the server sent it, with the server's clock at the send. */
type ReceivedPush = {
  view: PublicView;
  events: readonly GameEvent[];
  reveals: readonly Reveal[];
  now: number;
};

/**
 * A push arrived: keeps the shown view when the server's is older (spec:
 * Client → State), otherwise puts it up with the next `seq` and this client's
 * clock offset. An ignored push spends no `seq`.
 */
export function receivePush(
  { view, events, reveals, now }: ReceivedPush,
  receivedAt: number,
): void {
  const last = roomStore.getState().push;
  if (last && view.version < last.view.version) return;
  roomStore.setState({
    push: { view, events, reveals, seq: ++seq, clockOffset: now - receivedAt, receivedAt },
  });
}

/** A Rejection of one of this client's intents arrived: it answers with the next `seq`. */
export function receiveRejection(code: RejectionCode): void {
  roomStore.setState({ rejection: { code, seq: ++seq } });
}

/**
 * The in-flight lock's one write: `sentAt` at the latest answered `seq`. The
 * connection applies it before sending an intent; the `holdIntent` test hook
 * applies it to hold an intent the server never answered.
 */
export function markIntentSent(): void {
  roomStore.setState({ sentAt: answeredAtOf(roomStore.getState()) });
}

/** Back to the initial state: the latest answer, the lock and the counter go with it. */
export function reset(): void {
  seq = 0;
  roomStore.setState(initialRoomState);
}

/**
 * The in-flight lock ("No optimistic UI"): this client sent an intent and no
 * push or Rejection with a later `seq` has arrived. The two share one counter,
 * so a single comparison with `answeredAtOf` covers both; a `reset` clears the
 * lock too.
 */
export const inFlightOf = (state: RoomState): boolean =>
  state.sentAt !== null && answeredAtOf(state) <= state.sentAt;

export const roomStore = createStore<RoomState>()(subscribeWithSelector(() => initialRoomState));
