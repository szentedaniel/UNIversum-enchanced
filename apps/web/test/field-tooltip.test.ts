import type { FieldView, PublicView } from "@universum/rules";
import { FIELD_COUNT } from "@universum/rules/board";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FieldTooltip, placeTooltip } from "#board/FieldTooltip.tsx";
import { baseLocale, overwriteGetLocale, type Locale } from "#paraglide/runtime.js";
import { uiStore } from "#stores/ui-store.ts";
import { fieldOf, viewOf } from "./playback-fixtures.ts";

// The hover tooltip (#318): a mouse hovering a Field shows a small note beside
// it — the name, and for a University or Museum the owner and the current Rent
// from the view — while Chance, Tax and the corners show the name only. The
// placement is the pure part; the content is the component's own markup.

const ZURICH = 5;
const CHANCE = 14;
const TAX = 30;

const inLanguage = (locale: Locale) => overwriteGetLocale(() => locale);

beforeEach(() => inLanguage("en"));
afterEach(() => inLanguage(baseLocale));

/** A view whose Fields carry `patch`; every other Field is empty. */
function viewWith(patch: Record<number, FieldView>): PublicView {
  const fields = Array.from({ length: FIELD_COUNT }, () => fieldOf());
  for (const [id, field] of Object.entries(patch)) fields[Number(id)] = field;
  return viewOf(undefined, { fields });
}

const render = (id: number | null, view: PublicView | null, at = { x: 300, y: 400 }) =>
  renderToStaticMarkup(createElement(FieldTooltip, { id, view, at }));

describe("placeTooltip", () => {
  const size = { width: 180, height: 60 };
  const viewport = { width: 1280, height: 720 };

  it("sits beside the Field, vertically centred on it", () => {
    expect(placeTooltip({ x: 300, y: 400 }, size, viewport)).toEqual({ x: 312, y: 370 });
  });

  it("moves to the Field's other side when the right one would leave the screen", () => {
    expect(placeTooltip({ x: 1200, y: 400 }, size, viewport)).toEqual({ x: 1008, y: 370 });
  });

  it("keeps the whole box on screen in a narrow viewport", () => {
    const placed = placeTooltip({ x: 150, y: 200 }, size, { width: 300, height: 400 });

    expect(placed.x).toBe(112);
    expect(placed.y).toBe(170);
  });

  it("clamps at the viewport's top and bottom edges", () => {
    expect(placeTooltip({ x: 300, y: 10 }, size, viewport).y).toBe(8);
    expect(placeTooltip({ x: 300, y: 710 }, size, viewport).y).toBe(652);
  });

  it("keeps the top-left margin when the box is bigger than the viewport", () => {
    // Both axes go through the same clamp: an oversized box keeps the margin
    // rather than following the Field off screen.
    expect(
      placeTooltip({ x: 50, y: 50 }, { width: 400, height: 300 }, { width: 200, height: 200 }),
    ).toEqual({ x: 8, y: 8 });
  });
});

describe("the Field tooltip", () => {
  it("renders nothing while no Field is hovered, and nothing without a view", () => {
    expect(render(null, viewWith({}))).toBe("");
    expect(render(ZURICH, null)).toBe("");
  });

  it("shows an owned University's name, owner and current Rent", () => {
    const view = viewWith({
      [ZURICH]: fieldOf({ owner: "p1", level: 1, value: 200_000, rent: 120_000, basePrice: 0 }),
    });
    const html = render(ZURICH, view);

    expect(html).toContain('data-testid="field-tooltip"');
    expect(html).toContain("Zurich");
    expect(html).toContain("Owner");
    expect(html).toContain("Happy Tiger");
    expect(html).toContain("Rent");
    expect(html).toContain("120,000");
  });

  it("says Unowned and shows no Rent while nobody owns the Field", () => {
    const html = render(ZURICH, viewWith({}));

    expect(html).toContain("Zurich");
    expect(html).toContain("Unowned");
    expect(html).toContain("Rent");
    expect(html).toContain("—");
  });

  it("shows the name only for a Chance, Tax or corner Field", () => {
    const chance = render(CHANCE, viewWith({}));
    const tax = render(TAX, viewWith({}));
    const start = render(0, viewWith({}));

    expect(chance).toContain("field-tooltip");
    expect(chance).toContain("Chance");
    expect(tax).toContain("Tax");
    expect(start).toContain("Start");
    for (const html of [chance, tax, start]) {
      expect(html).not.toContain("Rent");
      expect(html).not.toContain("Unowned");
      expect(html).not.toContain("Owner");
    }
  });

  it("is no Board obstacle and takes no pointer events", () => {
    const html = render(ZURICH, viewWith({}));

    expect(html).not.toContain("data-board-obstacle");
    expect(html).toContain("pointer-events-none");
  });
});

describe("the hover reset", () => {
  it("clears the hovered Field for its subscriber, as an unmounted Board does", () => {
    const seen: (number | null)[] = [];
    const stop = uiStore.subscribe(
      (state) => state.hoveredField,
      (field) => seen.push(field),
    );
    uiStore.getState().hoverField(ZURICH);
    // Board.tsx's effect cleanup calls this when the Board or the Game unmounts.
    uiStore.getState().hoverField(null);
    stop();

    expect(seen).toEqual([ZURICH, null]);
    expect(uiStore.getState().hoveredField).toBeNull();
  });
});
