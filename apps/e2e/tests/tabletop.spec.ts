import { expect, type Page } from "@playwright/test";
import {
  closeAfterDump,
  expectOneJoinSocket,
  probeSockets,
  registerPage,
  scale,
  startGame,
  test,
} from "./helpers.ts";

// The Tabletop visual direction (#40): theme, fonts, the responsive layouts and
// the R74 Minute pill countdown. Runs once per single-browser project: desktop
// Chromium (corner cards) and iPhone WebKit (chips).

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
  registerPage("creator", page);
  await probeSockets(page);
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
  closeAfterDump(other);
  const guest = await other.newPage();
  registerPage("guest", guest);
  await probeSockets(guest);
  await guest.goto(`/room/${code}`);
  await expect(page.locator("[data-testid=seat][data-open]")).toHaveCount(0);
  await page.getByRole("button", { name: "Start" }).click();
  await expect(page).toHaveURL(`/game/${code}`);
  await Promise.all([expectOneJoinSocket(page, "creator"), expectOneJoinSocket(guest, "guest")]);

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
});

/**
 * The Minute pill's `m:ss` text in milliseconds, and the time left from the
 * view's `endsAt` on the page's own server clock (`serverNow`, #64).
 */
async function countdown(page: Page): Promise<{ shownMs: number; remainingMs: number }> {
  const text = await page.getByTestId("minute-pill").innerText();
  const shown = /(\d+):(\d{2})/.exec(text);
  expect(shown, `the minute pill reads m:ss (got ${JSON.stringify(text)})`).not.toBeNull();
  const remainingMs = await page.evaluate(() => {
    const hooks = window.universumTest!;
    return hooks.room().push!.view.endsAt - hooks.serverNow();
  });
  return { shownMs: (Number(shown![1]) * 60 + Number(shown![2])) * 1000, remainingMs };
}

/**
 * The pill shows the time left from `endsAt`, within the display's own tick: a
 * whole second rounded up, rendered up to a tick before the clock is read.
 */
async function expectCountdownLeft(page: Page): Promise<number> {
  const { shownMs, remainingMs } = await countdown(page);
  expect(shownMs).toBeLessThanOrEqual(Math.ceil(remainingMs / 1000) * 1000 + 2_000);
  expect(shownMs).toBeGreaterThanOrEqual(remainingMs - 2_000);
  return shownMs;
}

// R74: the countdown reads the minutes and seconds left until the Minute
// limit's end. GAME_MINUTE_MS makes a "minute" 8 s here, so the default
// 50-minute Room ends 400 s after Start; the pill is checked against
// `endsAt - serverNow()`, never a wall-clock minute. The text itself is pinned
// in apps/web/test/clock.test.ts.
test("R74: the minute pill counts down the time left in the game", async ({ page, browser }) => {
  await startGame(page, browser);

  const first = await expectCountdownLeft(page);
  // The pill ticks once a second on the server's clock: the text goes down
  // while the page is watched, and still tracks `endsAt` after the tick.
  await expect
    .poll(async () => (await countdown(page)).shownMs, { timeout: 10_000 })
    .toBeLessThan(first);
  await expectCountdownLeft(page);
});
