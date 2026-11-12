/**
 * The phone Game's bottom card (spec #184, story 4): how tall the card may grow
 * and how far the on-screen keyboard lifts it. `Game.tsx` wraps the tray, the
 * Turn card and the Field card in one element and applies these numbers, so
 * the card scrolls instead of covering the Board; the pure part is pinned at
 * fixed viewports by test/tray-layout.test.ts.
 */
import { useEffect, useState } from "react";

/**
 * The height Game.tsx's phone layout reserves at the Board's bottom for the
 * card (`[--board-inset-bottom:14rem]` on the Board's wrapper).
 */
export const CARD_RESERVE_PX = 14 * 16;

/** The most of the visible height the card may take, keyboard or not. */
export const CARD_HEIGHT_SHARE = 0.45;

/** A visual viewport as `window.visualViewport` reports it. */
export type VisualArea = { height: number; offsetTop: number; scale: number };

/** How much of the screen the card may use, and how far the keyboard lifts it. */
export type CardLayout = {
  /** Px of the layout viewport the on-screen keyboard covers at the bottom. */
  keyboard: number;
  /** The card's height ceiling in px. */
  maxHeight: number;
};

/**
 * The px the on-screen keyboard covers at the bottom of the layout viewport.
 * A pinch-zoomed visual viewport is smaller too, but that is zoom, not a
 * keyboard, so it never lifts the card.
 */
export function keyboardInset(layoutHeight: number, visual: VisualArea | null): number {
  if (visual === null || visual.scale > 1) return 0;
  return Math.max(0, Math.round(layoutHeight - visual.height - visual.offsetTop));
}

/**
 * The card's height ceiling: the Board's reserve, and never more than a share
 * of the height the keyboard leaves visible. The tray scrolls inside it.
 */
export function cardMaxHeight(viewportHeight: number, keyboard = 0): number {
  const visible = viewportHeight - keyboard;
  return Math.max(0, Math.min(CARD_RESERVE_PX, Math.floor(visible * CARD_HEIGHT_SHARE)));
}

/** What the browser reports right now; zero before layout runs (no window). */
function readCardLayout(): CardLayout {
  if (typeof window === "undefined") return { keyboard: 0, maxHeight: CARD_RESERVE_PX };
  const height = window.innerHeight;
  const keyboard = keyboardInset(height, window.visualViewport);
  return { keyboard, maxHeight: cardMaxHeight(height, keyboard) };
}

/**
 * The Game screen's card layout, kept current as the viewport, the orientation
 * and the on-screen keyboard change. `visualViewport`'s own `resize` and
 * `scroll` are what catch the keyboard; `window`'s `resize` catches rotation.
 */
export function useCardLayout(): CardLayout {
  const [layout, setLayout] = useState(readCardLayout);
  useEffect(() => {
    const update = () =>
      setLayout((current) => {
        const next = readCardLayout();
        return next.keyboard === current.keyboard && next.maxHeight === current.maxHeight
          ? current
          : next;
      });
    window.addEventListener("resize", update);
    const visual = window.visualViewport;
    visual?.addEventListener("resize", update);
    visual?.addEventListener("scroll", update);
    return () => {
      window.removeEventListener("resize", update);
      visual?.removeEventListener("resize", update);
      visual?.removeEventListener("scroll", update);
    };
  }, []);
  return layout;
}
