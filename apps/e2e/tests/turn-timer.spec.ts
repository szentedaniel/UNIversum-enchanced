import { expect } from "@playwright/test";
import { closeAfterDump, createAndJoin, startLobby, test } from "./helpers.ts";

/**
 * The Room's Turn timer setting (#187): the creator's 10 s choice is the
 * length the ring empties over. The e2e server sets no Turn limit override
 * (`playwright.config.ts`), so the ring can only get 10 s from the setting.
 */
test("a Room created with a 10 s Turn timer starts the ring at 10 s", async ({ page, browser }) => {
  const { code, context } = await createAndJoin(
    page,
    browser,
    { creator: "creator", guest: "guest" },
    undefined,
    { turnLimitMs: 10_000 },
  );
  closeAfterDump(context);

  await startLobby(page, code);
  const ring = page.locator('[aria-current="true"] .turn-ring-left');
  await expect(ring).toHaveCount(1);
  const style = await ring.evaluate((element) => {
    const { animationDuration, animationDelay } = element.style;
    return { animationDuration, animationDelay };
  });
  expect(style.animationDuration).toBe("10000ms");
  // The ring is full when it mounts: the delay only removes the moments since the push.
  expect(Number.parseFloat(style.animationDelay)).toBeGreaterThan(-2_000);

  await expect
    .poll(() => page.evaluate(() => window.universumTest?.room().push?.view.turnTimer?.limitMs))
    .toBe(10_000);
});
