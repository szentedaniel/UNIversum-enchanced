import { FIELDS, type FieldId } from "@universum/rules/board";
import { LocateFixed, Maximize, Minus, Plus } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useStore } from "zustand";
import { createBoard, type Board as BoardRenderer } from "#board/board.ts";
import { fieldFacts } from "#board/field-facts.ts";
import { Button } from "#components/ui/button.tsx";
import { selectedPick, singleMarks, singlePickFor } from "#pick/pick.ts";
import { AUTO_SELL_WARNING_MS, saleFor, saleMarks } from "#pick/sale.ts";
import { roomStore } from "#stores/room-store.ts";
import { salePicksFor, uiStore } from "#stores/ui-store.ts";
import { exposeBoard } from "#test-hooks.ts";
import { fieldName, formatCompactMoney, m } from "#text.ts";

/** Elements over the Board (the Field card, the pick tray) that a revealed Field must clear. */
const OBSTACLES = "[data-board-obstacle]";
const ZOOM_STEP = 1.5;

/** This client's open Sale, from the latest push. */
function currentSale() {
  const { push, me } = roomStore.getState();
  return push ? saleFor(push.view, me) : null;
}

/** This client's open Doubler or Erasmus pick, from the latest push. */
function currentPick() {
  const { push, me } = roomStore.getState();
  return push ? singlePickFor(push.view, me) : null;
}

/**
 * A tap on the Board: during this client's pick it selects the (pickable)
 * Field and never commits; otherwise it opens the Field card.
 */
function onFieldTap(id: FieldId | null): void {
  const sale = currentSale();
  if (sale) {
    if (id !== null) uiStore.getState().toggleSalePick(sale.key, id);
    return;
  }
  const pick = currentPick();
  if (pick) {
    if (id !== null) uiStore.getState().choosePick(pick.key, id);
    return;
  }
  uiStore.getState().selectField(id);
}

/**
 * The one React component around the PixiJS Board. It feeds the renderer
 * every push from `roomStore` and the open Field card and Sale picks from
 * `uiStore` (both outside React), sends Field taps to `uiStore`, and holds the
 * camera buttons.
 *
 * The camera fits the Board into `.board-fit-area`: the Board minus the
 * `--board-inset-*` space that the screen reserves for these buttons and the
 * card or tray (set on an ancestor, see screens/Game.tsx).
 */
export function Board() {
  const hostRef = useRef<HTMLDivElement>(null);
  const fitRef = useRef<HTMLDivElement>(null);
  const [board, setBoard] = useState<BoardRenderer | null>(null);
  const follow = useStore(uiStore, (s) => s.follow);

  useEffect(() => {
    const host = hostRef.current;
    const fitArea = fitRef.current;
    if (!host || !fitArea) return undefined;
    let created: BoardRenderer | null = null;
    const unsubscribe: (() => void)[] = [];
    let cancelled = false;
    let revealFrame = 0;
    let warningTimer = 0;

    async function mount(element: HTMLElement, area: HTMLElement) {
      const renderer = await createBoard(element, area, {
        fieldLabel: (id) => fieldName(FIELDS[id]?.key ?? ""),
        fieldNote(view, id) {
          const rent = fieldFacts(view, id)?.rent ?? null;
          return rent === null ? null : formatCompactMoney(rent);
        },
        onFieldTap,
        onFollowChange: (on) => uiStore.getState().setFollow(on),
      });
      if (cancelled) {
        renderer.destroy();
        return;
      }
      created = renderer;
      const first = roomStore.getState().push;
      if (first) renderer.update(first.view, []);

      /** Marks this client's open pick on the Board, and wakes up again when the last seconds start. */
      const syncPick = () => {
        clearTimeout(warningTimer);
        const { push } = roomStore.getState();
        const sale = currentSale();
        const pick = currentPick();
        if (!push || (!sale && !pick)) return renderer.setPick(null);
        // The tray replaces the Field card during a pick.
        if (uiStore.getState().selectedField !== null) uiStore.getState().selectField(null);
        if (pick) {
          const field = selectedPick(pick, uiStore.getState().singlePick);
          return renderer.setPick(singleMarks(pick, field));
        }
        if (!sale || push.view.turnTimer === null) return renderer.setPick(null);
        const msLeft = push.view.turnTimer.endsAt - (Date.now() + push.clockOffset);
        const picks = salePicksFor(uiStore.getState().salePicks, sale.key);
        renderer.setPick(saleMarks(sale, push.view, picks, msLeft));
        if (msLeft > AUTO_SELL_WARNING_MS) {
          warningTimer = window.setTimeout(syncPick, msLeft - AUTO_SELL_WARNING_MS + 50);
        }
      };
      syncPick();
      unsubscribe.push(
        roomStore.subscribe(
          (state) => state.push,
          (push) => {
            if (push) renderer.update(push.view, push.events);
            syncPick();
          },
        ),
        uiStore.subscribe((state) => state.salePicks, syncPick),
        uiStore.subscribe((state) => state.singlePick, syncPick),
        uiStore.subscribe(
          (state) => state.selectedField,
          (id) => {
            renderer.setSelected(id);
            cancelAnimationFrame(revealFrame);
            if (id === null) return;
            // After React has laid out the card: pan only if the Field is hidden.
            revealFrame = requestAnimationFrame(() => {
              const obstacles = [...document.querySelectorAll(OBSTACLES)].map((el) =>
                el.getBoundingClientRect(),
              );
              renderer.reveal(id, obstacles);
            });
          },
          { fireImmediately: true },
        ),
        uiStore.subscribe(
          (state) => state.follow,
          (on) => renderer.setFollow(on),
          { fireImmediately: true },
        ),
      );
      exposeBoard(renderer);
      setBoard(renderer);
    }
    void mount(host, fitArea);

    return () => {
      cancelled = true;
      cancelAnimationFrame(revealFrame);
      clearTimeout(warningTimer);
      for (const stop of unsubscribe) stop();
      exposeBoard(null);
      created?.destroy();
    };
  }, []);

  return (
    <div className="board" data-testid="board">
      <div ref={hostRef} className="board-canvas" />
      <div ref={fitRef} className="board-fit-area" aria-hidden="true" />
      <div className="absolute top-2 right-2 flex gap-2 wide:top-1/2 wide:-translate-y-1/2 wide:flex-col">
        <Button
          variant="plain"
          size="icon"
          aria-label={m.camera_zoom_in()}
          disabled={!board}
          onClick={() => board?.zoomBy(ZOOM_STEP)}
        >
          <Plus strokeWidth={3} />
        </Button>
        <Button
          variant="plain"
          size="icon"
          aria-label={m.camera_zoom_out()}
          disabled={!board}
          onClick={() => board?.zoomBy(1 / ZOOM_STEP)}
        >
          <Minus strokeWidth={3} />
        </Button>
        <Button
          variant="plain"
          size="icon"
          aria-label={m.camera_fit()}
          disabled={!board}
          onClick={() => board?.fit()}
        >
          <Maximize size={20} strokeWidth={3} />
        </Button>
        <Button
          variant={follow ? "default" : "plain"}
          size="icon"
          aria-label={m.camera_follow()}
          aria-pressed={follow}
          disabled={!board}
          onClick={() => uiStore.getState().setFollow(!follow)}
        >
          <LocateFixed size={20} strokeWidth={3} />
        </Button>
      </div>
    </div>
  );
}
