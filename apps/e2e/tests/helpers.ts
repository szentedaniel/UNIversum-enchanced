/**
 * Shared Playwright behaviour for the specs that act through a game's
 * controls. A phone taps and a desktop clicks, a Board tap waits for the
 * decision gate, and a decision is resolved from the options the view offers;
 * each spec keeps its own assertions and bookkeeping.
 */
import {
  expect,
  type Browser,
  type BrowserContext,
  type Locator,
  type Page,
} from "@playwright/test";
import { PLAYBACK_MS } from "@universum/rules";
import type { FullPhase, FullView } from "./test-hooks.ts";

/** A screen the spec acts through: a phone taps, a desktop clicks. */
export type Interactor = { page: Page; mobile: boolean };

/** Creates a 2-Player Room on `page`, fills it with a second Guest and starts. */
export async function startGame(
  page: Page,
  browser: Browser,
): Promise<{ context: BrowserContext; guest: Page }> {
  await page.goto("/create");
  await page.getByLabel("2", { exact: true }).check();
  await page.getByRole("button", { name: "Create Room" }).click();
  await expect(page).toHaveURL(/\/room\/[1-9]\d{5}$/);
  const code = new URL(page.url()).pathname.split("/").at(-1) ?? "";
  const context = await browser.newContext({ locale: "en-US" });
  const guest = await context.newPage();
  await guest.goto(`/room/${code}`);
  await expect(page.locator("[data-testid=seat][data-open]")).toHaveCount(0);
  await page.getByRole("button", { name: "Start" }).click();
  await expect(page).toHaveURL(`/game/${code}`);
  // The test hooks appear once each screen's Board is up.
  await Promise.all(
    [page, guest].map((screen) =>
      expect
        .poll(() => screen.evaluate(() => window.universumTest?.camera().scale ?? 0))
        .toBeGreaterThan(0),
    ),
  );
  return { context, guest };
}

/** A control the view offers: waits for it to be enabled, then taps or clicks it. */
export async function press(actor: Interactor, target: Locator): Promise<void> {
  await expect(target).toBeEnabled({ timeout: 15_000 });
  if (actor.mobile) await target.tap();
  else await target.click();
}

/** The Player's Fields, cheapest Bank sale value first (Auto-sell's order). */
export function ownFields(view: FullView, player: string): number[] {
  return view.fields
    .map((field, id) => ({ field, id }))
    .filter(({ field }) => field.owner === player)
    .toSorted((a, b) => a.field.sale - b.field.sale || a.id - b.id)
    .map(({ id }) => id);
}

/**
 * Taps a Field through the test-only `fieldCenter` hook and waits until the
 * pick took effect. The Board's Playback must be over first: the dice and a
 * Chance card overlay the Board for their own steps, and the last hop can
 * still be drawing. A tap right after a layout change can miss (#26), so a
 * miss retries with a fresh Field centre.
 */
export async function tapField(actor: Interactor, field: number): Promise<void> {
  await expect(async () => {
    await expect
      .poll(() => actor.page.evaluate(() => window.universumTest?.playback().over ?? false), {
        timeout: PLAYBACK_MS.CardDrawn,
      })
      .toBe(true);
    // Two frames: the Board's queue draws its last hop on the frame after the gate.
    await actor.page.evaluate(async () => {
      await new Promise(requestAnimationFrame);
      await new Promise(requestAnimationFrame);
    });
    const point = await actor.page.evaluate(
      (id) => window.universumTest?.fieldCenter(id) ?? null,
      field,
    );
    if (point === null) throw new Error("the Board is not ready");
    if (actor.mobile) await actor.page.touchscreen.tap(point.x, point.y);
    else await actor.page.mouse.click(point.x, point.y);
    await expect
      .poll(
        () =>
          actor.page.evaluate(
            (id) => window.universumTest?.pick()?.picked.includes(id) ?? false,
            field,
          ),
        { timeout: 1_500 },
      )
      .toBe(true);
  }).toPass({ timeout: 10_000 });
}

export type OfferPhase = Extract<FullPhase, { kind: "offer" }>;
export type OfferChoice = "level" | "museum" | "buyout" | "decline";

/** What resolving a decision did, for each spec's bookkeeping. */
export type DecisionResult =
  | {
      kind: "buy";
      choice: Exclude<OfferChoice, "decline">;
      field: number;
      owner: string;
    }
  | { kind: "decline" }
  | { kind: "pick" }
  | null;

/**
 * Resolves the decision the view is at through the controls it offers: an
 * offer (choosing through `chooseOffer`), a Doubler or Erasmus pick, or a Sale.
 * Returns once the controls were used; the caller waits for the server's
 * answer. Every control appears only once its Playback ends (ADR-0004), so
 * Playwright's auto-wait is what waits it out.
 */
export async function resolveDecision(
  actor: Interactor,
  view: FullView,
  chooseOffer: (phase: OfferPhase) => OfferChoice,
): Promise<DecisionResult> {
  const { phase } = view;
  switch (phase.kind) {
    case "offer": {
      const panel = actor.page.getByTestId("offer");
      await expect(panel).toBeVisible();
      const choice = chooseOffer(phase);
      if (choice === "level") {
        const level = phase.levels?.[0];
        if (level === undefined) throw new Error("the offer has no Level to buy");
        await press(
          actor,
          panel.getByRole("button", { name: new RegExp(`^Level ${level.level} · `) }),
        );
        return { kind: "buy", choice, field: phase.field, owner: view.currentPlayer };
      }
      if (choice === "museum") {
        await press(actor, panel.getByRole("button", { name: /^Buy · / }));
        return { kind: "buy", choice, field: phase.field, owner: view.currentPlayer };
      }
      if (choice === "buyout") {
        await press(actor, panel.getByRole("button", { name: /^Buy out · / }));
        return { kind: "buy", choice, field: phase.field, owner: view.currentPlayer };
      }
      await press(actor, panel.getByRole("button", { name: "Decline", exact: true }));
      return { kind: "decline" };
    }
    case "placingDoubler":
    case "choosingErasmus": {
      const tray = actor.page.getByTestId("pick-tray");
      await expect(tray).toBeVisible();
      const field = phase.fields[0];
      if (field === undefined) throw new Error(`${phase.kind} offered no Field`);
      await tapField(actor, field);
      await press(
        actor,
        phase.kind === "placingDoubler"
          ? tray.getByRole("button", { name: /^Put the Doubler on / })
          : tray.getByRole("button", { name: /^Travel to / }),
      );
      return { kind: "pick" };
    }
    case "selling": {
      const tray = actor.page.getByTestId("sale-tray");
      await expect(tray).toBeVisible();
      const sell = tray.getByRole("button", { name: /^Sell / });
      for (const field of ownFields(view, view.currentPlayer)) {
        // oxlint-disable-next-line no-await-in-loop -- the meter decides the next pick
        if (await sell.isEnabled()) break;
        // oxlint-disable-next-line no-await-in-loop -- one pick at a time updates the meter
        const already = await actor.page.evaluate(
          (id) => window.universumTest?.pick()?.picked.includes(id) ?? false,
          field,
        );
        if (!already) {
          // oxlint-disable-next-line no-await-in-loop -- one pick at a time
          await tapField(actor, field);
        }
      }
      await press(actor, sell);
      return { kind: "pick" };
    }
    case "awaitingRoll":
    case "quarantineChoice":
    case "gameOver":
      return null;
  }
  return null;
}
