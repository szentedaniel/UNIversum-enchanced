import { expect, type Page } from "@playwright/test";
import { closeAfterDump, fieldCenter, startGame, test } from "./helpers.ts";

// The single-pick tray (#31): the Doubler and Erasmus. A random game can't be
// steered into either corner, so the test shows a made-up view through the
// test-only `showView` hook (as if the server had pushed it) and checks the
// flow: taps snap to pickable Fields and select one, the chip, the effect and
// the commit button. Nothing is sent to the server.
test.use({ locale: "en-US" });

const VESZPREM = 1; // next to Budapest, not pickable
const BUDAPEST = 2; // the Doubler's Field
const BERLIN = 15; // the other pickable Field
const LONDON = 21; // Erasmus: past Start
const MUSEUM_4 = 28; // Erasmus: ahead

const pick = (page: Page) => page.evaluate(() => window.universumTest?.pick() ?? null);

/** A tap on a phone, a click on desktop. */
async function tapField(page: Page, isMobile: boolean, id: number) {
  const point = await fieldCenter(page, id);
  if (isMobile) await page.touchscreen.tap(point.x, point.y);
  else await page.mouse.click(point.x, point.y);
}

/** This Guest is choosing: the view lists `fields`, the view carries their effect. */
function showPick(page: Page, pickKind: "doubler" | "erasmus") {
  return page.evaluate(
    ({ kind, fields }) => {
      const hooks = window.universumTest!;
      const { me, push } = hooks.room();
      const view = structuredClone(push!.view);
      view.currentPlayer = me!;
      const own = (id: number, level: number, rent: number) => {
        view.fields[id] = { owner: me, level, value: 0, rent, sale: 0 };
      };
      if (kind === "doubler") {
        view.phase = { kind: "placingDoubler", fields: [fields.budapest, fields.berlin] };
        own(fields.budapest, 1, 121_000);
        own(fields.berlin, 4, 880_000);
        view.pickOptions = [
          { kind: "doubler", field: fields.budapest, rent: 121_000, rentAfter: 242_000 },
          { kind: "doubler", field: fields.berlin, rent: 880_000, rentAfter: 1_760_000 },
        ];
      } else {
        view.phase = { kind: "choosingErasmus", fields: [fields.london, fields.museum4] };
        view.fields[fields.london] = { owner: null, level: 0, value: 0, rent: 0, sale: 0 };
        view.fields[fields.museum4] = { owner: null, level: 0, value: 0, rent: 0, sale: 0 };
        view.pickOptions = [
          { kind: "erasmus", field: fields.london, steps: 29, passesStart: true, bonus: 250_000 },
          { kind: "erasmus", field: fields.museum4, steps: 4, passesStart: false, bonus: null },
        ];
      }
      // A new decision each time (fresh picks), open now, with time on the server's clock.
      const now = hooks.serverNow();
      view.actsAfter = now;
      view.turnDeadline = now + 18_000;
      view.turnTimer = { endsAt: view.turnDeadline - 3_000, limitMs: 20_000 };
      hooks.showView(view);
    },
    {
      kind: pickKind,
      fields: { budapest: BUDAPEST, berlin: BERLIN, london: LONDON, museum4: MUSEUM_4 },
    },
  );
}

test("placing the Doubler: taps snap to the Player's Fields, replace the choice and show the Rent effect", async ({
  page,
  browser,
  isMobile,
}) => {
  const { context } = await startGame(page, browser);
  try {
    await showPick(page, "doubler");
    const tray = page.getByTestId("pick-tray");
    await expect(tray).toBeVisible();
    await expect(tray.getByRole("button", { name: "Put the Doubler" })).toBeDisabled();
    await expect
      .poll(() => pick(page))
      .toEqual({ pickable: [BUDAPEST, BERLIN], picked: [], ringed: [] });

    // A tap next to Budapest snaps to it; the tray shows the Rent effect and names the action.
    await tapField(page, isMobile, VESZPREM);
    await expect(tray.getByTestId("pick-effect")).toHaveText("Rent 121K → 242K");
    await expect(tray.getByRole("button", { name: "Put the Doubler on Budapest" })).toBeEnabled();
    await expect(tray.getByRole("button", { name: "Remove Budapest" })).toBeVisible();
    await expect.poll(async () => (await pick(page))?.picked).toEqual([BUDAPEST]);
    // A tap never opens the Field card during a pick.
    await expect(page.getByTestId("field-card")).toHaveCount(0);

    // A second tap replaces the choice; there is never more than one.
    await tapField(page, isMobile, BERLIN);
    await expect(tray.getByTestId("pick-effect")).toHaveText("Rent 880K → 1.8M");
    await expect(tray.getByRole("button", { name: "Put the Doubler on Berlin" })).toBeEnabled();
    await expect(tray.getByRole("button", { name: "Remove Budapest" })).toHaveCount(0);
    await expect.poll(async () => (await pick(page))?.picked).toEqual([BERLIN]);

    // A chip tap clears the choice and the commit button waits again.
    await tray.getByRole("button", { name: "Remove Berlin" }).click();
    await expect(tray.getByRole("button", { name: "Put the Doubler" })).toBeDisabled();
    await expect.poll(async () => (await pick(page))?.picked).toEqual([]);
  } finally {
    closeAfterDump(context);
  }
});

test("choosing Erasmus: the tray shows the Fields ahead and whether Start is passed", async ({
  page,
  browser,
  isMobile,
}) => {
  const { context } = await startGame(page, browser);
  try {
    await showPick(page, "erasmus");
    const tray = page.getByTestId("pick-tray");
    await expect(tray).toBeVisible();

    await tapField(page, isMobile, LONDON);
    await expect(tray.getByTestId("pick-effect")).toHaveText(
      "29 Fields ahead · Passes Start +250K",
    );
    await expect(tray.getByRole("button", { name: "Travel to London" })).toBeEnabled();
    await expect.poll(async () => (await pick(page))?.picked).toEqual([LONDON]);

    // A destination before Start has no bonus line and replaces the choice.
    await tapField(page, isMobile, MUSEUM_4);
    await expect(tray.getByTestId("pick-effect")).toHaveText("4 Fields ahead");
    await expect(tray.getByRole("button", { name: "Travel to Museum" })).toBeEnabled();
    await expect.poll(async () => (await pick(page))?.picked).toEqual([MUSEUM_4]);
  } finally {
    closeAfterDump(context);
  }
});

test("the checklist lists Erasmus destinations nearest first and stays expanded across picks and reloads", async ({
  page,
  browser,
}) => {
  const { context } = await startGame(page, browser);
  try {
    await showPick(page, "erasmus");
    const tray = page.getByTestId("pick-tray");
    const toggle = tray.getByTestId("pick-checklist-toggle");
    // It opens the way the Player last left it: collapsed on a fresh client.
    await expect(toggle).toHaveAttribute("aria-pressed", "false");
    await toggle.click();
    const rows = tray.getByTestId("pick-checklist").getByRole("button");
    await expect(rows).toHaveCount(2);
    // Erasmus is ordered by distance ahead: Museum (4) before London (29).
    await expect(rows.nth(0)).toContainText("Museum");
    await expect(rows.nth(0)).toContainText("4 Fields ahead");
    await expect(rows.nth(1)).toContainText("London");
    await expect(rows.nth(1)).toContainText("29 Fields ahead");
    await expect(rows.nth(1)).toContainText("Passes Start +250K");

    // A row selects the destination, replacing the Board's single choice.
    await rows.nth(1).click();
    await expect(rows.nth(1)).toHaveAttribute("aria-pressed", "true");
    await expect.poll(async () => (await pick(page))?.picked).toEqual([LONDON]);
    await expect(tray.getByRole("button", { name: "Travel to London" })).toBeEnabled();

    // The next pick opens expanded, as it was left.
    await showPick(page, "doubler");
    await expect(page.getByTestId("pick-tray").getByTestId("pick-checklist")).toBeVisible();
    await expect(page.getByTestId("pick-checklist-toggle")).toHaveAttribute("aria-pressed", "true");

    // So does the game after a reload.
    await page.reload();
    await expect
      .poll(() =>
        page.evaluate(() =>
          Boolean(window.universumTest?.view() && window.universumTest.room().me),
        ),
      )
      .toBe(true);
    await showPick(page, "doubler");
    await expect(page.getByTestId("pick-tray").getByTestId("pick-checklist")).toBeVisible();
    await expect(page.getByTestId("pick-checklist-toggle")).toHaveAttribute("aria-pressed", "true");
  } finally {
    closeAfterDump(context);
  }
});
