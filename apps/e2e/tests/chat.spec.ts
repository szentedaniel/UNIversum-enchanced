import { expect, type Page } from "@playwright/test";
import { closeAfterDump, playerCards, press, startGame, test, type Interactor } from "./helpers.ts";

// The quick-chat path through the real server and web app (spec #176, #233):
// one Guest sends a line and the other sees it by the sender's card, an emote
// travels the other way, the bubble fades after its duration, and a Guest who
// muted quick chat keeps neither the tray nor any bubble. Quick chat is a Room
// message and never a game intent, so nothing here waits on a Playback.
// Runs once per single-browser project: desktop Chromium (corner cards) and
// iPhone WebKit (chips), so the bubble is checked in both card layouts.
test.use({ locale: "en-US" });

/**
 * `BUBBLE_MS` in `apps/web/src/stores/chat-store.ts` is 4 s (#230); this budget
 * covers the store's own expiry, a throttled timer and a slow CI render. Not a
 * sleep: the auto-retrying assertion resolves the moment the bubble is gone.
 */
const BUBBLE_FADE_MS = 15_000;

/** The catalogue ids this spec sends: a line and an emote (#228 names them). */
type ChatId = "good_luck" | "cheer" | "well_played";

/**
 * The Seat's bubble by its Player card (desktop) or chip (phone). `seat` is the
 * join-order Seat index every client's view carries, and the cards render in
 * that order.
 */
function bubbleOf(page: Page, seat: number) {
  return playerCards(page).nth(seat).getByTestId("chat-bubble");
}

/**
 * Opens the tray and presses one catalogue entry, then reports what the entry
 * shows on this page: a line's text in the page's language, or an emote's
 * language-free glyph (its text) and accessible label. Assertions compare
 * against that, never a translation of the spec's own. The choice's disabled
 * state carries the tray's cooldown, so `press` waits it out.
 */
async function send(
  actor: Interactor,
  id: ChatId,
): Promise<{ text: string; label: string | null }> {
  await press(actor, actor.page.getByTestId("chat-toggle"));
  const choice = actor.page.getByTestId(`chat-send-${id}`);
  await expect(choice).toBeVisible();
  const sent = {
    text: (await choice.textContent())?.trim() ?? "",
    label: await choice.getAttribute("aria-label"),
  };
  await press(actor, choice);
  return sent;
}

test("two Guests exchange a line and an emote, and mute hides the tray and bubbles on one screen", async ({
  page,
  browser,
  isMobile,
}) => {
  const { context, guest } = await startGame(page, browser);
  try {
    const creator: Interactor = { page, mobile: isMobile };
    // The joining Guest's context is a fresh desktop one (`createAndJoin`), so its presses are clicks.
    const joiner: Interactor = { page: guest, mobile: false };
    // Seat A is the creator, Seat B the Guest; the numbers are the same on both screens.
    const { mine: seatA, other: seatB } = await page.evaluate(() => {
      const { me, push } = window.universumTest!.room();
      const players = push!.view.players;
      const mine = players.find((player) => player.id === me);
      const other = players.find((player) => player.id !== me);
      if (!mine || !other) throw new Error("the game needs two Players");
      return { mine: mine.seat, other: other.seat };
    });

    // Guest A sends a line: both screens show it by A's card, in the page's own
    // language, and A's own card confirms the send went out (story 2).
    const line = await send(creator, "good_luck");
    expect(line.text).not.toBe("");
    // A line's entry carries no accessible label: its text is the message.
    expect(line.label).toBeNull();
    await expect(bubbleOf(page, seatA)).toHaveText(line.text);
    await expect(bubbleOf(guest, seatA)).toHaveText(line.text);

    // The bubble is short-lived on both screens: `BUBBLE_MS` after it arrived.
    await expect(bubbleOf(page, seatA)).toHaveCount(0, { timeout: BUBBLE_FADE_MS });
    await expect(bubbleOf(guest, seatA)).toHaveCount(0);

    // Guest B sends an emote: A sees it by B's card, and B's own screen shows it
    // too. The glyph is language-free; the label comes from the same page.
    const emote = await send(joiner, "cheer");
    expect(emote.text).not.toBe("");
    if (emote.label === null) throw new Error("an emote's button carries its accessible label");
    await expect(bubbleOf(guest, seatB)).toContainText([emote.text, emote.label]);
    await expect(bubbleOf(page, seatB)).toContainText([emote.text, emote.label]);

    // Guest B mutes quick chat in the game menu (#232): the tray goes from B's
    // screen only, and the setting is local to that device.
    await expect(guest.getByTestId("chat-toggle")).toBeVisible();
    await press(joiner, guest.getByTestId("game-menu"));
    await press(joiner, guest.getByTestId("chat-toggle-mute"));
    await expect(guest.getByTestId("chat-toggle")).toHaveCount(0);
    await expect(page.getByTestId("chat-toggle")).toBeVisible();
    // Close the menu again, so the bubble checks below are on B's game screen.
    await press(joiner, guest.getByRole("button", { name: "Close", exact: true }));
    await expect(guest.getByTestId("chat-toggle-mute")).toHaveCount(0);

    // A's next line still shows by A's own card, but not on B's screen: A's own
    // bubble arriving is what proves the broadcast happened, so B was sent it too.
    const muted = await send(creator, "well_played");
    await expect(bubbleOf(page, seatA)).toHaveText(muted.text);
    await expect(bubbleOf(guest, seatA)).toHaveCount(0);
  } finally {
    closeAfterDump(context);
  }
});
