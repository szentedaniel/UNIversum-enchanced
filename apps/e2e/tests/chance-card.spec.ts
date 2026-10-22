import { expect } from "@playwright/test";
import { closeAfterDump, showChance, startGame, test } from "./helpers.ts";

// The Chance card's Playback step (#52, ADR-0004), on each project's device. A
// random game can't be steered onto a Chance Field, so the test shows a made-up
// push through the test-only `showView` hook: the card is a card for 7 s with
// its text in the active language, and closing it hides it on that screen only,
// never on the other Player's. Nothing is sent to the server.
test.use({ locale: "en-US" });

test("a drawn Chance card shows on both screens, and closing it hides it only on that screen", async ({
  page,
  browser,
}) => {
  const { context, guest } = await startGame(page, browser);
  try {
    await Promise.all([
      showChance(page, "scholarship", [{ type: "ChanceMoneyReceived", amount: 300_000 }]),
      showChance(guest, "scholarship", [{ type: "ChanceMoneyReceived", amount: 300_000 }]),
    ]);
    const mine = page.getByTestId("chance-card");
    const theirs = guest.getByTestId("chance-card");
    await Promise.all([expect(mine).toBeVisible(), expect(theirs).toBeVisible()]);

    // The card's title and text come from the active language's messages.
    await expect(mine.getByRole("heading")).toHaveText("Scholarship");
    await expect(mine).toContainText("scholarship");
    await expect(mine.getByRole("button", { name: "Got it" })).toBeVisible();

    // Closing is local: this screen drops the card, the other keeps reading it.
    await mine.getByRole("button", { name: "Got it" }).click();
    await expect(mine).toHaveCount(0);
    await expect(theirs).toBeVisible();
  } finally {
    closeAfterDump(context);
  }
});
