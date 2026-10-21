import { expect, type Page } from "@playwright/test";
import { closeAfterDump, fieldCenter, scale, startGame, test } from "./helpers.ts";

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

const pick = (page: Page) => page.evaluate(() => window.universumTest?.pick() ?? null);

/** A tap on a phone, a click on desktop. */
async function tapField(page: Page, isMobile: boolean, id: number) {
  const point = await fieldCenter(page, id);
  if (isMobile) await page.touchscreen.tap(point.x, point.y);
  else await page.mouse.click(point.x, point.y);
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
      // A new decision each time (fresh picks), open now, with `msLeft` on the server's clock.
      const now = hooks.serverNow();
      view.actsAfter = now;
      view.turnDeadline = now + left + 3_000;
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
  const { context } = await startGame(page, browser);
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
    closeAfterDump(context);
  }
});

test("in the last 5 s of an uncovered Sale, Auto-sell's Fields are ringed; a Bankrupt Player's panel says so", async ({
  page,
  browser,
  isMobile,
}) => {
  const { context } = await startGame(page, browser);
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
    closeAfterDump(context);
  }
});

test("the checklist lists the Sale cheapest first with Auto-sell's picks badged, and its rows toggle the picks", async ({
  page,
  browser,
}) => {
  const { context } = await startGame(page, browser);
  try {
    await showSale(page, 15_000);
    const tray = page.getByTestId("sale-tray");
    const toggle = tray.getByTestId("pick-checklist-toggle");
    // It opens the way the Player last left it: collapsed on a fresh client.
    await expect(toggle).toHaveAttribute("aria-pressed", "false");
    await expect(tray.getByTestId("pick-checklist")).toHaveCount(0);
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-pressed", "true");

    const rows = tray.getByTestId("pick-checklist").getByRole("button");
    await expect(rows).toHaveCount(3);
    // Cheapest first, Auto-sell's picks badged.
    await expect(rows.nth(0)).toContainText("Veszprém");
    await expect(rows.nth(0)).toContainText("Auto-sell");
    await expect(rows.nth(1)).toContainText("Budapest");
    await expect(rows.nth(1)).toContainText("Auto-sell");
    await expect(rows.nth(2)).toContainText("Berlin");
    await expect(rows.nth(2)).not.toContainText("Auto-sell");
    await expect(rows.nth(0)).toContainText("180K");
    await expect(rows.nth(2)).toContainText("792K");

    // A row toggles the same pick as a Board tap, and focuses its Field
    // without zooming the camera.
    const before = await scale(page);
    await rows.nth(2).click();
    await expect(rows.nth(2)).toHaveAttribute("aria-pressed", "true");
    await expect.poll(async () => (await pick(page))?.picked).toEqual([BERLIN]);
    await expect(tray.getByRole("button", { name: /^Sell 1 for 792K$/ })).toBeEnabled();
    expect(await scale(page)).toBe(before);

    // A second tap on the row unpicks it; collapsing brings the chips back.
    await rows.nth(2).click();
    await expect.poll(async () => (await pick(page))?.picked).toEqual([]);
    await toggle.click();
    await expect(tray.getByTestId("pick-checklist")).toHaveCount(0);
    await expect(tray.getByText("Tap your Fields on the Board to pick them")).toBeVisible();
  } finally {
    closeAfterDump(context);
  }
});

test("inspect mode opens the Field card for any Field without picking, and ‹ › step through pickable Fields only", async ({
  page,
  browser,
  isMobile,
}) => {
  const { context } = await startGame(page, browser);
  try {
    await showSale(page, 15_000);
    const tray = page.getByTestId("sale-tray");
    const inspect = tray.getByTestId("pick-inspect-toggle");
    await expect(inspect).toHaveAttribute("aria-pressed", "false");
    await inspect.click();
    await expect(inspect).toHaveAttribute("aria-pressed", "true");
    await expect(tray.getByTestId("pick-inspect-hint")).toBeVisible();

    // A tap on a Field the Sale can't pick opens its normal card and picks nothing.
    await tapField(page, isMobile, CHANCE);
    const card = page.getByTestId("field-card");
    await expect(card).toBeVisible();
    await expect(card).toContainText("Chance");
    await expect.poll(async () => (await pick(page))?.picked).toEqual([]);

    // ‹ › step through the Sale's pickable Fields only: Chance → Veszprém → Budapest.
    await card.getByRole("button", { name: "Next Field" }).click();
    await expect(card).toContainText("Veszprém");
    await expect.poll(async () => (await pick(page))?.picked).toEqual([]);
    await card.getByRole("button", { name: "Next Field" }).click();
    await expect(card).toContainText("Budapest");
    await card.getByRole("button", { name: "Previous Field" }).click();
    await expect(card).toContainText("Veszprém");

    // A tap on a pickable Field still only inspects; closing returns to the tray.
    await tapField(page, isMobile, BERLIN);
    await expect(card).toContainText("Berlin");
    await expect.poll(async () => (await pick(page))?.picked).toEqual([]);
    await card.getByRole("button", { name: "Close" }).click();
    await expect(page.getByTestId("field-card")).toHaveCount(0);

    // Leaving inspect mode picks by tap again.
    await page.getByTestId("pick-inspect-toggle").click();
    await tapField(page, isMobile, BERLIN);
    await expect.poll(async () => (await pick(page))?.picked).toEqual([BERLIN]);
  } finally {
    closeAfterDump(context);
  }
});
