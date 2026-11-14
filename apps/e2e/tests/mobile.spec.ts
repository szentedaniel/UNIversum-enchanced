import { devices, expect, type Locator, type Page } from "@playwright/test";
import { z } from "zod";
import { closeAfterDump, dragBoard, press, showPick, startGame, test } from "./helpers.ts";

// The phone smoke of spec #184 (stories 1–5 and 7): the install surface, the
// Player cards, the Board's touch gestures and the Decision tray, on a phone
// viewport in portrait and in landscape. The manifest, the icons, the worker and
// `version.json` are build output, so that test runs in CI only; the layout
// tests run wherever the app is served.
const CI = Boolean(process.env["CI"]);

/**
 * A Playwright phone profile's context options without its browser choice: the
 * spec keeps the project's engine (CI runs Chromium and WebKit) and the profile
 * pins the screen, the touch support and the user agent. `screen` is the
 * viewport: Playwright derives the emulated screen orientation from it, and the
 * project's own screen (Desktop Chrome's 1920×1080) would otherwise stay.
 */
function phoneOf({
  viewport,
  userAgent,
  deviceScaleFactor,
  isMobile,
  hasTouch,
}: (typeof devices)["iPhone 15"]) {
  return {
    viewport,
    screen: viewport,
    userAgent,
    deviceScaleFactor,
    isMobile,
    hasTouch,
    locale: "en-US",
  };
}

const PORTRAIT = phoneOf(devices["iPhone 15"]);
const LANDSCAPE = phoneOf(devices["iPhone 15 landscape"]);

/** The smallest a phone tap target may be (spec #184, story 4). */
const TAP_TARGET_PX = 44;

/** The page's layout viewport, the box its fixed shell and its boxes are in. */
const viewportOf = (page: Page) =>
  page.evaluate(() => ({ width: innerWidth, height: innerHeight }));

/** A box in viewport pixels, as `getBoundingClientRect` reports it. */
type Box = { x: number; y: number; width: number; height: number };

/** The element's box in viewport pixels; a locator that is not on screen has none. */
async function boxOf(target: Locator, label: string) {
  const box = await target.boundingBox();
  expect(box, `${label} is not on screen`).not.toBeNull();
  if (box === null) throw new Error(`${label} is not on screen`);
  return box;
}

/** Every box sits inside the visible viewport: a phone never needs a page scroll. */
async function expectBoxesInsideViewport(
  page: Page,
  boxes: readonly Box[],
  label: string,
): Promise<void> {
  const viewport = await viewportOf(page);
  expect(boxes.length, `${label} is not on screen`).toBeGreaterThan(0);
  const outside = boxes.filter(
    (box) =>
      box.x < 0 ||
      box.y < 0 ||
      box.x + box.width > viewport.width + 1 ||
      box.y + box.height > viewport.height + 1,
  );
  expect(outside, `${label} leaves the visible viewport`).toEqual([]);
}

/** Every element of `target` sits inside the visible viewport. */
async function expectInsideViewport(page: Page, target: Locator, label: string): Promise<void> {
  await expectBoxesInsideViewport(
    page,
    await target.evaluateAll((elements) =>
      elements.map((element) => {
        const { x, y, width, height } = element.getBoundingClientRect();
        return { x, y, width, height };
      }),
    ),
    label,
  );
}

/**
 * The card's scroll frame and the card once that frame has scrolled to its end.
 * A phone caps the bottom card at its budget and scrolls a taller card inside
 * the frame (#264; the Doubler's hint renders inside the tray), so the frame is
 * what clips the card and must fit the screen; scrolling to the end brings the
 * card itself on screen too.
 */
async function cardBoxesAtScrollEnd(target: Locator, label: string): Promise<readonly Box[]> {
  const boxes = await target.evaluate((element) => {
    for (let node = element.parentElement; node !== null; node = node.parentElement) {
      const { overflowY } = getComputedStyle(node);
      if (overflowY !== "auto" && overflowY !== "scroll") continue;
      const { x, y, width, height } = node.getBoundingClientRect();
      node.scrollTop = node.scrollHeight;
      const card = element.getBoundingClientRect();
      return [
        { x, y, width, height },
        { x: card.x, y: card.y, width: card.width, height: card.height },
      ];
    }
    return null;
  });
  expect(boxes, `${label} has no scroll frame`).not.toBeNull();
  if (boxes === null) throw new Error(`${label} has no scroll frame`);
  return boxes;
}

/** Every button inside `target` is a thumb-sized tap target (spec #184, story 4). */
async function expectTapTargets(target: Locator, label: string): Promise<void> {
  const buttons = await target.getByRole("button").evaluateAll((elements) =>
    elements.map((element) => ({
      label: element.getAttribute("aria-label") ?? element.textContent?.trim() ?? "",
      height: element.getBoundingClientRect().height,
    })),
  );
  expect(buttons.length, `${label} offers no button`).toBeGreaterThan(0);
  expect(
    buttons.filter(({ height }) => height < TAP_TARGET_PX),
    `${label} has a button under ${TAP_TARGET_PX} px`,
  ).toEqual([]);
}

/**
 * The phone game, end to end: the strip's Player cards, a one-finger Board drag
 * and the Doubler's Decision tray. A card taller than its budget scrolls inside
 * the frame instead of clearing the whole screen (#264), so this checks the tray
 * is on screen and its pinned primary action reachable; the portrait test adds
 * the frame and the card at the end of that scroll.
 */
async function expectPhoneGame(page: Page, isMobile: boolean): Promise<void> {
  const actor = { page, mobile: isMobile };
  const chips = page.getByTestId("player-chip");
  const card = page.getByTestId("player-card");

  // Story 5: chips are the phone's Player cards.
  await expect(chips).toHaveCount(2);
  await expectInsideViewport(page, chips, "the Player chips");

  // Story 3: a one-finger drag pans the Board; the page never scrolls under it.
  // The drag comes before the strip changes height: a card opening resizes the
  // Board, and its re-fit must not land inside the drag's two camera reads.
  const { before, after } = await dragBoard(page, { dx: 80, dy: 40 });
  expect(after.x, "the drag panned the Board").not.toBe(before.x);
  expect(after.scale, "a one-finger drag never zooms").toBe(before.scale);
  expect(await page.evaluate(() => window.scrollY), "the page scrolled under the drag").toBe(0);

  // One tap opens the full card in the strip's place — above the Board, never
  // over it.
  await press(actor, chips.first().getByRole("button"));
  await expect(card).toHaveCount(1);
  await expectInsideViewport(page, card, "the Player card");
  const [cardBox, boardBox] = await Promise.all([
    boxOf(card, "the Player card"),
    boxOf(page.getByTestId("board"), "the Board"),
  ]);
  expect(cardBox.y + cardBox.height, "the Player card covers the Board").toBeLessThanOrEqual(
    boardBox.y + 1,
  );
  await press(actor, card.getByRole("button", { name: "Collapse the card" }));
  await expect(card).toHaveCount(0);

  // Story 4: the tray's controls are thumb-sized and the tray is on screen.
  await showPick(page, "doubler");
  const tray = page.getByTestId("pick-tray");
  await expect(tray).toBeVisible();
  const [trayBox, viewport] = await Promise.all([boxOf(tray, "the tray"), viewportOf(page)]);
  expect(trayBox.x, "the tray starts left of the phone").toBeGreaterThanOrEqual(0);
  expect(trayBox.x + trayBox.width, "the tray ends right of the phone").toBeLessThanOrEqual(
    viewport.width + 1,
  );
  expect(trayBox.y, "the tray starts above the phone").toBeGreaterThanOrEqual(0);
  await expectTapTargets(tray, "the tray");

  // Its checklist picks a Field (the tray's own list, so the check holds in both
  // orientations); the chip it leaves is a tap target too. The row is tapped
  // near its top: the tray's primary action pins to the scrollport's bottom, so
  // a short screen covers a row's centre (#264).
  await press(actor, tray.getByTestId("pick-checklist-toggle"));
  const rows = tray.getByTestId("pick-checklist").getByRole("button");
  await expect(rows).toHaveCount(2);
  await expectTapTargets(tray.getByTestId("pick-checklist"), "the checklist");
  const row = rows.first();
  await expect(row).toBeEnabled();
  await row.tap({ position: { x: 12, y: 6 } });
  await press(actor, tray.getByTestId("pick-checklist-toggle"));
  await expect(tray.getByRole("button", { name: /^Remove / })).toHaveCount(1);
  await expectTapTargets(tray, "the tray");
  await expect(
    tray.getByRole("button", { name: /^Put the Doubler on / }),
    "the tray's primary action is reachable",
  ).toBeInViewport();
}

/** The manifest fields this spec checks, as the web build's `manifestFor` writes them. */
const manifestSchema = z.object({
  display: z.string(),
  icons: z.array(z.object({ src: z.string(), sizes: z.string(), purpose: z.string().optional() })),
});
/** `version.json`, the release the page and the worker compare. */
const versionSchema = z.object({ release: z.string().min(1) });

test.describe("phone portrait", () => {
  test.use(PORTRAIT);

  test("the install surface: a standalone manifest, maskable icons, the worker and version.json", async ({
    page,
  }) => {
    test.skip(!CI, "the install surface is build output; CI previews the built app");
    await page.goto("/");

    // Story 1: the page links the manifest the build writes at the root, served
    // as a manifest rather than as a file of unknown type.
    const manifestPath = "/manifest.webmanifest";
    const href = await page.locator('link[rel="manifest"]').getAttribute("href");
    expect(href, "the page links a manifest").toBe(manifestPath);
    const manifestResponse = await page.request.get(manifestPath);
    expect(manifestResponse.status(), "the manifest is served").toBe(200);
    expect(
      manifestResponse.headers()["content-type"],
      "the manifest is served as application/manifest+json",
    ).toContain("application/manifest+json");
    const manifest = manifestSchema.parse(await manifestResponse.json());
    // Story 1: an installed copy opens without the browser's chrome.
    expect(manifest.display, "the manifest opens standalone").toBe("standalone");

    // Stories 2 and 7: every icon the manifest lists is served as an image and
    // decodes at its declared size, and one is maskable (Android masks the edges
    // of the others).
    const icons = manifest.icons;
    expect(icons.length, "the manifest lists icons").toBeGreaterThan(0);
    expect(
      icons.filter((icon) => icon.purpose?.includes("maskable")).length,
      "an icon is maskable",
    ).toBeGreaterThan(0);
    const served = await Promise.all(
      icons.map(async (icon) => {
        const response = await page.request.get(icon.src);
        const decoded = await page.evaluate(async (src) => {
          const image = new Image();
          image.src = src;
          await image.decode();
          return `${String(image.naturalWidth)}x${String(image.naturalHeight)}`;
        }, icon.src);
        return {
          src: icon.src,
          declared: icon.sizes,
          decoded,
          status: response.status(),
          type: response.headers()["content-type"],
        };
      }),
    );
    expect(
      served.filter(({ status }) => status !== 200),
      "every icon is served",
    ).toEqual([]);
    expect(
      served.filter(({ type }) => !type?.startsWith("image/")),
      "every icon is an image",
    ).toEqual([]);
    expect(
      served.filter(({ decoded, declared }) => decoded !== declared),
      "every icon decodes at its declared size",
    ).toEqual([]);

    // Story 1: the worker and the release it compares are served. Whether the
    // worker controls the page is the browser's: it registers only in a
    // production build over a secure context.
    const worker = await page.request.get("/sw.js");
    expect(worker.status(), "the worker is served").toBe(200);
    expect(worker.headers()["content-type"], "the worker is JavaScript").toContain("javascript");
    const version = await page.request.get("/version.json");
    expect(version.status(), "version.json is served").toBe(200);
    // Throws unless the served release is a non-empty name.
    versionSchema.parse(await version.json());
  });

  test("a portrait phone: Player cards, the Board drag and the Decision tray fit the screen", async ({
    page,
    browser,
    isMobile,
  }) => {
    const { context } = await startGame(page, browser);
    try {
      await expectPhoneGame(page, isMobile);
      // A portrait phone reserves 14rem for the card (#264), but the Doubler's
      // hint renders inside the tray and takes it past that budget (292 px
      // against 224 on the iPhone 15 profile). The card then scrolls inside
      // Game.tsx's frame: the frame clips it, so the frame, and the tray at the
      // end of the scroll, are what must sit on the screen.
      const boxes = await cardBoxesAtScrollEnd(page.getByTestId("pick-tray"), "the tray");
      await expectBoxesInsideViewport(page, boxes, "the tray's card");
    } finally {
      closeAfterDump(context);
    }
  });
});

test.describe("phone landscape", () => {
  test.use(LANDSCAPE);

  test("a landscape phone: Player cards, the Board drag and the Decision tray fit the screen", async ({
    page,
    browser,
    isMobile,
  }) => {
    const { context } = await startGame(page, browser);
    try {
      await expectPhoneGame(page, isMobile);
    } finally {
      closeAfterDump(context);
    }
  });
});
