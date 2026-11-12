import { describe, expect, it } from "vitest";
import { fieldVisible } from "#lib/safe-area.ts";

// A focused input has to stay inside what the phone actually shows: the
// visual viewport shrinks when the on-screen keyboard opens, while a field's
// rectangle stays in layout-viewport pixels. App.tsx scrolls a covered field
// back into view; this is the decision it asks.

const screen = { offsetTop: 0, height: 700 };

describe("fieldVisible", () => {
  it("shows a field inside the visible area, clear of its edges", () => {
    expect(fieldVisible({ top: 300, bottom: 348 }, screen)).toBe(true);
    expect(fieldVisible({ top: 12, bottom: 60 }, screen)).toBe(true);
    expect(fieldVisible({ top: 640, bottom: 688 }, screen)).toBe(true);
  });

  it("reports a field the keyboard covers", () => {
    expect(fieldVisible({ top: 380, bottom: 428 }, { offsetTop: 0, height: 400 })).toBe(false);
  });

  it("reports a field above the scrolled visible area", () => {
    expect(fieldVisible({ top: 180, bottom: 228 }, { offsetTop: 200, height: 500 })).toBe(false);
  });

  it("measures the scrolled visual viewport from its offset", () => {
    const scrolled = { offsetTop: 200, height: 500 };
    expect(fieldVisible({ top: 212, bottom: 260 }, scrolled)).toBe(true);
    expect(fieldVisible({ top: 400, bottom: 688 }, scrolled)).toBe(true);
    expect(fieldVisible({ top: 400, bottom: 689 }, scrolled)).toBe(false);
  });

  it("keeps the edge margin configurable", () => {
    const field = { top: 5, bottom: 45 };
    expect(fieldVisible(field, screen, 0)).toBe(true);
    expect(fieldVisible(field, screen, 8)).toBe(false);
  });
});
