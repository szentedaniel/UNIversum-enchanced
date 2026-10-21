import { expect, type Page } from "@playwright/test";
import { closeAfterDump, registerPage, test, twoInLobby } from "./helpers.ts";

test.use({ locale: "en-US" });

const me = (page: Page) => page.evaluate(() => window.universumTest?.room().me ?? null);

test("a Guest who closes the Lobby and opens it again gets their Seat back; the others see it held meanwhile", async ({
  page: creator,
  browser,
  baseURL,
}) => {
  const { code, joiner } = await twoInLobby(creator, browser, baseURL);
  const context = joiner.context();
  try {
    await joiner.close();

    const held = creator.getByTestId("seat-held");
    await expect(held).toHaveText(/^Reconnecting 0:[0-5]\d$/);
    await expect(creator.getByText("Players: 2/2")).toBeVisible();

    const again = await context.newPage();
    registerPage("joiner", again);
    await again.goto(`/room/${code}`);

    await expect(again.getByText("Players: 2/2")).toBeVisible();
    await expect(again.getByTestId("seat").nth(1)).toContainText("you");
    await expect(held).toHaveCount(0);
  } finally {
    closeAfterDump(context);
  }
});

test("a Player who goes offline in a game sees the reconnecting overlay and is back in their Seat when the network returns, or when they reopen the game", async ({
  page: creator,
  browser,
  baseURL,
}) => {
  const { code, joiner } = await twoInLobby(creator, browser, baseURL);
  const context = joiner.context();
  try {
    await creator.getByRole("button", { name: "Start" }).click();
    await expect(joiner).toHaveURL(`/game/${code}`);
    await expect(joiner.getByTestId("turn-of")).toBeVisible();
    // The test hooks appear once the Board is up.
    await expect.poll(() => me(joiner)).not.toBeNull();
    const joinerId = await me(joiner);

    // A network drop: the overlay, then the same Seat once the network is back.
    await context.setOffline(true);
    const overlay = joiner.getByTestId("reconnect-overlay");
    await expect(overlay).toContainText("Reconnecting…");
    await context.setOffline(false);
    await expect(overlay).toHaveCount(0, { timeout: 20_000 });
    expect(await me(joiner)).toBe(joinerId);

    // Closing the game and opening its address again: the same Seat, the current state.
    const version = await creator.evaluate(() => window.universumTest?.view()?.version ?? 0);
    await joiner.close();
    const again = await context.newPage();
    registerPage("joiner", again);
    await again.goto(`/game/${code}`);
    await expect(again.getByTestId("turn-of")).toBeVisible();
    await expect.poll(() => me(again)).toBe(joinerId);
    await expect
      .poll(() => again.evaluate(() => window.universumTest?.view()?.version ?? -1))
      .toBeGreaterThanOrEqual(version);
  } finally {
    closeAfterDump(context);
  }
});
