import { expect, test, type Browser, type Page } from "@playwright/test";

test.use({ locale: "en-US" });

/** The creator opens a 2-Player Lobby and a second Guest joins it by code; returns the joiner's page. */
async function twoInLobby(creator: Page, browser: Browser, baseURL: string | undefined) {
  await creator.goto("/create");
  await creator.getByLabel("2", { exact: true }).check();
  await creator.getByRole("button", { name: "Create Room" }).click();
  await expect(creator).toHaveURL(/\/room\/[1-9]\d{5}$/);
  const code = new URL(creator.url()).pathname.split("/").at(-1) ?? "";
  const context = await browser.newContext({ baseURL, locale: "en-US" });
  const joiner = await context.newPage();
  await joiner.goto(`/room/${code}`);
  for (const page of [creator, joiner]) {
    // oxlint-disable-next-line no-await-in-loop -- one page after the other
    await expect(page.getByText("Players: 2/2")).toBeVisible();
  }
  return { code, joiner };
}

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
    await again.goto(`/room/${code}`);

    await expect(again.getByText("Players: 2/2")).toBeVisible();
    await expect(again.getByTestId("seat").nth(1)).toContainText("you");
    await expect(held).toHaveCount(0);
  } finally {
    await context.close();
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
    await again.goto(`/game/${code}`);
    await expect(again.getByTestId("turn-of")).toBeVisible();
    await expect.poll(() => me(again)).toBe(joinerId);
    await expect
      .poll(() => again.evaluate(() => window.universumTest?.view()?.version ?? -1))
      .toBeGreaterThanOrEqual(version);
  } finally {
    await context.close();
  }
});
