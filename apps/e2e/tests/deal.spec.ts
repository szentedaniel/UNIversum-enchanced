import { expect, type Page } from "@playwright/test";
import type { PublicView } from "@universum/rules";
import {
  closeAfterDump,
  fieldCenter,
  ownFields,
  playerCards,
  press,
  resolveDecision,
  startGame,
  test,
  type OfferChoice,
  type OfferPhase,
} from "./helpers.ts";

/*
 * #194: two Guests complete a Deal through the real UI. The creator buys a
 * Field on their first Turn, then proposes it on their next one for cash; the
 * guest reads the full terms under the answer timer, accepts, and both screens
 * show the Deal's outcome and the Field's new owner.
 */
test.use({ locale: "en-US" });
test.setTimeout(180_000);

const viewOf = (page: Page): Promise<PublicView | null> =>
  page.evaluate(() => window.universumTest?.room().push?.view ?? null);

const meOf = (page: Page): Promise<string | null> =>
  page.evaluate(() => window.universumTest?.room().me ?? null);

const cashOf = (view: PublicView, player: string): number =>
  view.players.find((candidate) => candidate.id === player)?.cash ?? 0;

/** A screen the spec acts through: its phone project taps, the rest click. */
const actor = (page: Page, mobile: boolean) => ({ page, mobile });

/** The first line of a Player card or chip: the Player's name in the active language. */
async function cardName(page: Page, index: number): Promise<string> {
  const name = (await playerCards(page).nth(index).innerText()).split("\n")[0]?.trim();
  if (!name) throw new Error(`the Player card ${index} shows no name`);
  return name;
}

/** Opens a Field's card and checks the owner it shows, with a fresh tap if one misses. */
async function expectOwner(
  page: Page,
  mobile: boolean,
  field: number,
  name: string,
): Promise<void> {
  await expect(async () => {
    await expect
      .poll(() => page.evaluate(() => window.universumTest?.playback().gateOpen ?? false), {
        timeout: 5_000,
      })
      .toBe(true);
    const point = await fieldCenter(page, field);
    if (mobile) await page.touchscreen.tap(point.x, point.y);
    else await page.mouse.click(point.x, point.y);
    await expect(page.getByTestId("field-card")).toContainText(name, { timeout: 1_500 });
  }).toPass({ timeout: 15_000 });
}

test("two Guests make a Deal and both screens show the new owner", async ({
  page,
  browser,
  isMobile,
}) => {
  const { context, guest } = await startGame(page, browser);
  closeAfterDump(context);
  const creator = await meOf(page);
  const recipient = await meOf(guest);
  if (creator === null || recipient === null) throw new Error("a Guest has no Player id");
  const takeOffer =
    (view: PublicView) =>
    (phase: OfferPhase): OfferChoice => {
      if (view.currentPlayer !== creator || ownFields(view, creator).length > 0) return "decline";
      if (phase.levels.length > 0) return "level";
      return phase.museum === undefined ? "decline" : "museum";
    };

  // Play on until the creator's Roll opens with a Field to put into a Deal.
  let view = await viewOf(page);
  if (view === null) throw new Error("the creator has no view yet");
  for (let step = 0; step < 20; step++) {
    if (view.phase.kind === "gameOver") throw new Error("the game ended before a Deal");
    if (
      view.currentPlayer === creator &&
      view.phase.kind === "awaitingRoll" &&
      ownFields(view, creator).length > 0
    ) {
      break;
    }
    const current = view.currentPlayer === creator ? page : guest;
    const version = view.version;
    // oxlint-disable-next-line no-await-in-loop -- one decision after another
    await resolveDecision(actor(current, current === page && isMobile), view, takeOffer(view));
    // oxlint-disable-next-line no-await-in-loop -- the answer to the decision
    await expect
      .poll(async () => (await viewOf(current))?.version ?? -1, { timeout: 15_000 })
      .toBeGreaterThan(version);
    // oxlint-disable-next-line no-await-in-loop -- the push after the decision
    const next = await viewOf(current);
    if (next === null) throw new Error("the decision left no view");
    view = next;
  }
  const give = ownFields(view, creator)[0];
  if (give === undefined) throw new Error("the creator never owned a Field");

  // The composer offers the creator's own Fields and neither side more cash than it holds.
  await press(actor(page, isMobile), page.getByTestId("deal-open"));
  const composer = page.getByTestId("deal-composer");
  await expect(composer).toBeVisible();
  await expect(composer.getByTestId("deal-recipient")).toHaveCount(1);
  await expect(composer.getByTestId("deal-recipient")).toHaveAttribute("aria-pressed", "true");
  await expect(composer.getByTestId("deal-give-cash")).toHaveAttribute(
    "max",
    String(cashOf(view, creator)),
  );
  await expect(composer.getByTestId("deal-take-cash")).toHaveAttribute(
    "max",
    String(cashOf(view, recipient)),
  );
  await expect(composer.getByTestId(`deal-give-field-${give}`)).toBeVisible();
  await expect(composer.getByTestId(`deal-take-field-${give}`)).toHaveCount(0);
  const notOwned = view.fields.findIndex((field, id) => id !== give && field.owner !== creator);
  await expect(composer.getByTestId(`deal-give-field-${notOwned}`)).toHaveCount(0);

  // Give the Field for 100,000 Ft.
  await press(actor(page, isMobile), composer.getByTestId(`deal-give-field-${give}`));
  await composer.getByTestId("deal-take-cash").fill("100000");
  await press(actor(page, isMobile), composer.getByTestId("deal-propose"));

  // The guest reads the full terms under the answer timer while the creator waits.
  const answer = guest.getByTestId("deal-answer");
  await expect(answer).toBeVisible();
  await expect(answer.getByTestId("deal-answer-give")).toContainText(/Ft\s*100,000/);
  await expect(answer.getByTestId("deal-answer-get")).not.toContainText("nothing");
  await expect(answer.getByRole("timer")).toBeVisible();
  await expect(page.getByTestId("deal-waiting")).toBeVisible();

  // Every screen plays the proposal before the answer.
  await expect(page.getByText(/offered .* a Deal/)).toBeVisible();
  await expect(guest.getByText(/offered .* a Deal/)).toBeVisible();

  const guestView = await viewOf(guest);
  if (guestView === null) throw new Error("the guest has no view at the answer");
  const resolved = await resolveDecision(
    actor(guest, false),
    guestView,
    () => "decline",
    () => "accept",
  );
  expect(resolved).toEqual({ kind: "deal", accepted: true });

  // Both pushes agree that the Field changed hands, and both screens play the outcome.
  await expect
    .poll(
      async () => {
        const [creatorView, guestViewNow] = await Promise.all([viewOf(page), viewOf(guest)]);
        return [
          creatorView?.fields[give]?.owner ?? null,
          guestViewNow?.fields[give]?.owner ?? null,
        ];
      },
      { timeout: 15_000 },
    )
    .toEqual([recipient, recipient]);
  await expect(page.getByText(/made a Deal/)).toBeVisible();
  await expect(guest.getByText(/made a Deal/)).toBeVisible();

  // The Field's card, on both screens, names the guest as its owner.
  const owner = await cardName(guest, 1);
  await expectOwner(page, isMobile, give, owner);
  await expectOwner(guest, false, give, owner);
});
