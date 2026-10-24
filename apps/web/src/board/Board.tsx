import { serverNow } from "@universum/protocol/messages";
import { FIELDS, type FieldId } from "@universum/rules/board";
import { LocateFixed, Maximize, Minus, Plus } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useStore } from "zustand";
import { createBoard, type Board as BoardRenderer } from "#board/board.ts";
import { fieldFacts } from "#board/field-facts.ts";
import { Button } from "#components/ui/button.tsx";
import {
  decisionKey,
  fieldTap,
  mySaleOrPick,
  openDecision,
  type OpenDecision,
} from "#decision/decision.ts";
import { selectedPick, singleMarks } from "#pick/pick.ts";
import { AUTO_SELL_WARNING_MS, saleMarks } from "#pick/sale.ts";
import { currentPlayback, gateOpenOf, playbackStore } from "#playback/playback-store.ts";
import { inFlightOf, roomStore } from "#stores/room-store.ts";
import { salePicksFor, uiStore } from "#stores/ui-store.ts";
import { exposeBoard } from "#test-hooks.ts";
import { fieldName, formatCompactMoney, m } from "#text.ts";

/** Elements over the Board (the Field card, the pick tray) that a revealed Field must clear. */
const OBSTACLES = "[data-board-obstacle]";
const ZOOM_STEP = 1.5;

/**
 * This client's Decision: the latest frame, this client and the in-flight lock
 * (spec #72). The one place the Board asks what it may do; `fieldTap` and
 * `decisionKey` read that answer.
 */
function currentDecision(): OpenDecision | null {
  return openDecision(
    playbackStore.getState().frame,
    roomStore.getState().me,
    inFlightOf(roomStore.getState()),
  );
}

/**
 * A tap on the Board: the Decision module says what it does (pick or unpick a
 * Field, open a Field card, or nothing while an intent is in flight), and this
 * applies it to the UI store.
 */
function onFieldTap(id: FieldId | null): void {
  const ui = uiStore.getState();
  const tap = fieldTap(currentDecision(), { inspect: ui.inspect }, id);
  switch (tap.kind) {
    case "selectField":
      ui.selectField(tap.field);
      return;
    case "toggleSale":
      ui.toggleSalePick(tap.key, tap.field);
      return;
    case "choosePick":
      ui.choosePick(tap.key, tap.field);
      return;
    case "ignore":
      return;
  }
}

/**
 * The one React component around the PixiJS Board. It hands the renderer each
 * push's Playback (`currentPlayback()`, the store's one core, so the pawns
 * read the same clock as the dice, the toast and the gate), and the open Field
 * card and Sale picks from `uiStore` (both outside React), sends Field taps to
 * `uiStore`, and holds the camera buttons.
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
      const first = currentPlayback();
      if (first) renderer.update(first);
      /** The decision the marks belong to; a new one starts without focus or inspect mode. */
      let pickKey: string | null = null;

      /** Rings and reveals the focused Field: the open card's, else the checklist row's. */
      const applySelection = () => {
        const { selectedField, pickFocus } = uiStore.getState();
        const id = selectedField ?? pickFocus;
        renderer.setSelected(id);
        cancelAnimationFrame(revealFrame);
        if (id === null) return;
        // After React has laid out the card/tray: pan only if the Field is hidden.
        revealFrame = requestAnimationFrame(() => {
          const obstacles = [...document.querySelectorAll(OBSTACLES)].map((el) =>
            el.getBoundingClientRect(),
          );
          renderer.reveal(id, obstacles);
        });
      };

      /**
       * Marks this client's open pick on the Board, and wakes up again when the
       * last seconds start. The playback store wakes it once when the Decision
       * gate opens (local and server clocks, ADR-0004); until then no marks are shown.
       */
      const syncPick = () => {
        clearTimeout(warningTimer);
        const { frame } = playbackStore.getState();
        const decision = currentDecision();
        // `currentDecision` is the gate check: it is null while the gate is shut,
        // so the key becomes null at the Playback's start and the open card
        // resets at once. It ignores `busy`, so a send never resets the picks.
        const key = decisionKey(decision);
        if (key !== pickKey) {
          pickKey = key;
          uiStore.getState().focusPick(null);
          uiStore.getState().setInspect(false);
          if (uiStore.getState().selectedField !== null) uiStore.getState().selectField(null);
        }
        // Only this client's Sale or pick carries the value; another Player's is
        // a waiting line, which the helper reads as neither.
        const mine = mySaleOrPick(decision);
        if (mine?.kind === "pick") {
          const field = selectedPick(mine.pick, uiStore.getState().singlePick);
          return renderer.setPick(singleMarks(mine.pick, field));
        }
        if (mine?.kind !== "sale") return renderer.setPick(null);
        // A Sale comes from the open gate's view, so that view exists too.
        if (frame === null || frame.view.turnTimer === null) return renderer.setPick(null);
        // The marks count down on the server's clock: only the push's offset applies.
        const { push } = roomStore.getState();
        if (push === null) return renderer.setPick(null);
        const msLeft = frame.view.turnTimer.endsAt - serverNow(push.clockOffset);
        const picks = salePicksFor(uiStore.getState().salePicks, mine.sale.key);
        renderer.setPick(saleMarks(mine.sale, frame.view, picks, msLeft));
        if (msLeft > AUTO_SELL_WARNING_MS) {
          warningTimer = window.setTimeout(syncPick, msLeft - AUTO_SELL_WARNING_MS + 50);
        }
      };
      syncPick();
      unsubscribe.push(
        roomStore.subscribe(
          (state) => state.push,
          (push) => {
            // The store builds a core per push before this subscription runs, so the
            // Board seeks the same Playback the rest of the screen shows.
            const playback = currentPlayback();
            if (push && playback) renderer.update(playback);
            syncPick();
          },
        ),
        // The store wakes at both clocks' opening, so the marks appear with the controls.
        playbackStore.subscribe(gateOpenOf, () => syncPick()),
        uiStore.subscribe((state) => state.salePicks, syncPick),
        uiStore.subscribe((state) => state.singlePick, syncPick),
        uiStore.subscribe((state) => state.selectedField, applySelection, {
          fireImmediately: true,
        }),
        uiStore.subscribe((state) => state.pickFocus, applySelection),
        uiStore.subscribe(
          (state) => state.inspect,
          (on) => {
            renderer.setInspect(on);
            // Leaving inspect mode closes the Field card; the tray returns.
            if (!on && uiStore.getState().selectedField !== null) {
              uiStore.getState().selectField(null);
            }
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
      {/* On a landscape phone the row moves to the right edge (the fit area keeps
          clear of it), so the Board gets the whole height above the top row. */}
      <div className="absolute top-2 right-2 flex gap-2 wide:top-1/2 wide:-translate-y-1/2 wide:flex-col landscape:top-1/2 landscape:-translate-y-1/2 landscape:flex-col">
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
