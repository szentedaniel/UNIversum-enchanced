import { describe, expect, it } from "vitest";
import { cssHex, GROUP_COLORS } from "#board/colors.ts";

// The Group and kind colours reach the screen as CSS hex strings (the Field
// card's band, the Summary's Monopoly dots), so a channel that needs its
// leading zero must keep it.

describe("a board colour's CSS hex", () => {
  it("pads each channel to two digits", () => {
    expect(cssHex(GROUP_COLORS[8])).toBe("#0572bb");
    expect(cssHex(0x2b2238)).toBe("#2b2238");
  });
});
