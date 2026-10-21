import { expect, test } from "@playwright/test";
import { startGame } from "./helpers.ts";

// Story 4 of ADR-0004, in the browser: the turn card's heading and Turn number
// change when the decision gate opens, not when the push arrives. A random
// game can't be steered into a Turn change on demand, so the test shows a
// made-up push through the test-only `showView` hook: a Roll whose walk passes
// the Turn to the other Player, with a Chance card to give the hold a wide
// window. Nothing is sent to the server.
test.use({ locale: "en-US" });

test("the turn card's heading and Turn number wait for the Playback's end, then switch", async ({
  page,
  browser,
}) => {
  const { context, guest } = await startGame(page, browser);
  try {
    const heading = page.getByTestId("turn-of");
    const guestHeading = guest.getByTestId("turn-of");
    const turnNumber = page.getByTestId("turn");

    // The creator rolls first, so its card says "Your Turn" and the guest's
    // names the creator.
    await expect(heading).toHaveText("Your Turn");
    const creatorHeadingOnGuest = await guestHeading.textContent();
    expect(creatorHeadingOnGuest).not.toBeNull();

    // A made-up push that passes the Turn to the other Player; only this
    // push's local Playback holds the decision, so its length is known.
    await Promise.all(
      [page, guest].map((screen) =>
        screen.evaluate(() => {
          const hooks = window.universumTest!;
          const { me, push } = hooks.room();
          const view = structuredClone(push!.view);
          const other = view.players.find((player) => player.id !== me)!;
          view.turn += 1;
          view.currentPlayer = other.id;
          // The server's clock is already past: only the local Playback holds.
          view.actsAfter = Date.now() + push!.clockOffset;
          hooks.showView(view, [
            { type: "DiceRolled", player: me ?? "", dice: [6, 6] },
            { type: "Moved", player: me ?? "", from: 0, to: 12, steps: 12 },
            { type: "CardDrawn", player: me ?? "", card: "scholarship" },
            { type: "TurnPassed", player: other.id, turn: view.turn },
          ]);
        }),
      ),
    );

    // Held: both screens still show the previous Turn while the Playback runs.
    await expect(heading).toHaveText("Your Turn");
    await expect(guestHeading).toHaveText(creatorHeadingOnGuest!);
    await expect(turnNumber).toHaveText("Turn 1");
    await expect(guest.getByTestId("turn")).toHaveText("Turn 1");

    // The gate opens at the Playback's end: the heading and Turn number switch
    // together, on both screens.
    await expect(heading).not.toHaveText("Your Turn", { timeout: 15_000 });
    await expect(guestHeading).toHaveText("Your Turn", { timeout: 15_000 });
    await expect(turnNumber).toHaveText("Turn 2");
    await expect(guest.getByTestId("turn")).toHaveText("Turn 2");
  } finally {
    await context.close();
  }
});
