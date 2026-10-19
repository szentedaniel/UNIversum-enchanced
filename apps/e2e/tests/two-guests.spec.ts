import { chromium, devices, expect, test, webkit, type Page } from "@playwright/test";

// The renderer's test-only hooks (apps/web/src/test-hooks.ts).
type ViewSummary = {
  turn: number;
  version: number;
  currentPlayer: string;
  phase: { kind: string; field?: number; levels?: { level: number; price: number }[] };
  fields: { owner: string | null; level: number; value: number; rent: number }[];
};
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
    await phone.getByRole("textbox", { name: "Room code" }).fill(code);
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
      await expect(page.locator("[aria-current=true]").getByRole("timer")).toBeVisible();
    }

    // Turns: the first Seat (the creator) rolls first, then play alternates. The
    // first University offer is bought at Level 1; later offers are declined.
    let bought: { field: number; owner: string } | null = null;
    const press = (page: Page, name: string | RegExp) => {
      const button = page.getByRole("button", { name });
      return page === phone ? button.tap() : button.click();
    };
    const playTurn = async (turn: number) => {
      const [roller, waiter] = turn % 2 === 1 ? [desktop, phone] : [phone, desktop];
      await expect(waiter.getByRole("button", { name: "Roll" })).toHaveCount(0);
      await press(roller, "Roll");
      // The roll ends the Turn, or stops at a University offer.
      await expect
        .poll(async () => {
          const view = await viewOf(roller);
          return view?.turn === turn + 1 || view?.phase.kind === "offer";
        })
        .toBe(true);
      const view = await viewOf(roller);
      if (view?.phase.kind === "offer") {
        await expect(roller.getByTestId("offer")).toBeVisible();
        await expect(waiter.getByTestId("offer")).toHaveCount(0);
        if (bought) {
          await press(roller, "Decline");
        } else {
          await press(roller, /^Level 1 · /);
          bought = { field: view.phase.field!, owner: view.currentPlayer };
        }
      }
      await Promise.all(
        both.map((page) => expect.poll(async () => (await viewOf(page))?.turn).toBe(turn + 1)),
      );
    };
    // At least 4 Turns, and on until someone has bought a University.
    for (let turn = 1; turn <= 16; turn++) {
      // oxlint-disable-next-line no-await-in-loop -- Turns are played one after another
      await playTurn(turn);
      if (turn >= 4 && bought) break;
    }

    // Every client got the same view, and sees the bought University's owner and Level.
    const [desktopView, phoneView] = await Promise.all(both.map(viewOf));
    expect(desktopView).toEqual(phoneView);
    expect(desktopView?.version).toBeGreaterThanOrEqual(4);
    expect(bought).not.toBeNull();
    const { field, owner } = bought!;
    expect(desktopView?.fields[field]).toMatchObject({ owner, level: 1 });
    expect(desktopView?.fields[field]?.value).toBeGreaterThan(0);

    // Tapping a Field on the Board (found through the test hook) selects it. The
    // last push's toast can still re-flow the screen and resize the Board, so a
    // tap that misses is retried with a fresh Field centre.
    await expect(async () => {
      const zurich = await fieldCenter(phone, 5);
      expect(zurich).toBeDefined();
      await phone.touchscreen.tap(zurich!.x, zurich!.y);
      await expect(phone.getByTestId("selected-field")).toHaveText("Zurich", { timeout: 1_000 });
    }).toPass();
  } finally {
    await Promise.all([desktopBrowser.close(), phoneBrowser.close()]);
  }
});
