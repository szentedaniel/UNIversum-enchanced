/**
 * Test-only hooks for Playwright: the Board's `fieldCenter(id)`, camera,
 * current view and pick marks, and the room store. `showView` shows a made-up
 * view as if the server had pushed it, for states a random game can't be
 * steered into (a Sale). `TEST_HOOKS_ENABLED` is a build-time
 * constant (see vite.config.ts): false in production builds, so this code is
 * compiled out.
 */
import type { PublicView } from "@universum/rules";
import type { FieldId } from "@universum/rules/board";
import type { Board } from "#board/board.ts";
import { playbackStore, type PlaybackState } from "#playback/playback-store.ts";
import { roomStore, type RoomState } from "#stores/room-store.ts";

declare const TEST_HOOKS_ENABLED: boolean;

export type TestHooks = {
  fieldCenter(id: FieldId): { x: number; y: number };
  camera(): ReturnType<Board["camera"]>;
  view(): Board["view"];
  room(): RoomState;
  /** Whether the latest push's decision is open (local Playback and `actsAfter`, ADR-0004). */
  playback(): PlaybackState;
  pick(): Board["pick"];
  showView(view: PublicView): void;
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
        camera: () => board.camera(),
        view: () => board.view,
        room: () => roomStore.getState(),
        playback: () => playbackStore.getState(),
        pick: () => board.pick,
        showView(view) {
          const { push } = roomStore.getState();
          roomStore.setState({
            push: {
              view,
              events: [],
              seq: (push?.seq ?? 0) + 1,
              clockOffset: push?.clockOffset ?? 0,
              receivedAt: Date.now(),
            },
          });
        },
      }
    : undefined;
}
