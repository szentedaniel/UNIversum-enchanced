import { expect, type Page } from "@playwright/test";
import { closeAfterDump, startGame, test } from "./helpers.ts";

// The Chance card's Playback step (#52, ADR-0004), on each project's device. A
// random game can't be steered onto a Chance Field, so the test shows a made-up
// push through the test-only `showView` hook: the card is a card for 7 s with
// its text in the active language, and closing it hides it on that screen only,
// never on the other Player's. Nothing is sent to the server.
test.use({ locale: "en-US" });

/** Shows a push that drew the given Chance card, as if the server had just sent it. */
function showChance(page: Page, card: string) {
  return page.evaluate((drawn) => {
    const hooks = window.universumTest!;
    const { me, push } = hooks.room();
    const view = structuredClone(push!.view);
    // The server's clock lets the decision open at once; only this push's local
    // Playback (the card) holds it shut.
    view.actsAfter = hooks.serverNow();
    hooks.showView(view, [
      { type: "CardDrawn", player: me, card: drawn },
      { type: "ChanceMoneyReceived", player: me, amount: 300_000 },
    ]);
  }, card);
}

test("a drawn Chance card shows on both screens, and closing it hides it only on that screen", async ({
  page,
  browser,
}) => {
  const { context, guest } = await startGame(page, browser);
  try {
    await Promise.all([showChance(page, "scholarship"), showChance(guest, "scholarship")]);
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
