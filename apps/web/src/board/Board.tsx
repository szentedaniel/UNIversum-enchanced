import { FIELDS } from "@universum/rules/board";
import { useEffect, useRef } from "react";
import { createBoard, type Board as BoardRenderer } from "#board/board.ts";
import { roomStore } from "#stores/room-store.ts";
import { uiStore } from "#stores/ui-store.ts";
import { exposeBoard } from "#test-hooks.ts";
import { fieldName } from "#text.ts";

/**
 * The one React component around the PixiJS Board. It feeds the renderer
 * every push from `roomStore` (outside React) and sends Field taps to `uiStore`.
 */
export function Board() {
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return undefined;
    let board: BoardRenderer | null = null;
    let unsubscribe = () => {};
    let cancelled = false;

    async function mount(element: HTMLElement) {
      const created = await createBoard(element, {
        fieldLabel: (id) => fieldName(FIELDS[id]?.key ?? ""),
        onFieldTap: (id) => uiStore.getState().selectField(id),
      });
      if (cancelled) {
        created.destroy();
        return;
      }
      board = created;
      const first = roomStore.getState().push;
      if (first) created.update(first.view, []);
      unsubscribe = roomStore.subscribe(
        (state) => state.push,
        (push) => {
          if (push) created.update(push.view, push.events);
        },
      );
      exposeBoard(created);
    }
    void mount(host);

    return () => {
      cancelled = true;
      unsubscribe();
      exposeBoard(null);
      board?.destroy();
    };
  }, []);

  return <div ref={hostRef} className="board" data-testid="board" />;
}
