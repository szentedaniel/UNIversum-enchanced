import {
  chromium,
  devices,
  expect,
  webkit,
  type BrowserContext,
  type Page,
} from "@playwright/test";
import { playbackOf, type GameEvent, type PublicView } from "@universum/rules";
import {
  closeAfterDump,
  press,
  registerPage,
  resolveDecision,
  test,
  type OfferChoice,
  type OfferPhase,
} from "./helpers.ts";

/*
 * Definition of done item 3 (spec: Testing Decisions, seam 3): four Guests on
 * mixed desktop and phone devices create and join a Room through the real UI,
 * play a full game to game over by acting only on the options the view offers,
 * one of them drops and rejoins mid-game, and every screen ends on the same
 * single-winner podium.
 *
 * The Room server gets short "minutes" through GAME_MINUTE_MS
 * (playwright.config.ts), and the Room's own 10 s Turn timer keeps a decision
 * short, so a 15-minute Room ends after two minutes of play. At least one Turn
 * is left to time out while one Guest is away.
 */

test.use({ locale: "en-US" });
// Setup, a deliberate timeout, the whole game and the final assertions.
test.setTimeout(300_000);

/**
 * The longest Playback a game-ending push carries: a Roll onto Chance (the
 * dice, a 12-Field walk, the 7 s card, its effect — three Player-to-Player
 * payments is the longest — and the Round bonus) plus the GameEnded beat. The
 * podium appears only after the local Playback (#51), so its wait must allow
 * this instead of Playwright's 5 s default.
 */
const FINAL_PLAYBACK_MS = playbackOf([
  { type: "DiceRolled", player: "p1", dice: [6, 6] },
  { type: "Moved", player: "p1", from: 0, to: 12, steps: 12 },
  { type: "CardDrawn", player: "p1", card: "dormParty" },
  { type: "ChanceTransferPaid", player: "p2", payee: "p1", amount: 0 },
  { type: "ChanceTransferPaid", player: "p3", payee: "p1", amount: 0 },
  { type: "ChanceTransferPaid", player: "p4", payee: "p1", amount: 0 },
  { type: "RoundBonusPaid", player: "p1", amount: 0 },
  { type: "GameEnded", winner: "p1", reason: "timeUp" },
] satisfies readonly GameEvent[]);

type Guest = {
  name: string;
  page: Page;
  context: BrowserContext;
  /** iPhone WebKit: taps instead of clicks. */
  mobile: boolean;
  id: string;
};

const viewOf = (page: Page): Promise<PublicView | null> =>
  page.evaluate(() => window.universumTest?.room().push?.view ?? null);

const meOf = (page: Page): Promise<string | null> =>
  page.evaluate(() => window.universumTest?.room().me ?? null);

const eventTypesOf = (page: Page): Promise<string[]> =>
  page.evaluate(() => window.universumTest?.room().push?.events.map((event) => event.type) ?? []);

/** Waits until the server's answer to this action has arrived. */
async function past(guest: Guest, version: number): Promise<void> {
  await expect
    .poll(async () => (await viewOf(guest.page))?.version ?? -1, { timeout: 15_000 })
    .toBeGreaterThan(version);
}

/** The newest view any client holds: pushes reach the four clients a moment apart. */
async function latestView(guests: readonly Guest[]): Promise<PublicView> {
  const views = await Promise.all(guests.map((guest) => viewOf(guest.page)));
  const present = views.filter((view): view is PublicView => view !== null);
  const newest = present.reduce<PublicView | null>(
    (latest, view) => (latest === null || view.version > latest.version ? view : latest),
    null,
  );
  if (newest === null) throw new Error("no client has a view yet");
  return newest;
}

/** Every event every client has been sent since the last call (the same pushes, once). */
async function scanEvents(guests: readonly Guest[], seen: Set<string>): Promise<void> {
  const lists = await Promise.all(guests.map((guest) => eventTypesOf(guest.page)));
  for (const types of lists) for (const type of types) seen.add(type);
}

/**
 * Plays the current decision through the controls it offers, then waits for
 * the server's answer. Returns the step it covered (`null` for a Roll, a
 * Quarantine roll or a Decline).
 */
async function playDecision(guest: Guest, view: PublicView): Promise<"buy" | "pick" | null> {
  const result = await resolveDecision(guest, view, takeOffer);
  await past(guest, view.version);
  return result.kind === "buy" ? "buy" : result.kind === "pick" ? "pick" : null;
}

/** The offer this test takes: the first Level or Museum offered, otherwise Decline (never a Buyout). */
function takeOffer(phase: OfferPhase): OfferChoice {
  if (phase.levels.length > 0) return "level";
  return phase.museum === undefined ? "decline" : "museum";
}

/**
 * The mid-game drop: the Guest goes offline on their Turn, the page closes and
 * a fresh page in the same browser context comes back to the same Seat by Guest
 * token. The Seat was held for them: if it had been freed, the rejoin would be
 * refused and `me` would not match.
 */
async function dropAndRejoin(guest: Guest, guests: readonly Guest[], code: string): Promise<void> {
  await guest.context.setOffline(true);
  // The overlay depends on WebKit noticing the offline event before the close;
  // #35's reconnect spec owns that assertion (it can miss on a busy machine).
  await guest.page
    .getByTestId("reconnect-overlay")
    .waitFor({ state: "visible", timeout: 5_000 })
    .catch(() => {});
  await guest.page.close();
  await guest.context.setOffline(false);

  // The Seat is still in every other screen's view...
  for (const other of guests.filter((candidate) => candidate !== guest)) {
    // oxlint-disable-next-line no-await-in-loop -- one screen at a time
    const otherView = await viewOf(other.page);
    expect(otherView?.players).toHaveLength(4);
    expect(otherView?.players.map((player) => player.id)).toContain(guest.id);
  }

  // ...and the Guest token returns this browser to it.
  const again = await guest.context.newPage();
  await again.goto(`/game/${code}`);
  await expect(again.getByTestId("turn-of")).toBeVisible({ timeout: 30_000 });
  await expect.poll(() => meOf(again), { timeout: 30_000 }).toBe(guest.id);
  guest.page = again;
  registerPage(guest.name, again);
}

/** Waits for the server to time out the Turn in progress, and records its events. */
async function waitForTurnTimeout(
  guests: readonly Guest[],
  seen: Set<string>,
  turn: number,
): Promise<void> {
  await expect
    .poll(async () => (await latestView(guests)).turn, { timeout: 45_000 })
    .toBeGreaterThan(turn);
  await scanEvents(guests, seen);
  expect(seen.has("TimedOut")).toBe(true);
}

test("four Guests play a whole game to the podium, with a buy, a Rent, a tray pick, a Turn timeout and a reconnect", async ({
  baseURL,
}) => {
  const desktops = await chromium.launch({ args: ["--mute-audio"] });
  const phones = await webkit.launch();
  try {
    const desktopContext = async () =>
      desktops.newContext({ ...devices["Desktop Chrome"], baseURL, locale: "en-US" });
    const phoneContext = async () =>
      phones.newContext({ ...devices["iPhone 15"], baseURL, locale: "en-US" });
    const desktopOne = await desktopContext();
    const desktopTwo = await desktopContext();
    const phoneOne = await phoneContext();
    const phoneTwo = await phoneContext();

    const guests: Guest[] = [
      {
        name: "creator",
        context: desktopOne,
        page: await desktopOne.newPage(),
        mobile: false,
        id: "",
      },
      {
        name: "desktop",
        context: desktopTwo,
        page: await desktopTwo.newPage(),
        mobile: false,
        id: "",
      },
      { name: "phone-1", context: phoneOne, page: await phoneOne.newPage(), mobile: true, id: "" },
      { name: "phone-2", context: phoneTwo, page: await phoneTwo.newPage(), mobile: true, id: "" },
    ];
    for (const guest of guests) registerPage(guest.name, guest.page);
    const [creator, ...joiners] = guests;

    // The creator opens a full 4-Player, 15-minute Room with the shortest Turn timer.
    await creator!.page.goto("/create");
    await creator!.page.getByLabel("4", { exact: true }).check();
    await creator!.page.getByLabel("15 minutes", { exact: true }).check();
    await creator!.page.getByLabel("10 s", { exact: true }).check();
    await creator!.page.getByRole("button", { name: "Create Room" }).click();
    await expect(creator!.page).toHaveURL(/\/room\/[1-9]\d{5}$/);
    const code = new URL(creator!.page.url()).pathname.split("/").at(-1) ?? "";
    await expect(creator!.page.getByText("Players: 1/4")).toBeVisible();

    // The other three join by the Room code, typed on the home screen.
    for (const joiner of joiners) {
      // oxlint-disable-next-line no-await-in-loop -- Guests join one after the other
      await joiner.page.goto("/");
      // oxlint-disable-next-line no-await-in-loop -- Guests join one after the other
      await joiner.page.getByRole("textbox", { name: "Room code" }).fill(code);
      // oxlint-disable-next-line no-await-in-loop -- Guests join one after the other
      await press(joiner, joiner.page.getByRole("button", { name: "Join", exact: true }));
      // oxlint-disable-next-line no-await-in-loop -- Guests join one after the other
      await expect(joiner.page).toHaveURL(`/room/${code}`);
    }
    for (const guest of guests) {
      // oxlint-disable-next-line no-await-in-loop -- one Lobby, four screens
      await expect(guest.page.getByText("Players: 4/4")).toBeVisible();
    }

    // Any Player may start a full Lobby.
    await press(creator!, creator!.page.getByRole("button", { name: "Start", exact: true }));
    for (const guest of guests) {
      // oxlint-disable-next-line no-await-in-loop -- one game, four screens
      await expect(guest.page).toHaveURL(`/game/${code}`, { timeout: 30_000 });
      // oxlint-disable-next-line no-await-in-loop -- one game, four screens
      await expect(guest.page.getByTestId("turn-of")).toBeVisible({ timeout: 30_000 });
    }
    for (const guest of guests) {
      // oxlint-disable-next-line no-await-in-loop -- one game, four screens
      await expect.poll(() => meOf(guest.page), { timeout: 30_000 }).not.toBeNull();
      // oxlint-disable-next-line no-await-in-loop -- one game, four screens
      guest.id = (await meOf(guest.page))!;
    }
    expect(new Set(guests.map((guest) => guest.id)).size).toBe(4);
    const byId = new Map(guests.map((guest) => [guest.id, guest]));

    // Play, always acting on the current Player's offered options. One buy, one
    // Rent, one tray pick and one Turn timeout are covered on the way; the
    // Minute limit ends the game after the Turn in progress.
    const seen = new Set<string>();
    const dropper = guests[2]!;
    const startedAt = Date.now();
    let dropDone = false;
    let timeoutDone = false;
    let bought = false;
    let picked = false;

    for (;;) {
      // oxlint-disable-next-line no-await-in-loop -- one decision at a time
      await scanEvents(guests, seen);
      // oxlint-disable-next-line no-await-in-loop -- one decision at a time
      const view = await latestView(guests);
      if (view.phase.kind === "gameOver") break;
      if (Date.now() - startedAt > 240_000) throw new Error("the game did not end in time");

      const actor = byId.get(view.currentPlayer);
      if (!actor) throw new Error(`no screen for the current Player ${view.currentPlayer}`);
      // oxlint-disable-next-line no-await-in-loop -- the actor's screen catches up with the push
      await expect
        .poll(async () => (await viewOf(actor.page))?.version ?? -1, { timeout: 15_000 })
        .toBeGreaterThanOrEqual(view.version);

      // Mid-game, the third Guest drops on their Turn and comes straight back.
      if (!dropDone && view.turn >= 2 && actor === dropper && view.phase.kind === "awaitingRoll") {
        // oxlint-disable-next-line no-await-in-loop -- the one deliberate drop
        await dropAndRejoin(dropper, guests, code);
        dropDone = true;
        continue;
      }

      // One Turn is then left to the server's deadline (the timeout penalty).
      if (dropDone && !timeoutDone && view.phase.kind === "awaitingRoll") {
        if (!seen.has("TimedOut")) {
          // oxlint-disable-next-line no-await-in-loop -- the one deliberate timeout
          await waitForTurnTimeout(guests, seen, view.turn);
        }
        timeoutDone = true;
        continue;
      }

      // oxlint-disable-next-line no-await-in-loop -- one decision at a time
      const covered = await playDecision(actor, view);
      bought ||= covered === "buy";
      picked ||= covered === "pick";
    }
    expect(dropDone).toBe(true);

    // `scanEvents` ran before the final view was read; capture the last push too.
    await scanEvents(guests, seen);

    // The required steps all happened through the real UI.
    expect(seen.has("RentPaid")).toBe(true);
    expect(bought).toBe(true);
    expect(picked).toBe(true);
    expect(seen.has("TimedOut")).toBe(true);

    // Every screen ends on the same single-winner podium, in the DOM and the store.
    const final = [];
    for (const guest of guests) {
      // oxlint-disable-next-line no-await-in-loop -- one screen at a time
      await expect
        .poll(async () => (await viewOf(guest.page))?.phase.kind ?? "", { timeout: 30_000 })
        .toBe("gameOver");
      // oxlint-disable-next-line no-await-in-loop -- one screen at a time
      const view = await viewOf(guest.page);
      if (view === null) throw new Error(`no final view for ${guest.name}`);
      final.push({ guest, view });
    }
    const winners = final.map(({ view }) =>
      view.phase.kind === "gameOver" ? view.phase.winner : "",
    );
    expect(new Set(winners).size).toBe(1);
    const winner = winners[0]!;
    expect(winner).not.toBe("");

    const titles: string[] = [];
    for (const { guest } of final) {
      // oxlint-disable-next-line no-await-in-loop -- one screen at a time
      const podium = guest.page.getByTestId("podium");
      // oxlint-disable-next-line no-await-in-loop -- one screen at a time
      await expect(podium).toBeVisible({ timeout: FINAL_PLAYBACK_MS });
      // Exactly one winner: one first place, for the same Player on every screen.
      // oxlint-disable-next-line no-await-in-loop -- one screen at a time
      await expect(podium.getByTestId("podium-place")).toHaveCount(3);
      const first = podium.locator('[data-testid="podium-place"][data-place="1"]');
      // oxlint-disable-next-line no-await-in-loop -- one screen at a time
      await expect(first).toHaveCount(1);
      // oxlint-disable-next-line no-await-in-loop -- one screen at a time
      expect(await first.getAttribute("data-player")).toBe(winner);
      // oxlint-disable-next-line no-await-in-loop -- one screen at a time
      await expect(podium.getByRole("link", { name: "Back to the Lobby list" })).toBeVisible();
      // oxlint-disable-next-line no-await-in-loop -- one screen at a time
      await expect(guest.page.getByRole("button", { name: "Roll", exact: true })).toHaveCount(0);
      // oxlint-disable-next-line no-await-in-loop -- one screen at a time
      titles.push((await podium.getByTestId("podium-title").textContent()) ?? "");
      // The store agrees with the DOM.
      // oxlint-disable-next-line no-await-in-loop -- one screen at a time
      const stored = await guest.page.evaluate(() => {
        const phase = window.universumTest?.room().push?.view.phase;
        return phase?.kind === "gameOver" ? { winner: phase.winner, reason: phase.reason } : null;
      });
      expect(stored).toEqual({
        winner,
        reason: final[0]!.view.phase.kind === "gameOver" ? final[0]!.view.phase.reason : "",
      });
    }
    // "Happy Tiger wins!" on every screen: one title, naming one winner.
    expect(new Set(titles).size).toBe(1);
  } finally {
    closeAfterDump(desktops, phones);
  }
});
