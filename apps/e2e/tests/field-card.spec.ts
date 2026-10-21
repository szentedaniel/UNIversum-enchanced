import { expect, type Page } from "@playwright/test";
import { closeAfterDump, startGame, test } from "./helpers.ts";

// The Board's camera and the tap-to-inspect Field card (#38), on each
// project's device (desktop Chromium and iPhone WebKit). The Board is driven
// through the test-only hooks in apps/web/src/test-hooks.ts.
test.use({ locale: "en-US" });

const camera = (page: Page) => page.evaluate(() => window.universumTest?.camera() ?? null);
const scale = async (page: Page) => (await camera(page))?.scale ?? 0;
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
const fieldCenter = (page: Page, id: number) =>
  page.evaluate((field) => window.universumTest!.fieldCenter(field), id);

/** A tap on a phone, a click on desktop. */
async function tapAt(page: Page, isMobile: boolean, point: { x: number; y: number }) {
  if (isMobile) await page.touchscreen.tap(point.x, point.y);
  else await page.mouse.click(point.x, point.y);
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
  const view = () => page.evaluate(() => window.universumTest?.view() ?? null);
  await expect
    .poll(async () => {
      const now = await view();
      return now?.turn === 2 || now?.phase.kind === "offer";
    })
    .toBe(true);
  if ((await view())?.phase.kind === "offer") {
    await page.getByRole("button", { name: "Decline" }).click();
  }
  await expect.poll(async () => (await view())?.turn).toBe(2);
  await expect.poll(() => scale(page)).toBe(fitted);
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
