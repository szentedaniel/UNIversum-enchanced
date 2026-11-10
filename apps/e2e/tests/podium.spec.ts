import { expect, type Page } from "@playwright/test";
import { closeAfterDump, startGame, test } from "./helpers.ts";

// The result screen (#32), on each project's device. A random game can't be
// played to its end quickly, so the test shows a made-up game-over view through
// the test-only `showView` hook (as if the server had pushed it): the podium's
// 2-1-3 order, the winner's own figure colour, the greyed Bankrupt Player and
// the way back to the Lobby list. Nothing is sent to the server.
test.use({ locale: "en-US" });

/**
 * Four Players: the yellow Seat (3) wins a time-up game, then the others by
 * Wealth; Seat 2 is Bankrupt. The winner is not the Wealthiest, so the test
 * proves the server's winner comes first.
 */
function showGameOver(page: Page) {
  return page.evaluate(() => {
    const hooks = window.universumTest!;
    const view = structuredClone(hooks.room().push!.view);
    view.players = [
      {
        id: "p1",
        seat: 0,
        name: { adjective: "brave", noun: "bear" },
        cash: 2_000_000,
        wealth: 2_000_000,
        position: 0,
        bankrupt: false,
        quarantineRounds: null,
        hasPcrTest: false,
        bot: false,
      },
      {
        id: "p2",
        seat: 1,
        name: { adjective: "calm", noun: "wolf" },
        cash: 500_000,
        wealth: 3_000_000,
        position: 0,
        bankrupt: false,
        quarantineRounds: null,
        hasPcrTest: false,
        bot: false,
      },
      {
        id: "p3",
        seat: 2,
        name: { adjective: "busy", noun: "beaver" },
        cash: 0,
        wealth: 0,
        position: 0,
        bankrupt: true,
        quarantineRounds: null,
        hasPcrTest: false,
        bot: false,
      },
      {
        id: "p4",
        seat: 3,
        name: { adjective: "happy", noun: "tiger" },
        cash: 4_100_000,
        wealth: 4_100_000,
        position: 0,
        bankrupt: false,
        quarantineRounds: null,
        hasPcrTest: false,
        bot: true,
      },
    ];
    view.fields = view.fields.map(() => ({ owner: null, level: 0, value: 0, rent: 0, sale: 0 }));
    view.currentPlayer = "p4";
    view.phase = { kind: "gameOver", winner: "p4", reason: "timeUp" };
    view.actsAfter = hooks.serverNow();
    view.turnDeadline = null;
    view.turnTimer = null;
    // What the server's publicView carries at gameOver: winner first, then
    // Wealth, the Bankrupt Player last (R80).
    view.standings = [
      { player: "p4", wealth: 4_100_000 },
      { player: "p2", wealth: 3_000_000 },
      { player: "p1", wealth: 2_000_000 },
      { player: "p3", wealth: 0 },
    ];
    hooks.showView(view);
  });
}

test("the result screen: a 2-1-3 podium in Player colours, the Bankrupt Player greyed below, and back to the list", async ({
  page,
  browser,
}) => {
  const { context } = await startGame(page, browser);
  try {
    await showGameOver(page);

    const podium = page.getByTestId("podium");
    await expect(podium).toBeVisible();
    await expect(podium.getByTestId("podium-title")).toHaveText("Happy Tiger wins!");
    await expect(podium).toContainText("Time's up.");

    // 2-1-3, with the winner first by place, not by array order.
    const places = podium.getByTestId("podium-place");
    await expect(places).toHaveCount(3);
    expect(
      await places.evaluateAll((nodes) => nodes.map((n) => n.getAttribute("data-place"))),
    ).toEqual(["2", "1", "3"]);
    expect(
      await places.evaluateAll((nodes) => nodes.map((n) => n.getAttribute("data-player"))),
    ).toEqual(["p2", "p4", "p1"]);

    // Each place names its Player and shows their Wealth.
    const first = podium.locator('[data-testid=podium-place][data-place="1"]');
    await expect(first).toContainText("Happy Tiger");
    await expect(first).toContainText("4,100,000");
    await expect(podium).toContainText("Calm Wolf");
    await expect(podium).toContainText("Brave Bear");

    // The winner's name line carries the Bot mark (spec: Bots, story 17).
    await expect(first.getByTestId("bot-mark")).toHaveText("BOT");

    // F28: the winner's block is in the winner's own colour (yellow, Seat 3).
    const block = first.getByTestId("podium-block");
    expect(await block.evaluate((node) => getComputedStyle(node).backgroundColor)).toBe(
      "rgb(255, 204, 0)",
    );

    // The Bankrupt Player is below the podium, greyed.
    const below = podium.getByTestId("podium-below");
    await expect(below).toContainText("Busy Beaver");
    await expect(below).toContainText("Bankrupt");
    expect(await below.locator("li").evaluate((node) => getComputedStyle(node).opacity)).toBe(
      "0.5",
    );

    // Back to the Lobby list.
    await podium.getByRole("link", { name: "Back to the Lobby list" }).click();
    await expect(page).toHaveURL(/\/rooms$/);
  } finally {
    closeAfterDump(context);
  }
});
