/**
 * The hover tooltip (#318): a small note beside the Field a mouse hovers, with
 * the Field's name and — for a University or Museum — its owner (or Unowned)
 * and the current Rent. `Board.tsx` feeds it `uiStore.hoveredField`, the view
 * the screen shows (the Playback's frame, so it never runs ahead of a Playback,
 * ADR-0004) and the Field's screen point from the Board renderer.
 *
 * It is not a `data-board-obstacle` and takes no pointer events, so it blocks
 * no tap, drag or pinch under it, and it never takes the bottom slot: the Field
 * card and the trays keep that (spec #181). Only a mouse raises it (#317), so
 * a touch pointer never sees it; the card stays the accessible path, and the
 * tooltip repeats it (`aria-hidden`).
 */
import type { PublicView } from "@universum/rules";
import type { FieldId } from "@universum/rules/board";
import { useLayoutEffect, useRef, useState } from "react";
import { fieldFacts } from "#board/field-facts.ts";
import type { Point } from "#board/layout.ts";
import { fieldName, formatMoney, m, playerName } from "#text.ts";

/** A box in CSS pixels: the tooltip's measured size, or the viewport's. */
type Size = { width: number; height: number };

/** The gap between the Field's centre and the tooltip. */
const GAP = 12;
/** The least the tooltip leaves between itself and the viewport's edge. */
const MARGIN = 8;

/**
 * `value` kept inside the viewport with `MARGIN` on either side. A box bigger
 * than its viewport keeps the near margin rather than hanging off the far one.
 */
function clamp(value: number, size: number, viewportSize: number): number {
  return Math.min(Math.max(value, MARGIN), Math.max(MARGIN, viewportSize - size - MARGIN));
}

/**
 * Where the tooltip's box goes: beside the Field's centre `at`, on the side
 * that fits, and clamped inside `viewport` so the whole box stays on screen
 * (a box wider than the viewport keeps the left margin).
 */
export function placeTooltip(at: Point, size: Size, viewport: Size): Point {
  const right = at.x + GAP;
  const left = at.x - GAP - size.width;
  // Right of the Field unless that leaves the screen and the left side fits.
  const beside = right + size.width <= viewport.width - MARGIN || left < MARGIN ? right : left;
  return {
    x: clamp(beside, size.width, viewport.width),
    y: clamp(at.y - size.height / 2, size.height, viewport.height),
  };
}

type FieldTooltipProps = {
  /** The Field the pointer hovers (`uiStore.hoveredField`), or `null`. */
  id: FieldId | null;
  /** The pushed view the screen draws (the Playback's frame), or `null` before the first push. */
  view: PublicView | null;
  /** The Field's centre in viewport CSS px (the Board's `fieldCenter`), or `null` before the Board is up. */
  at: Point | null;
};

export function FieldTooltip({ id, view, at }: FieldTooltipProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [placed, setPlaced] = useState<Point | null>(null);

  // Measured after the content renders, before the browser paints: the box
  // wraps with its text, so only the DOM knows its size (one rect per render).
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) {
      setPlaced(null);
      return;
    }
    const { width, height } = element.getBoundingClientRect();
    const point = placeTooltip(
      at ?? { x: 0, y: 0 },
      { width, height },
      { width: window.innerWidth, height: window.innerHeight },
    );
    setPlaced((last) => (last?.x === point.x && last.y === point.y ? last : point));
    // `at` is a fresh point per hover or Playback step, so the box is measured
    // again whenever its content can have changed.
  }, [at]);

  if (id === null || view === null || at === null) return null;
  const facts = fieldFacts(view, id);
  if (!facts) return null;
  const { field, owner } = facts;

  return (
    <div
      ref={ref}
      data-testid="field-tooltip"
      aria-hidden="true"
      className="sticker-sm pointer-events-none fixed z-20 flex w-max max-w-48 flex-col gap-0.5 rounded-ui bg-card px-2.5 py-1.5 text-card-foreground"
      style={{ left: placed?.x ?? 0, top: placed?.y ?? 0 }}
    >
      <p className="m-0 text-sm leading-tight font-black">{fieldName(field.key)}</p>
      {facts.ownable && (
        <>
          <p className="m-0 text-[0.7rem] leading-tight font-bold text-ink/70">
            {owner ? `${m.field_card_owner()}: ${playerName(owner.name)}` : m.field_card_unowned()}
          </p>
          <p className="m-0 flex items-baseline gap-1 text-[0.7rem] leading-tight font-bold">
            {m.field_card_rent()}:
            <span className="tnum font-black">
              {facts.rent === null ? m.field_card_none() : formatMoney(facts.rent)}
            </span>
          </p>
        </>
      )}
    </div>
  );
}
