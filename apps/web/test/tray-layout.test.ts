import { describe, expect, it } from "vitest";
import {
  CARD_HEIGHT_SHARE,
  CARD_RESERVE_PX,
  cardMaxHeight,
  chipWidth,
  keyboardInset,
  stripMoney,
} from "#lib/tray-layout.ts";

// The phone Game's bottom card (spec #184, story 4): it scrolls instead of
// growing past its share of the screen, and the on-screen keyboard lifts it.
// `Game.tsx` applies these numbers to the one wrapper around the tray, the Turn
// card and the Field card; the viewports below are the ones the design names
// (360×640 portrait, 852×393 landscape) and a phone with a keyboard open.

describe("cardMaxHeight", () => {
  it("caps the card at the Board's reserve on a 360 by 640 portrait phone", () => {
    expect(cardMaxHeight(640)).toBe(CARD_RESERVE_PX);
  });

  it("caps the card at the share of the height on a short landscape phone", () => {
    // 45% of 393 is 176.85: the card rounds down and keeps the strip above it.
    expect(cardMaxHeight(393)).toBe(176);
    expect(cardMaxHeight(393)).toBeLessThan(CARD_RESERVE_PX);
  });

  it("shrinks the card while the on-screen keyboard is open", () => {
    expect(cardMaxHeight(640, 300)).toBe(153);
    expect(cardMaxHeight(640, 300)).toBeLessThan(cardMaxHeight(640));
  });

  it("never grows past the share of the height the keyboard leaves visible", () => {
    for (const height of [320, 393, 568, 640, 844]) {
      for (const keyboard of [0, 120, 300]) {
        expect(cardMaxHeight(height, keyboard)).toBeLessThanOrEqual(
          Math.floor((height - keyboard) * CARD_HEIGHT_SHARE),
        );
      }
    }
  });

  it("floors the card at zero when the keyboard covers the whole screen", () => {
    expect(cardMaxHeight(640, 640)).toBe(0);
    expect(cardMaxHeight(640, 800)).toBe(0);
  });
});

describe("keyboardInset", () => {
  it("reports the height the keyboard covers at the bottom", () => {
    expect(keyboardInset(640, { height: 340, offsetTop: 0, scale: 1 })).toBe(300);
  });

  it("counts the visual viewport's scroll offset", () => {
    // A browser that scrolls the layout viewport leaves less of it under the keyboard.
    expect(keyboardInset(640, { height: 340, offsetTop: 120, scale: 1 })).toBe(180);
  });

  it("reports nothing when the keyboard is closed or no visual viewport exists", () => {
    expect(keyboardInset(640, null)).toBe(0);
    expect(keyboardInset(640, { height: 640, offsetTop: 0, scale: 1 })).toBe(0);
  });

  it("ignores a pinch-zoomed visual viewport, which is zoom and not the keyboard", () => {
    expect(keyboardInset(640, { height: 320, offsetTop: 0, scale: 2 })).toBe(0);
    expect(keyboardInset(640, { height: 320, offsetTop: 300, scale: 2 })).toBe(0);
  });

  it("rounds a fractional visual viewport height", () => {
    expect(keyboardInset(640, { height: 339.6, offsetTop: 0, scale: 1 })).toBe(300);
  });

  it("floors at zero when the visual viewport is larger than the layout one", () => {
    expect(keyboardInset(640, { height: 700, offsetTop: 0, scale: 1 })).toBe(0);
  });
});

describe("the phone Player strip", () => {
  it("splits the row between the Players, minus its padding and gaps", () => {
    expect(chipWidth(360, 4)).toBe(81);
    expect(chipWidth(360, 3)).toBe(110);
    expect(chipWidth(360, 2)).toBe(169);
  });

  it("shows the full cash on a two-Player portrait phone", () => {
    expect(stripMoney(360, 2)).toBe("full");
    expect(stripMoney(390, 2)).toBe("full");
  });

  it("shortens the cash when four Players squeeze the strip", () => {
    expect(stripMoney(360, 4)).toBe("compact");
    expect(stripMoney(390, 4)).toBe("compact");
    expect(stripMoney(320, 4)).toBe("compact");
  });

  it("keeps the full cash on a landscape phone, where four chips are wide", () => {
    expect(stripMoney(852, 4)).toBe("full");
  });

  it("switches at the width the full cash line needs", () => {
    // 4 chips × 100 px + the strip's 16 px padding + three 6 px gaps.
    expect(chipWidth(434, 4)).toBe(100);
    expect(stripMoney(434, 4)).toBe("full");
    expect(stripMoney(433, 4)).toBe("compact");
  });
});
