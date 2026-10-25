import type { Page } from "@playwright/test";
import { expect } from "@playwright/test";
import { playbackOf, START_CASH, type Reveal } from "@universum/rules";
import { closeAfterDump, startGame, test } from "./helpers.ts";

// ADR-0005: each event's effect shows at its own Playback step. A random game
// can't be steered onto an owned Field, so the test shows a made-up Rent push
// through the test-only `showView` hook: its final view already has the Rent
// paid, and its reveals have it paid only from the Rent step on. Nothing is
// sent to the server.
test.use({ locale: "en-US" });

/** The Rent, and the cash the two cards show before and after it (the game has just started). */
const RENT = 50_000;
const BEFORE_TEXT = moneyOf(START_CASH);
const PAYER_AFTER_TEXT = moneyOf(START_CASH - RENT);
const OWNER_AFTER_TEXT = moneyOf(START_CASH + RENT);

/** The same money format the screen uses (en-US, forint, "Ft" in every language). */
function moneyOf(amount: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "HUF",
    currencyDisplay: "narrowSymbol",
    maximumFractionDigits: 0,
  }).format(amount);
}

/** The dice and the seven-field walk before the Rent step: the wait's budget (ADR-0004). */
const WALK_MS = playbackOf([
  { type: "DiceRolled", player: "p1", dice: [3, 4] },
  { type: "Moved", player: "p1", from: 1, to: 8, steps: 7 },
]);

/** Shows the same made-up Rent push on `page`, as if the server had sent it. */
function showRent(page: Page, ids: { payer: string; owner: string }) {
  return page.evaluate(
    ({ payer, owner, rent }) => {
      const hooks = window.universumTest;
      const push = hooks?.room().push;
      if (!hooks || !push) throw new Error("no push to base the made-up one on");
      const view = structuredClone(push.view);
      const paid = view.players.map((player) => {
        const cash = player.cash + (player.id === payer ? -rent : rent);
        return { ...player, cash, wealth: cash };
      });
      const events = [
        { type: "DiceRolled", player: payer, dice: [3, 4] },
        { type: "Moved", player: payer, from: 1, to: 8, steps: 7 },
        { type: "RentPaid", player: payer, owner, field: 8, amount: rent },
        { type: "TurnPassed", player: owner, turn: 2 },
      ] as const;
      // A reveal never moves a pawn: the positions stay the final view's.
      const reveals: Reveal[] = [structuredClone(view.players), structuredClone(view.players)].map(
        (players) => ({ players, fields: view.fields, doubler: view.doubler }),
      );
      for (const players of [paid, paid]) {
        reveals.push({ players, fields: view.fields, doubler: view.doubler });
      }
      hooks.showView({ ...view, players: paid }, events, reveals);
    },
    { ...ids, rent: RENT },
  );
}

test("a Rent leaves the payer's card at the Rent step, not when the push arrives", async ({
  page,
  browser,
}) => {
  const { context, guest } = await startGame(page, browser);
  try {
    const ids = await page.evaluate(() => {
      const { me, push } = window.universumTest!.room();
      const other = push!.view.players.find((player) => player.id !== me);
      if (!me || !other) throw new Error("the game needs two Players");
      return { payer: me, owner: other.id };
    });
    const seats = await page.evaluate(({ payer, owner }) => {
      const { players } = window.universumTest!.room().push!.view;
      return {
        payer: players.find((player) => player.id === payer)!.seat,
        owner: players.find((player) => player.id === owner)!.seat,
      };
    }, ids);
    const cards = page.locator('[data-testid="player-card"], [data-testid="player-chip"]');
    const payerCard = cards.nth(seats.payer);
    const ownerCard = cards.nth(seats.owner);

    await Promise.all([showRent(page, ids), showRent(guest, ids)]);

    // The push's final view already has the Rent paid; the cards still show the
    // cash from before it while the dice and the walk play.
    await expect(payerCard.getByLabel("Cash")).toContainText(BEFORE_TEXT);
    await expect(ownerCard.getByLabel("Cash")).toContainText(BEFORE_TEXT);
    await expect(page.getByTestId("toast")).toContainText("Rent", { timeout: WALK_MS + 5_000 });

    // The Rent step: the payer's cash drops and the owner's rises, with the toast.
    await expect(payerCard.getByLabel("Cash")).toContainText(PAYER_AFTER_TEXT);
    await expect(ownerCard.getByLabel("Cash")).toContainText(OWNER_AFTER_TEXT);
  } finally {
    closeAfterDump(context);
  }
});
