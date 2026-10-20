import { expect, test, type Browser, type Page } from "@playwright/test";

// The Sale tray (#29), on each project's device. A random game can't be steered
// into a Sale, so the test shows a made-up selling view through the test-only
// `showView` hook (as if the server had pushed it) and checks the pick flow:
// taps snap to the Player's Fields and toggle them, chips, the meter, the
// commit button and the Board's marks. Nothing is sent to the server.
test.use({ locale: "en-US" });

const VESZPREM = 1; // sale 180,000
const BUDAPEST = 2; // sale 198,000
const CHANCE = 14; // not the Player's; next to Berlin
const BERLIN = 15; // sale 792,000
const SEATTLE = 17;

const fieldCenter = (page: Page, id: number) =>
  page.evaluate((field) => window.universumTest!.fieldCenter(field), id);
const pick = (page: Page) => page.evaluate(() => window.universumTest?.pick() ?? null);

/** A tap on a phone, a click on desktop. */
async function tapField(page: Page, isMobile: boolean, id: number) {
  const point = await fieldCenter(page, id);
  if (isMobile) await page.touchscreen.tap(point.x, point.y);
  else await page.mouse.click(point.x, point.y);
}

/** Creates a 2-Player Room on `page`, fills it with a second Guest and starts. */
async function startGame(page: Page, browser: Browser) {
  await page.goto("/create");
  await page.getByLabel("2", { exact: true }).check();
  await page.getByRole("button", { name: "Create Room" }).click();
  await expect(page).toHaveURL(/\/room\/[1-9]\d{5}$/);
  const code = new URL(page.url()).pathname.split("/").at(-1) ?? "";
  const other = await browser.newContext({ locale: "en-US" });
  const guest = await other.newPage();
  await guest.goto(`/room/${code}`);
  await expect(page.locator("[data-testid=seat][data-open]")).toHaveCount(0);
  await page.getByRole("button", { name: "Start" }).click();
  await expect(page).toHaveURL(`/game/${code}`);
  await expect
    .poll(() => page.evaluate(() => window.universumTest?.camera().scale ?? 0))
    .toBeGreaterThan(0);
  return other;
}

/** This Guest owes Seattle's Rent: a Sale for a 300,000 Shortfall, with `msLeft` on the timer. */
function showSale(page: Page, msLeft: number, otherBankrupt = false) {
  return page.evaluate(
    ({ left, bankrupt, fields }) => {
      const hooks = window.universumTest!;
      const { me, push } = hooks.room();
      const view = structuredClone(push!.view);
      const other = view.players.find((p) => p.id !== me)!;
      other.bankrupt = bankrupt;
      view.currentPlayer = me!;
      view.phase = {
        kind: "selling",
        shortfall: 300_000,
        resume: { kind: "rent", amount: 400_000, owner: other.id, field: fields.seattle },
      };
      const own = (id: number, level: number, sale: number) => {
        view.fields[id] = { owner: me, level, value: 0, rent: 0, sale };
      };
      own(fields.veszprem, 1, 180_000);
      own(fields.budapest, 1, 198_000);
      own(fields.berlin, 4, 792_000);
      view.fields[fields.seattle] = { owner: other.id, level: 1, value: 0, rent: 0, sale: 0 };
      view.autoSell = [fields.veszprem, fields.budapest];
      // A new decision each time (fresh picks), with `msLeft` on the server's clock.
      view.turnDeadline = Date.now() + push!.clockOffset + left + 3_000;
      view.turnTimer = { endsAt: view.turnDeadline - 3_000, limitMs: 20_000 };
      hooks.showView(view);
    },
    {
      left: msLeft,
      bankrupt: otherBankrupt,
      fields: { veszprem: VESZPREM, budapest: BUDAPEST, berlin: BERLIN, seattle: SEATTLE },
    },
  );
}

test("in a Sale, taps snap to the Player's Fields and toggle them; Sell unlocks once the Shortfall is covered", async ({
  page,
  browser,
  isMobile,
}) => {
  const other = await startGame(page, browser);
  try {
    await showSale(page, 15_000);
    const tray = page.getByTestId("sale-tray");
    await expect(tray).toBeVisible();
    await expect(tray.getByTestId("sale-shortfall")).toContainText("Shortfall");
    await expect(tray).toContainText("Rent");
    const sell = tray.getByRole("button", { name: /^Sell / });
    await expect(sell).toBeDisabled();
    // Only the Player's Fields can be picked (the rest are greyed), cheapest first.
    await expect
      .poll(() => pick(page))
      .toEqual({
        pickable: [VESZPREM, BUDAPEST, BERLIN],
        picked: [],
        ringed: [],
      });

    // A tap on Berlin picks it: a chip, and Sell names the count and the money.
    await tapField(page, isMobile, BERLIN);
    await expect(tray.getByRole("button", { name: "Remove Berlin" })).toBeVisible();
    await expect(sell).toBeEnabled();
    await expect(sell).toHaveText(/^Sell 1 for 792K$/);
    await expect.poll(async () => (await pick(page))?.picked).toEqual([BERLIN]);
    // A tap never opens the Field card during a pick.
    await expect(page.getByTestId("field-card")).toHaveCount(0);

    // A tap on the Chance Field next to it snaps to Berlin and unpicks it.
    await tapField(page, isMobile, CHANCE);
    await expect(tray.getByRole("button", { name: "Remove Berlin" })).toHaveCount(0);
    await expect(sell).toBeDisabled();

    // Veszprém alone is short; with Budapest the picks cover the Shortfall.
    await tapField(page, isMobile, VESZPREM);
    await expect(sell).toBeDisabled();
    await tapField(page, isMobile, BUDAPEST);
    await expect(sell).toHaveText(/^Sell 2 for 378K$/);
    await expect(sell).toBeEnabled();

    // A tap on a chip removes it.
    await tray.getByRole("button", { name: "Remove Budapest" }).click();
    await expect.poll(async () => (await pick(page))?.picked).toEqual([VESZPREM]);
    await expect(sell).toBeDisabled();
  } finally {
    await other.close();
  }
});

test("in the last 5 s of an uncovered Sale, Auto-sell's Fields are ringed; a Bankrupt Player's panel says so", async ({
  page,
  browser,
  isMobile,
}) => {
  const other = await startGame(page, browser);
  try {
    await showSale(page, 4_000, true);
    await expect.poll(async () => (await pick(page))?.ringed).toEqual([VESZPREM, BUDAPEST]);
    await expect(
      page.getByTestId("sale-tray").getByRole("button", { name: /Auto-sell/ }),
    ).toBeEnabled();
    const panels = page.locator("[data-testid=player-card], [data-testid=player-chip]");
    await expect(panels.filter({ hasText: "Bankrupt" })).toHaveCount(1);

    // Covered: no more warning.
    await tapField(page, isMobile, BERLIN);
    await expect.poll(async () => (await pick(page))?.ringed).toEqual([]);
  } finally {
    await other.close();
  }
});
