import { chromium, devices, expect, test, webkit, type Page } from "@playwright/test";

// The renderer's test-only hooks (apps/web/src/test-hooks.ts).
type ViewSummary = { turn: number; version: number; currentPlayer: string };
declare global {
  interface Window {
    universumTest?: {
      fieldCenter(id: number): { x: number; y: number };
      view(): ViewSummary | null;
    };
  }
}

const viewOf = (page: Page) => page.evaluate(() => window.universumTest?.view() ?? null);

const fieldCenter = (page: Page, id: number) =>
  page.evaluate((field) => window.universumTest?.fieldCenter(field), id);

test("two Guests, on desktop Chromium and iPhone WebKit, create, join, start and play", async ({
  baseURL,
}) => {
  const desktopBrowser = await chromium.launch();
  const phoneBrowser = await webkit.launch();
  try {
    const desktopContext = await desktopBrowser.newContext({
      ...devices["Desktop Chrome"],
      baseURL,
      locale: "en-US",
    });
    const phoneContext = await phoneBrowser.newContext({
      ...devices["iPhone 15"],
      baseURL,
      locale: "en-US",
    });
    const desktop = await desktopContext.newPage();
    const phone = await phoneContext.newPage();
    const both = [desktop, phone];

    // The desktop Guest creates a 2-Player Room and lands in its Lobby.
    await desktop.goto("/?players=2");
    await desktop.getByRole("button", { name: "Create Room" }).click();
    await expect(desktop).toHaveURL(/\/room\/[1-9]\d{5}$/);
    const code = new URL(desktop.url()).pathname.split("/").at(-1) ?? "";
    await expect(desktop.getByText("Players: 1/2")).toBeVisible();
    await expect(desktop.getByRole("button", { name: "Start" })).toBeDisabled();

    // The phone Guest joins by the Room code; both see the Seats fill.
    await phone.goto("/");
    await phone.getByLabel("Room code").fill(code);
    await phone.getByRole("button", { name: "Join" }).tap();
    await expect(phone).toHaveURL(`/room/${code}`);
    await Promise.all(both.map((page) => expect(page.getByText("Players: 2/2")).toBeVisible()));

    // Any Player may start a full Lobby.
    await phone.getByRole("button", { name: "Start" }).tap();
    await Promise.all(both.map((page) => expect(page).toHaveURL(`/game/${code}`)));
    await expect(desktop.getByText("Your Turn")).toBeVisible();

    // Every screen shows the one Turn-timer ring, on the current Player's card.
    for (const page of both) {
      const ring = page.getByRole("timer", { name: "Turn timer" });
      // oxlint-disable-next-line no-await-in-loop -- one page after the other
      await expect(ring).toHaveCount(1);
      // oxlint-disable-next-line no-await-in-loop -- one page after the other
      await expect(page.locator(".player.current").getByRole("timer")).toBeVisible();
    }

    // A few Turns: the first Seat (the creator) rolls first, then play alternates.
    const playTurn = async (turn: number) => {
      const [roller, waiter] = turn % 2 === 1 ? [desktop, phone] : [phone, desktop];
      await expect(waiter.getByRole("button", { name: "Roll" })).toHaveCount(0);
      const rollButton = roller.getByRole("button", { name: "Roll" });
      await (roller === phone ? rollButton.tap() : rollButton.click());
      await Promise.all(
        both.map((page) => expect.poll(async () => (await viewOf(page))?.turn).toBe(turn + 1)),
      );
    };
    for (let turn = 1; turn <= 4; turn++) {
      // oxlint-disable-next-line no-await-in-loop -- Turns are played one after another
      await playTurn(turn);
    }

    // Every client got the same view, one version per accepted roll.
    const [desktopView, phoneView] = await Promise.all(both.map(viewOf));
    expect(desktopView).toEqual(phoneView);
    expect(desktopView?.version).toBe(4);

    // Tapping a Field on the Board (found through the test hook) selects it.
    const zurich = await fieldCenter(phone, 5);
    expect(zurich).toBeDefined();
    await phone.touchscreen.tap(zurich!.x, zurich!.y);
    await expect(phone.getByTestId("selected-field")).toHaveText("Zurich");
  } finally {
    await Promise.all([desktopBrowser.close(), phoneBrowser.close()]);
  }
});
