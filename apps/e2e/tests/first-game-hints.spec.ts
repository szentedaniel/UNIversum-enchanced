import { expect } from "@playwright/test";
import { closeAfterDump, expectGate, press, ROLL_WAIT_MS, startGame, test } from "./helpers.ts";

/*
 * The first-game Offer hint (#258, spec #180, story 1). The seeded first Roll
 * (GAME_SEED) lands the creator on an unowned Field, so the Roll's push opens an
 * Offer. The hint shows with the Offer once the Playback gate opens, its
 * dismissal survives a reload of the same browser, and it never covers the Buy.
 * Runs once per single-browser project: desktop Chromium and iPhone WebKit.
 */
test.use({ locale: "en-US" });
// The reload draws the Board a second time (slow on WebKit in CI).
test.setTimeout(90_000);

test("the first Offer's hint shows, stays dismissed through a reload, and leaves Buy tappable", async ({
  page,
  browser,
  isMobile,
}) => {
  // A 30 s Turn keeps the Offer open while the reload takes the Seat back.
  const { context: guestContext, guest } = await startGame(page, browser, { turnLimitMs: 30_000 });
  closeAfterDump(guestContext);
  const actor = { page, mobile: isMobile };
  const hint = page.getByTestId("hint");
  const dismiss = hint.getByTestId("hint-dismiss");
  const offer = page.getByTestId("offer");

  // The seeded Roll stops at the creator's first Offer.
  await press(actor, page.getByRole("button", { name: "Roll", exact: true }));
  await expect
    .poll(() => page.evaluate(() => window.universumTest?.room().push?.view.phase.kind ?? null), {
      timeout: 5_000,
    })
    .toBe("offer");
  // The hint waits for the gate (spec #180, Decision 3): assert it after the
  // dice and the walk, not right after the press.
  await expectGate(page, true, ROLL_WAIT_MS);
  await expect(offer).toBeVisible();
  await expect(hint).toBeVisible();
  await expect(hint).toHaveAttribute("data-hint", "offer");
  await expect(dismiss).toHaveAccessibleName("Got it");

  // A running game answers a dropped Guest's Decision with a Bot 1.5 s later
  // (#198). With the guest offline the Room arms none for the creator's dropped
  // Seat, so the reload below cannot hand this Offer to a Bot first.
  await guestContext.setOffline(true);
  await expect(guest.getByTestId("reconnect-overlay")).toBeVisible();

  // Buy stays tappable under the hint: a trial click runs Playwright's own
  // actionability checks (scrolled into view, receives the pointer) without
  // sending the Offer.
  const buy = offer.getByRole("button").first();
  await expect(buy).toBeEnabled();
  await buy.click({ trial: true });

  // Dismissed: the card leaves, and the Offer is still the open Decision.
  await press(actor, dismiss);
  await expect(hint).toHaveCount(0);
  await expect(offer).toBeVisible();

  // A reload keeps this browser's storage (no new context) and rejoins by Guest
  // token; the same Offer is up and its dismissed hint does not come back.
  await page.reload();
  await expect(offer).toBeVisible({ timeout: 30_000 });
  await expectGate(page, true, 5_000);
  await expect(hint).toHaveCount(0);
});
