/**
 * Test-only hooks for Playwright: the Board's `fieldCenter(id)`, camera,
 * current view and pick marks, and the room store. `showView` shows a made-up
 * view as if the server had pushed it, for states a random game can't be
 * steered into (a Sale). `TEST_HOOKS_ENABLED` is a build-time
 * constant (see vite.config.ts): false in production builds, so this code is
 * compiled out.
 */
import { serverNow } from "@universum/protocol/messages";
import type { GameEvent, PlayerId, PublicView, Reveal } from "@universum/rules";
import type { FieldId } from "@universum/rules/board";
import type { Board } from "#board/board.ts";
import { gateOpenOf, playbackStore, type PlaybackGate } from "#playback/playback-store.ts";
import { markIntentSent, receivePush, roomStore, type RoomState } from "#stores/room-store.ts";

declare const TEST_HOOKS_ENABLED: boolean;

export type TestHooks = {
  fieldCenter(id: FieldId): { x: number; y: number };
  /** Where the Board last placed a pawn (viewport CSS px), or `null` before its first placement. */
  pawn(player: PlayerId): { x: number; y: number } | null;
  camera(): ReturnType<Board["camera"]>;
  view(): Board["view"];
  room(): RoomState;
  /** Whether the latest push's decision is open (local Playback and `actsAfter`, ADR-0004). */
  playback(): PlaybackGate;
  /**
   * The server's clock estimated from this client's, for the latest push's
   * `clockOffset` (or the Lobby's before the first push). Specs inside
   * `page.evaluate` can't import `serverNow`; this is the one copy.
   */
  serverNow(): number;
  pick(): Board["pick"];
  /**
   * Leaves an intent in flight: the lock is set as `sendIntent` sets it and no
   * answer comes, so a Board tap can be checked while a Sale or pick is busy.
   * A `showView` push clears it, like the server's answer.
   */
  holdIntent(): void;
  /**
   * Shows a made-up view as the server's push would, optionally with the
   * events of the push that led to it and one reveal per event; without them
   * the view is shown at once. It takes the next `seq`, so it clears the
   * in-flight lock.
   */
  showView(view: PublicView, events?: readonly GameEvent[], reveals?: readonly Reveal[]): void;
};

declare global {
  interface Window {
    universumTest?: TestHooks;
  }
}

export function exposeBoard(board: Board | null): void {
  if (!TEST_HOOKS_ENABLED) return;
  window.universumTest = board
    ? {
        fieldCenter: (id) => board.fieldCenter(id),
        pawn: (player) => board.pawn(player),
        camera: () => board.camera(),
        view: () => board.view,
        room: () => roomStore.getState(),
        playback: () => {
          const state = playbackStore.getState();
          const { frame } = state;
          return {
            seq: frame?.seq ?? null,
            gateOpen: gateOpenOf(state),
            shownTurn: frame?.shownTurn ?? null,
          };
        },
        serverNow: () => {
          const { push, lobbyClockOffset } = roomStore.getState();
          return serverNow(push?.clockOffset ?? lobbyClockOffset);
        },
        pick: () => board.pick,
        holdIntent: markIntentSent,
        showView(view, events = [], reveals = []) {
          const receivedAt = Date.now();
          const { push } = roomStore.getState();
          // As if the server sent it now: the clock estimate stays this push's.
          receivePush(
            { view, events, reveals, now: serverNow(push?.clockOffset ?? 0, receivedAt) },
            receivedAt,
          );
        },
      }
    : undefined;
}
