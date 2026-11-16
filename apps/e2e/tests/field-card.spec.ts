import { expect, type Page } from "@playwright/test";
import {
  closeAfterDump,
  dragBoard,
  expectGate,
  fieldCenter,
  ROLL_PLAYBACK_MS,
  scale,
  shownView,
  startGame,
  test,
} from "./helpers.ts";

// The Board's camera and the tap-to-inspect Field card (#38), on each
// project's device (desktop Chromium and iPhone WebKit). The Board is driven
// through the test-only hooks in apps/web/src/test-hooks.ts.
test.use({ locale: "en-US" });

/** The scale once the camera has stopped moving (buttons animate it). */
async function settledScale(page: Page): Promise<number> {
  let last = -1;
  await expect
    .poll(async () => {
      const now = await scale(page);
      const still = now === last;
      last = now;
      return still;
    })
    .toBe(true);
  return last;
}
/** A tap on a phone, a click on desktop. */
async function tapAt(page: Page, isMobile: boolean, point: { x: number; y: number }) {
  if (isMobile) await page.touchscreen.tap(point.x, point.y);
  else await page.mouse.click(point.x, point.y);
}

/** The same money format the card uses (en-US, forint, "Ft" in every language). */
function moneyOf(amount: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "HUF",
    currencyDisplay: "narrowSymbol",
    maximumFractionDigits: 0,
  }).format(amount);
}

test("a tap opens the nearest Field's card, and the card never changes the zoom", async ({
  page,
  browser,
  isMobile,
}) => {
  const { context } = await startGame(page, browser);
  closeAfterDump(context);
  const card = page.getByTestId("field-card");
  const fitted = await scale(page);

  // A tap on Zurich (Field 5) opens its card: Group band, kind, name, owner.
  await tapAt(page, isMobile, await fieldCenter(page, 5));
  await expect(card.getByRole("heading")).toHaveText("Zurich");
  await expect(card).toContainText("University");
  await expect(card).toContainText("Rent");
  await expect(card).toContainText("Level");
  await expect(card).toContainText("Value");
  await expect(card).toContainText("Unowned");
  // Unowned (#316): the Bank's base price, the plain Level Rent table with no
  // Level highlighted yet, and the Group row with every Field unowned.
  const basePrice = await page.evaluate(() => {
    const view = window.universumTest?.view();
    return view ? (view.fields[5]?.basePrice ?? null) : null;
  });
  if (basePrice === null) throw new Error("the view has no Zurich base price");
  await expect(card.getByTestId("field-card-base-price")).toContainText(moneyOf(basePrice));
  const rents = card.getByTestId("field-card-level-rents");
  await expect(rents.getByTestId("field-card-level-rent")).toHaveCount(4);
  await expect(rents.locator('[aria-current="true"]')).toHaveCount(0);
  const group = card.getByTestId("field-card-group");
  await expect(group.getByTestId("field-card-group-field")).toHaveCount(3);
  await expect(group.locator("[data-shape]")).toHaveCount(0);
  await expect(card.getByTestId("field-card-monopoly")).toHaveCount(0);
  await expect(card.getByTestId("field-card-doubler")).toHaveCount(0);
  expect(await scale(page)).toBe(fitted);

  // ‹ › step round the ring, wrapping past Start; the zoom stays.
  await card.getByRole("button", { name: "Next Field" }).click();
  await expect(card.getByRole("heading")).toHaveText("Paris");
  await tapAt(page, isMobile, await fieldCenter(page, 1));
  await expect(card.getByRole("heading")).toHaveText("Veszprém");
  await card.getByRole("button", { name: "Previous Field" }).click();
  await expect(card.getByRole("heading")).toHaveText("Start");
  await card.getByRole("button", { name: "Previous Field" }).click();
  await expect(card.getByRole("heading")).toHaveText("Cambridge US");
  expect(await scale(page)).toBe(fitted);

  // Zoomed in, a tap still opens the right card and keeps that zoom.
  await page.getByRole("button", { name: "Zoom in" }).click();
  const zoomed = await settledScale(page);
  expect(zoomed).toBeCloseTo(fitted * 1.5, 6);
  // Field 4 sits halfway along the front-left edge, so it stays on screen.
  await tapAt(page, isMobile, await fieldCenter(page, 4));
  await expect(card.getByRole("heading")).toHaveText("Museum");
  // A Museum has no Levels and no Group (#316), so neither row appears.
  await expect(card.getByTestId("field-card-level-rents")).toHaveCount(0);
  await expect(card.getByTestId("field-card-group")).toHaveCount(0);
  for (const _ of [1, 2, 3, 4]) {
    // oxlint-disable-next-line no-await-in-loop -- one step after another
    await card.getByRole("button", { name: "Previous Field" }).click();
  }
  await expect(card.getByRole("heading")).toHaveText("Start");
  // Start, the Board's front tip, would be under the card or off screen at
  // this zoom: stepping pans to show it, but never zooms.
  expect(await scale(page)).toBe(zoomed);
  await expect
    .poll(async () => {
      const start = await fieldCenter(page, 0);
      const box = (await card.boundingBox())!;
      const viewport = page.viewportSize()!;
      const onScreen = start.x > 0 && start.x < viewport.width && start.y > 0;
      const clearOfCard = start.y < box.y || start.x < box.x || start.x > box.x + box.width;
      return onScreen && clearOfCard;
    })
    .toBe(true);

  // Close, then fit: back to the fitted zoom.
  await card.getByRole("button", { name: "Close" }).click();
  await expect(card).toHaveCount(0);
  await page.getByRole("button", { name: "Fit the Board" }).click();
  await expect.poll(() => scale(page)).toBe(fitted);

  // Zoom out, then a Turn change returns the camera to fit.
  await page.getByRole("button", { name: "Zoom out" }).click();
  expect(await settledScale(page)).toBeLessThan(fitted);
  await page.getByRole("button", { name: "Roll" }).click();
  // The roll ends the Turn, or stops at a University offer, declined here.
  await expect
    .poll(async () => {
      const now = await shownView(page);
      return now?.turn === 2 || now?.phase.kind === "offer";
    })
    .toBe(true);
  if ((await shownView(page))?.phase.kind === "offer") {
    await page.getByRole("button", { name: "Decline" }).click();
  }
  await expect.poll(async () => (await shownView(page))?.turn).toBe(2);
  await expect.poll(() => scale(page)).toBe(fitted);
});

test("an owned University's card highlights its current Level among the Level Rents", async ({
  page,
  browser,
  isMobile,
}) => {
  const { context } = await startGame(page, browser);
  closeAfterDump(context);
  const card = page.getByTestId("field-card");

  // The seeded first Roll stops at an unowned University: buy Level 1.
  await page.getByRole("button", { name: "Roll" }).click();
  const offer = page.getByTestId("offer");
  await expect(offer).toBeVisible({ timeout: 15_000 });
  const offered = await page.evaluate(() => {
    const phase = window.universumTest?.view()?.phase;
    return phase?.kind === "offer"
      ? { field: phase.field, levels: phase.levels.map((level) => level.level) }
      : null;
  });
  if (offered === null || offered.levels.length === 0) {
    throw new Error("the first Roll is expected to stop at a University offer");
  }
  await offer.getByRole("button", { name: /^Level 1/ }).click();
  await expect
    .poll(() =>
      page.evaluate((id) => window.universumTest?.view()?.fields[id]?.level ?? 0, offered.field),
    )
    .toBe(1);

  // Tapping the bought Field opens its card; a tap that misses while the
  // camera settles after the Turn change is retried with a fresh centre.
  await expect(async () => {
    await expectGate(page, true, 15_000);
    await tapAt(page, isMobile, await fieldCenter(page, offered.field));
    await expect(
      card.getByTestId("field-card-level-rents").locator('[aria-current="true"]'),
    ).toHaveAttribute("data-level", "1");
  }).toPass({ timeout: 15_000 });

  // The table's four Levels, the current one highlighted with the Level 1 Rent;
  // every cell's label comes from the parameterised `field_card_level_n`
  // (#353), and an owned Field shows no base price and no Doubler badge.
  const rents = card.getByTestId("field-card-level-rents");
  await expect(rents.getByTestId("field-card-level-rent")).toHaveCount(4);
  const levelRent = await page.evaluate(
    (id) => window.universumTest?.view()?.fields[id]?.levelRents[0] ?? null,
    offered.field,
  );
  if (levelRent === null) throw new Error("the owned Field has no Level 1 Rent");
  await expect(rents.locator('[aria-current="true"]')).toContainText("Level 1");
  await expect(rents.locator('[aria-current="true"]')).toContainText(moneyOf(levelRent));
  await expect(rents.getByTestId("field-card-level-rent").nth(3)).toContainText("Level 4");
  await expect(card.getByTestId("field-card-base-price")).toHaveCount(0);
  await expect(card.getByTestId("field-card-doubler")).toHaveCount(0);

  // The Group row lists all three Universities with the bought one's token,
  // and no Monopoly mark while the other two are still unowned.
  const group = card.getByTestId("field-card-group");
  await expect(group.getByTestId("field-card-group-field")).toHaveCount(3);
  await expect(
    group.locator('[data-testid="field-card-group-field"]:not([data-owner=""])'),
  ).toHaveCount(1);
  await expect(group.locator("[data-shape]")).toHaveCount(1);
  await expect(card.getByTestId("field-card-monopoly")).toHaveCount(0);

  // A Doubler on the Field states its count and a completed Group its Monopoly
  // mark (#316, #353). No seeded game reaches the Doubler token or completes a
  // Group this early, and this test adds no hook just for that, so it shows one
  // made-up view with the Group bought out and a Doubler standing on the Field.
  // `apps/web/test/field-facts.test.ts` pins the same two render cases.
  const groupFields = await group
    .getByTestId("field-card-group-field")
    .evaluateAll((members) => members.map((member) => Number(member.getAttribute("data-field"))));
  await page.evaluate(
    ({ id, members }) => {
      const hooks = window.universumTest;
      const push = hooks?.room().push;
      const view = push ? structuredClone(push.view) : null;
      const field = view?.fields[id];
      const viewOwner = view?.players.find((player) => player.id === view.currentPlayer);
      if (!hooks || !view || !field || !viewOwner) throw new Error("no view to patch");
      field.doublers = 2;
      for (const member of members) {
        const memberField = view.fields[member];
        if (!memberField) throw new Error(`no Field ${member} in the view`);
        memberField.owner = viewOwner.id;
      }
      hooks.showView(view);
    },
    { id: offered.field, members: groupFields },
  );
  await expect(card.getByTestId("field-card-doubler")).toHaveText("Doubler ×2");
  await expect(card.getByTestId("field-card-monopoly")).toHaveText("Monopoly");
  await expect(group.locator("[data-shape]")).toHaveCount(3);
});

test("a mouse hover shows the Field tooltip, and a click through it opens the card", async ({
  page,
  browser,
  isMobile,
}) => {
  test.skip(isMobile, "only a mouse pointer raises a hover (#317)");
  const { context } = await startGame(page, browser);
  closeAfterDump(context);
  const tooltip = page.getByTestId("field-tooltip");
  await settledScale(page);

  // Zurich starts unowned: the name, Unowned, and the current Rent (none yet).
  const zurich = await fieldCenter(page, 5);
  await page.mouse.move(zurich.x, zurich.y);
  await expect(tooltip).toBeVisible();
  await expect(tooltip).toContainText("Zurich");
  await expect(tooltip).toContainText("Unowned");
  await expect(tooltip).toContainText("Rent");
  // Beside the Field and on screen, never over the Field it describes.
  const box = (await tooltip.boundingBox())!;
  const viewport = page.viewportSize()!;
  expect(box.x, "the tooltip left the screen").toBeGreaterThanOrEqual(0);
  expect(box.x + box.width, "the tooltip left the screen").toBeLessThanOrEqual(viewport.width);
  expect(box.y, "the tooltip left the screen").toBeGreaterThanOrEqual(0);
  expect(box.y + box.height, "the tooltip left the screen").toBeLessThanOrEqual(viewport.height);
  expect(
    box.x > zurich.x || box.x + box.width < zurich.x,
    "the tooltip covers the Field it describes",
  ).toBe(true);

  // A Chance Field shows the name only, with no owner and no Rent row.
  const chance = await fieldCenter(page, 14);
  await page.mouse.move(chance.x, chance.y);
  await expect(tooltip).toContainText("Chance");
  await expect(tooltip).not.toContainText("Rent");
  await expect(tooltip).not.toContainText("Unowned");

  // Leaving the Board hides it: it is a hover, never pinned.
  await page.mouse.move(2, 2);
  await expect(tooltip).toHaveCount(0);

  // The tooltip takes no pointer events: a click on the hovered Field still
  // opens its card, as a tap always has.
  await page.mouse.move(zurich.x, zurich.y);
  await expect(tooltip).toBeVisible();
  await page.mouse.click(zurich.x, zurich.y);
  await expect(page.getByTestId("field-card").getByRole("heading")).toHaveText("Zurich");
  await expect(tooltip).toHaveCount(0);
});

test("the tooltip shows over an open Offer with the shown view's owner and Rent", async ({
  page,
  browser,
  isMobile,
}) => {
  test.skip(isMobile, "only a mouse pointer raises a hover (#317)");
  const { context } = await startGame(page, browser);
  closeAfterDump(context);
  const tooltip = page.getByTestId("field-tooltip");
  const offer = page.getByTestId("offer");

  // The seeded first Roll stops at an unowned University and waits for an Offer.
  await page.getByRole("button", { name: "Roll" }).click();
  await expect(offer).toBeVisible({ timeout: ROLL_PLAYBACK_MS });
  const offered = await page.evaluate(() => {
    const phase = window.universumTest?.view()?.phase;
    return phase?.kind === "offer" ? phase.field : null;
  });
  if (offered === null) throw new Error("the first Roll is expected to stop at a University offer");

  // The tooltip is its own layer: the Offer keeps the bottom slot.
  const at = await fieldCenter(page, offered);
  await page.mouse.move(at.x, at.y);
  await expect(tooltip).toBeVisible();
  await expect(tooltip).toContainText("Unowned");
  await expect(offer).toBeVisible();

  // The numbers are the shown view's, not the server's latest state: a
  // made-up push owns the Field at a known Rent, as #316's Doubler does.
  const rent = 150_000;
  await page.evaluate(
    ({ id, amount }) => {
      const hooks = window.universumTest;
      const push = hooks?.room().push;
      const view = push ? structuredClone(push.view) : null;
      const field = view?.fields[id];
      const owner = view?.players[0];
      if (!hooks || !view || !field || !owner) throw new Error("no view to own a Field");
      view.fields[id] = {
        ...field,
        owner: owner.id,
        level: 2,
        value: 540_000,
        rent: amount,
        basePrice: 0,
      };
      hooks.showView(view);
    },
    { id: offered, amount: rent },
  );
  await expect(tooltip).toContainText("Owner");
  await expect(tooltip).toContainText(moneyOf(rent));
  await expect(tooltip).not.toContainText("Unowned");

  // No Board obstacle and no pointer events: the Board keeps every tap under it.
  await expect(tooltip).toHaveCSS("pointer-events", "none");
  expect(await tooltip.getAttribute("data-board-obstacle")).toBeNull();
  await expect(offer).toBeVisible();
});

test("a touch pointer raises no tooltip, on a tap or a drag", async ({
  page,
  browser,
  isMobile,
}) => {
  test.skip(!isMobile, "needs a touch-emulating context");
  const { context } = await startGame(page, browser);
  closeAfterDump(context);
  const tooltip = page.getByTestId("field-tooltip");

  // A pan across the Board never flashes one.
  const { before, after } = await dragBoard(page, { dx: 80, dy: 40 });
  expect(after.x, "the drag panned the Board").not.toBe(before.x);
  await expect(tooltip).toHaveCount(0);

  // A tap opens the Field card, as before, and shows no tooltip.
  const zurich = await fieldCenter(page, 5);
  await page.touchscreen.tap(zurich.x, zurich.y);
  await expect(page.getByTestId("field-card").getByRole("heading")).toHaveText("Zurich");
  await expect(tooltip).toHaveCount(0);
});

test("the mouse wheel zooms on desktop", async ({ page, browser, isMobile }) => {
  test.skip(isMobile, "desktop only");
  const { context } = await startGame(page, browser);
  closeAfterDump(context);
  const fitted = await scale(page);
  const centre = await fieldCenter(page, 16);
  await page.mouse.move(centre.x, centre.y);
  await page.mouse.wheel(0, -400);
  await expect.poll(() => scale(page)).toBeGreaterThan(fitted);
  // Zooming anchors on the cursor: the Field under it stays put.
  const after = await fieldCenter(page, 16);
  expect(Math.abs(after.x - centre.x)).toBeLessThan(2);
  expect(Math.abs(after.y - centre.y)).toBeLessThan(2);
});
