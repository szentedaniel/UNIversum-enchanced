import { expect } from "@playwright/test";
import {
  closeAfterDump,
  createAndJoin,
  expectBoardUp,
  expectGate,
  playerCards,
  registerPage,
  ROLL_PLAYBACK_MS,
  ROLL_WAIT_MS,
  shownView,
  startLobby,
  test,
} from "./helpers.ts";

// Spec #179, story 1–3: a Guest without a Seat watches a running game by its
// Room code, sees a Roll play out, and finds no control that would play a move.
test.use({ locale: "en-US" });

test("a spectator watches a Roll in step with the Playback and has no way to act", async ({
  page: creator,
  browser,
  baseURL,
}) => {
  // Each Guest has its own context, hence its own Guest token (spec #179, decision 3).
  const {
    code,
    context: guestContext,
    guest,
  } = await createAndJoin(
    creator,
    browser,
    { creator: "creator", guest: "guest" },
    baseURL,
    // The spectator joins the running game, so the Turn must outlast three
    // Boards coming up: the Room gets its longest Turn limit.
    { turnLimitMs: 30_000 },
  );
  const spectatorContext = await browser.newContext({ baseURL, locale: "en-US" });
  closeAfterDump(guestContext, spectatorContext);
  const spectator = await spectatorContext.newPage();
  registerPage("spectator", spectator);

  await startLobby(creator, code);

  // The spectator opens Home, types the Room code and chooses Watch.
  await spectator.goto("/");
  await spectator.getByRole("textbox", { name: "Room code" }).fill(code);
  await spectator.getByTestId("watch").click();

  // A started Room's first Game push opens the Game screen, marked read-only.
  await expect(spectator).toHaveURL(`/game/${code}`);
  await expect(spectator.getByTestId("watching")).toHaveText("Watching");
  await expect(spectator.getByTestId("board")).toBeVisible();
  // All three Boards come up in parallel; the spectator's join is what the
  // Players' count push waits on, not a Board.
  await Promise.all([creator, guest, spectator].map(expectBoardUp));
  // No Seat: no Player id, and the same two Player cards a Player sees.
  expect(await spectator.evaluate(() => window.universumTest?.room().me ?? null)).toBeNull();
  await expect(playerCards(spectator)).toHaveCount(2);

  // The Players see one spectator; every client reads the same count.
  for (const page of [creator, guest, spectator]) {
    // oxlint-disable-next-line no-await-in-loop -- one page after the other
    await expect(page.getByTestId("spectators")).toContainText("1 spectator");
  }
  // The same Board as a Player: the Game push carries one public view.
  const joined = await creator.evaluate(() => window.universumTest?.room().push?.view ?? null);
  if (joined === null) throw new Error("the game pushed no view");
  await expect.poll(() => shownView(spectator)).toEqual(joined);

  // No way to act while a Player's Roll is available.
  const roll = creator.getByRole("button", { name: "Roll", exact: true });
  await expect(roll).toBeEnabled({ timeout: ROLL_PLAYBACK_MS });
  await expect(spectator.getByRole("button", { name: "Roll", exact: true })).toHaveCount(0);
  await expect(spectator.getByTestId("deal-open")).toHaveCount(0);
  await expect(spectator.getByTestId("offer")).toHaveCount(0);
  await expect(spectator.getByTestId("sale-tray")).toHaveCount(0);
  await expect(spectator.getByTestId("pick-tray")).toHaveCount(0);
  // The Turn card says whose Turn it is, never "Your Turn".
  await expect(spectator.getByTestId("turn-of")).not.toContainText("Your Turn");

  // The e2e seed fixes this Roll: the creator rolls first, and its first Roll
  // (dice [5, 5]) moves the creator from Start to Field 10's University.
  const creatorSeat = await creator.evaluate(() => window.universumTest?.room().me ?? null);
  const mover = joined.currentPlayer;
  expect(
    mover,
    "the creator rolls first: the e2e seed's first Roll (dice [5, 5]) is the creator's and lands on Field 10's University",
  ).toBe(creatorSeat);
  const startPosition = joined.players.find((player) => player.id === mover)?.position;
  const diceBefore = await spectator.evaluate(() => window.universumTest?.cuePlays().dice ?? 0);
  await roll.click();

  // The Roll's Playback runs on the spectator's screen too: its gate is shut,
  // and its dice play before the pawn moves.
  await expectGate(spectator, false, ROLL_PLAYBACK_MS);
  await expect
    .poll(() => spectator.evaluate(() => window.universumTest?.cuePlays().dice ?? 0), {
      timeout: ROLL_WAIT_MS,
    })
    .toBe(diceBefore + 1);

  // The e2e seed lands the first Roll on a University: the Player's buy control
  // appears once the Playback ends, the spectator's screen never has one.
  await expect(creator.getByTestId("offer")).toBeVisible({ timeout: ROLL_WAIT_MS });
  await expect(spectator.getByTestId("offer")).toHaveCount(0);
  await expect(spectator.getByRole("button", { name: /^Buy/ })).toHaveCount(0);
  await expect(spectator.getByRole("button", { name: "Roll", exact: true })).toHaveCount(0);
  await expectGate(spectator, true, ROLL_PLAYBACK_MS);

  // The spectator's Board drew the move: the same final view as a Player's, the
  // pawn on the Field the dice sent it to.
  const rolled = await spectator.evaluate(() => window.universumTest?.room().push?.view ?? null);
  if (rolled === null) throw new Error("the Roll pushed no view");
  const endPosition = rolled.players.find((player) => player.id === mover)?.position;
  if (endPosition === undefined) throw new Error("the moved Player is not in the view");
  expect(endPosition).not.toBe(startPosition);
  await expect.poll(() => shownView(spectator)).toEqual(rolled);
  await expect.poll(() => shownView(creator)).toEqual(rolled);
  await expect
    .poll(async () => {
      const at = await spectator.evaluate((id) => window.universumTest?.pawn(id) ?? null, mover);
      const field = await spectator.evaluate(
        (id) => window.universumTest?.fieldCenter(id) ?? null,
        endPosition,
      );
      return at === null || field === null
        ? Number.POSITIVE_INFINITY
        : Math.hypot(at.x - field.x, at.y - field.y);
    })
    .toBeLessThan(2);
  // The Players still see the one spectator after the move.
  await expect(creator.getByTestId("spectators")).toContainText("1 spectator");
});
