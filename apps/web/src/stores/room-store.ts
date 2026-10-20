/**
 * What the server last told this client. Only the connection module
 * (`#connection.ts`) writes it; screens and the Board read and subscribe.
 */
import type { LobbyMessage, RejectionCode } from "@universum/protocol/messages";
import type { GameEvent, PlayerId, PublicView } from "@universum/rules";
import { subscribeWithSelector } from "zustand/middleware";
import { createStore } from "zustand/vanilla";

export type ConnectionStatus = "idle" | "connecting" | "connected" | "reconnecting" | "lost";

/** One full-view push from the server: the view and the events that led to it. */
export type Push = {
  view: PublicView;
  /** To animate in order; empty for the first view of a game. */
  events: readonly GameEvent[];
  /** Grows with every push, so a push with no events still differs from the last. */
  seq: number;
  /** The server's clock minus this client's, when the push arrived (for the Turn timer). */
  clockOffset: number;
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
  /** The server's clock minus this client's, when the last Lobby message arrived (for held Seats' countdowns). */
  lobbyClockOffset: number;
  /** `lost` because this Guest took the Seat in another tab (it must not try to win it back). */
  takenElsewhere: boolean;
};

export const initialRoomState: RoomState = {
  status: "idle",
  code: null,
  me: null,
  lobby: null,
  push: null,
  rejection: null,
  lobbyClockOffset: 0,
  takenElsewhere: false,
};

export const roomStore = createStore<RoomState>()(subscribeWithSelector(() => initialRoomState));
