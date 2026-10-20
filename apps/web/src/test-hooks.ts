/**
 * Test-only hooks for Playwright: the Board's `fieldCenter(id)`, camera and
 * current view, and the room store. `TEST_HOOKS_ENABLED` is a build-time
 * constant (see vite.config.ts): false in production builds, so this code is
 * compiled out.
 */
import type { FieldId } from "@universum/rules/board";
import type { Board } from "#board/board.ts";
import { roomStore } from "#stores/room-store.ts";

declare const TEST_HOOKS_ENABLED: boolean;

export type TestHooks = {
  fieldCenter(id: FieldId): { x: number; y: number };
  camera(): ReturnType<Board["camera"]>;
  view(): Board["view"];
  room(): ReturnType<typeof roomStore.getState>;
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
      }
    : undefined;
}
