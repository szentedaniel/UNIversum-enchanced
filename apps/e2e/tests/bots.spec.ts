import { expect, type Page } from "@playwright/test";
import {
  expectBoardUp,
  expectOneJoinSocket,
  playerCards,
  probeSockets,
  registerPage,
  resolveDecision,
  ROLL_PLAYBACK_MS,
  test,
} from "./helpers.ts";

// Ticket #196: one Guest fills the empty Seats with a Bot and starts the
// game; the Room plays the Bot's Turn and the Guest sees it, from the Bot's
// mark on the Seat card, Player card and Turn to its dice roll.
test.use({ locale: "en-US" });

/**
 * The Room plays a Bot's decision 1.5 s after its Decision gate; the wait
 * below leaves room for that pause on a loaded CI runner.
 */
const BOT_PAUSE_MS = 2_000;

const pushView = (page: Page) =>
  page.evaluate(() => window.universumTest?.room().push?.view ?? null);

test("one Guest starts a game with a Bot, and the Bot takes its Turn", async ({
  page,
  isMobile,
}) => {
  registerPage("creator", page);
  await probeSockets(page);
  await page.goto("/create");
  await page.getByLabel("2", { exact: true }).check();
  await page.getByRole("button", { name: "Create Room" }).click();
  await expect(page).toHaveURL(/\/room\/[1-9]\d{5}$/);
  const code = new URL(page.url()).pathname.split("/").at(-1) ?? "";
  await expect(page.getByText("Players: 1/2")).toBeVisible();

  // The first open Seat offers the Bot; once seated, the card says BOT.
  await page.getByRole("button", { name: "Add Bot" }).click();
  await expect(page.getByText("Players: 2/2")).toBeVisible();
  await expect(page.locator("[data-testid=seat][data-open]")).toHaveCount(0);
  await expect(page.getByTestId("seat").filter({ hasText: "BOT" })).toHaveCount(1);

  // One Guest is enough to start (spec: Bots, story 1).
  await page.getByRole("button", { name: "Start" }).click();
  await expect(page).toHaveURL(`/game/${code}`);
  await expectBoardUp(page);
  await expectOneJoinSocket(page, "creator");

  const me = await page.evaluate(() => window.universumTest!.room().me);
  const bot = await page.evaluate(() => {
    const view = window.universumTest!.room().push!.view;
    return view.players.find((player) => player.bot) ?? null;
  });
  if (bot === null) throw new Error("the game has no Bot Seat");
  // The Bot's Player card or chip carries the mark too.
  await expect(playerCards(page).filter({ hasText: "BOT" })).toHaveCount(1);

  // The Guest's Turn: roll, and decline whatever offer the landing stops at,
  // until the Turn passes to the Bot.
  let view = await pushView(page);
  for (let guard = 0; guard < 6 && view?.currentPlayer === me; guard++) {
    // oxlint-disable-next-line no-await-in-loop -- one decision at a time
    await resolveDecision({ page, mobile: isMobile }, view, () => "decline");
    // oxlint-disable-next-line no-await-in-loop -- the server's answer to this decision
    await expect
      .poll(async () => (await pushView(page))?.version ?? -1, { timeout: ROLL_PLAYBACK_MS })
      .toBeGreaterThan(view.version);
    // oxlint-disable-next-line no-await-in-loop -- the next decision's view
    view = await pushView(page);
  }
  if (view === null) throw new Error("no view after the Guest's Turn");
  expect(view.currentPlayer).toBe(bot.id);
  // The current card is the Bot's, marked as such.
  await expect(playerCards(page).filter({ hasText: "BOT" })).toHaveAttribute(
    "data-current",
    "true",
  );

  // Without anyone touching the screen, the Bot rolls a moment after its
  // gate and the Guest is sent the dice.
  await expect
    .poll(
      async () =>
        page.evaluate(
          (botId) =>
            window.universumTest
              ?.room()
              .push?.events.some(
                (event) => event.type === "DiceRolled" && event.player === botId,
              ) ?? false,
          bot.id,
        ),
      { timeout: ROLL_PLAYBACK_MS + BOT_PAUSE_MS },
    )
    .toBe(true);
  const moved = await page.evaluate(
    (botId) =>
      window.universumTest!.room().push!.view.players.find((player) => player.id === botId)
        ?.position ?? 0,
    bot.id,
  );
  expect(moved).toBeGreaterThan(0);
});
