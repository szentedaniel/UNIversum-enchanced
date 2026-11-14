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

/** The Game screen's measured layout: the card's budget and the strip's width. */
export type CardLayout = {
  /** The layout viewport's width in px, what the Player strip divides up. */
  width: number;
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
  if (typeof window === "undefined") {
    return { width: 0, keyboard: 0, maxHeight: CARD_RESERVE_PX };
  }
  const width = window.innerWidth;
  const height = window.innerHeight;
  const keyboard = keyboardInset(height, window.visualViewport);
  return { width, keyboard, maxHeight: cardMaxHeight(height, keyboard) };
}

/**
 * The Game screen's layout, kept current as the viewport, the orientation and
 * the on-screen keyboard change. `visualViewport`'s own `resize` and `scroll`
 * are what catch the keyboard; `window`'s `resize` catches rotation.
 */
export function useCardLayout(): CardLayout {
  const [layout, setLayout] = useState(readCardLayout);
  useEffect(() => {
    const update = () =>
      setLayout((current) => {
        const next = readCardLayout();
        return next.width === current.width &&
          next.keyboard === current.keyboard &&
          next.maxHeight === current.maxHeight
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

/** The phone strip's horizontal padding (`px-2`) and the gap between chips (`gap-1.5`). */
const STRIP_PADDING_PX = 16;
const CHIP_GAP_PX = 6;

/** The chip width the full cash line needs, its padding and border included. */
const FULL_CASH_CHIP_PX = 100;

/** One chip's width in the phone strip, from the strip's own padding and gaps. */
export function chipWidth(viewportWidth: number, players: number): number {
  if (players <= 0) return 0;
  return Math.floor((viewportWidth - STRIP_PADDING_PX - (players - 1) * CHIP_GAP_PX) / players);
}

/**
 * The cash form the phone strip has room for: four Players on a portrait phone
 * squeeze each chip below the full amount's width, so the cash shortens there
 * (the expanded Player card always shows it in full).
 */
export function stripMoney(viewportWidth: number, players: number): "full" | "compact" {
  return chipWidth(viewportWidth, players) >= FULL_CASH_CHIP_PX ? "full" : "compact";
}
