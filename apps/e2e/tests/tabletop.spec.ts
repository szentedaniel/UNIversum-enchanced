import { expect, test, type Page } from "@playwright/test";
import { scale } from "./helpers.ts";

// The Tabletop visual direction (#40): theme, fonts and the responsive layouts.
// Runs once per single-browser project: desktop Chromium (corner cards) and
// iPhone WebKit (chips).

const backgroundOf = (page: Page) =>
  page.evaluate(() => getComputedStyle(document.body).backgroundColor);

test("light and dark follow the OS colour scheme", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/");
  expect(await backgroundOf(page)).toBe("rgb(255, 232, 204)"); // #ffe8cc
  await page.emulateMedia({ colorScheme: "dark" });
  expect(await backgroundOf(page)).toBe("rgb(38, 35, 53)"); // #262335
});

test("Sigmar One and Nunito are self-hosted and used", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "UNIversum" })).toHaveCSS(
    "font-family",
    /^"?Sigmar One"?/,
  );
  await expect(page.locator("body")).toHaveCSS("font-family", /^"?Nunito Variable"?/);
  const fonts = await page.evaluate(async () => {
    await document.fonts.ready;
    const loaded = [...document.fonts].filter((f) => f.status === "loaded").map((f) => f.family);
    const files = performance
      .getEntriesByType("resource")
      .map((entry) => new URL(entry.name))
      .filter((url) => url.pathname.endsWith(".woff2"));
    return {
      loaded: loaded.map((family) => family.replaceAll('"', "")),
      sameOrigin: files.length > 0 && files.every((url) => url.origin === location.origin),
    };
  });
  expect(fonts.loaded).toEqual(expect.arrayContaining(["Sigmar One", "Nunito Variable"]));
  expect(fonts.sameOrigin).toBe(true);
});

test("the Room code input has one box per digit and takes a pasted code", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("textbox", { name: "Room code" }).fill("123456");
  await expect(page.getByLabel("Digit 6")).toHaveValue("6");
  await expect(page.getByRole("button", { name: "Join" })).toBeEnabled();
});

test("Lobby and game screens: Seat cards, then Player cards or chips around the Board", async ({
  page,
  browser,
  isMobile,
}) => {
  await page.goto("/create");
  await page.getByLabel("2", { exact: true }).check();
  await page.getByRole("button", { name: "Create Room" }).click();
  await expect(page).toHaveURL(/\/room\/\d{6}$/);
  const code = new URL(page.url()).pathname.split("/").at(-1) ?? "";

  // The Room code is a big sticker button; the Seats are fixed-size cards.
  await expect(page.getByRole("button", { name: "Copy the Room code" })).toContainText(code);
  const seats = page.getByTestId("seat");
  await expect(seats).toHaveCount(2);
  await expect(page.locator("[data-testid=seat][data-open]")).toHaveCount(1);
  await expect(page.getByText("Room creator")).toBeVisible();
  await expect(seats.first()).toContainText("you");
  const [taken, open] = await Promise.all([seats.nth(0).boundingBox(), seats.nth(1).boundingBox()]);
  expect(Math.round(open!.width)).toBe(Math.round(taken!.width));

  // A second Guest joins in its own context, and either starts.
  const other = await browser.newContext();
  try {
    const guest = await other.newPage();
    await guest.goto(`/room/${code}`);
    await expect(page.locator("[data-testid=seat][data-open]")).toHaveCount(0);
    await page.getByRole("button", { name: "Start" }).click();
    await expect(page).toHaveURL(`/game/${code}`);

    const board = await page.getByTestId("board").boundingBox();
    const pill = await page.getByTestId("minute-pill").boundingBox();
    expect(pill!.y + pill!.height).toBeLessThanOrEqual(board!.y); // never over the Board

    if (isMobile) {
      await expect(page.getByTestId("player-chip")).toHaveCount(2);
      await expect(page.getByTestId("player-card")).toHaveCount(0);
      const chip = await page.getByTestId("player-chip").first().boundingBox();
      expect(chip!.y + chip!.height).toBeLessThanOrEqual(pill!.y);
    } else {
      const cards = page.getByTestId("player-card");
      await expect(cards).toHaveCount(2);
      await expect(page.getByTestId("player-chip")).toHaveCount(0);
      // One card per corner: the first Seat top left, the second top right.
      const viewport = page.viewportSize()!;
      const [first, second] = await Promise.all([
        cards.nth(0).boundingBox(),
        cards.nth(1).boundingBox(),
      ]);
      expect(first!.x).toBeLessThan(viewport.width / 4);
      expect(second!.x + second!.width).toBeGreaterThan((viewport.width * 3) / 4);
      // The current Player's card is larger.
      expect(first!.width).toBeGreaterThan(second!.width);
    }

    // A landscape phone (852×393) is too short for the desktop layout: the Board
    // keeps a tall fit area and the Field card becomes a strip at the bottom
    // (story 103), never a side column.
    await page.setViewportSize({ width: 852, height: 393 });
    // The layout switches on the media-query change, then the camera re-fits.
    await expect(page.getByTestId("player-chip")).toHaveCount(2);
    const fit = await page.locator(".board-fit-area").boundingBox();
    expect(fit!.height).toBeGreaterThanOrEqual(200);
    let steady = -1;
    await expect
      .poll(async () => {
        const now = await scale(page);
        const still = now > 0 && now === steady;
        steady = now;
        return still;
      })
      .toBe(true);

    // Tap a Field the compact card does not cover: pick one whose centre is on
    // the canvas (the turn card sits over the Board's bottom in this layout).
    const target = await page.evaluate(() => {
      const hooks = window.universumTest!;
      for (let id = 0; id < 32; id++) {
        const at = hooks.fieldCenter(id);
        if (document.elementFromPoint(at.x, at.y)?.tagName === "CANVAS") return at;
      }
      return null;
    });
    expect(target).not.toBeNull();
    if (isMobile) await page.touchscreen.tap(target!.x, target!.y);
    else await page.mouse.click(target!.x, target!.y);
    const card = await page.getByTestId("field-card").boundingBox();
    expect(card!.y + card!.height).toBeGreaterThan(393 - 20);
    expect(card!.width).toBeGreaterThan(300);
  } finally {
    await other.close();
  }
});
