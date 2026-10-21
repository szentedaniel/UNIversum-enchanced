import { expect, type Page } from "@playwright/test";
import {
  closeAfterDump,
  expectOneJoinSocket,
  probeSockets,
  registerPage,
  test,
} from "./helpers.ts";

test.use({ locale: "en-US" });

/** The Room code from a Lobby's address (`/room/123456`). */
const codeOf = (page: Page) => new URL(page.url()).pathname.split("/").at(-1) ?? "";

test("the create form refuses a bad Room name inline and keeps the Guest on the form", async ({
  page,
}) => {
  await page.goto("/create");
  await page.getByLabel("Room name").fill("ab");
  await page.getByRole("button", { name: "Create Room" }).click();

  await expect(page.getByRole("alert")).toHaveText(/3 to 24 characters/);
  await expect(page).toHaveURL("/create");
});

test("a password Lobby is listed with a lock, asks for its password, fills up and leaves the list when started", async ({
  page: creator,
  browser,
  baseURL,
}) => {
  const contexts = await Promise.all([
    browser.newContext({ baseURL, locale: "en-US" }),
    browser.newContext({ baseURL, locale: "en-US" }),
  ]);
  closeAfterDump(...contexts);
  const [joiner, watcher] = await Promise.all(contexts.map((c) => c.newPage()));
  registerPage("creator", creator);
  registerPage("joiner", joiner!);
  registerPage("watcher", watcher!);
  // The joiner opens the Lobby list's socket first, so only the creator's
  // direct create is a one-socket check; both are probed for the record.
  await Promise.all([probeSockets(creator), probeSockets(joiner!)]);
  await watcher!.goto("/rooms");
  await expect(watcher!.getByRole("heading", { name: "Open Lobbies" })).toBeVisible();

  // The creator sets every setting on the form; the Lobby shows them.
  await creator.goto("/create");
  await creator.getByLabel("Room name").fill("  Friday   game ");
  await creator.getByLabel("2", { exact: true }).check();
  await creator.getByLabel("15 minutes").check();
  await creator.getByLabel("Password (optional)").fill("open sesame");
  await creator.getByRole("button", { name: "Create Room" }).click();
  await expect(creator).toHaveURL(/\/room\/[1-9]\d{5}$/);
  const code = codeOf(creator);
  await expect(creator.getByRole("heading", { name: "Friday game" })).toBeVisible();
  await expect(creator.getByText("Password-protected")).toBeVisible();
  await expect(creator.getByText("Players: 1/2")).toBeVisible();

  // The list shows it live, with a lock.
  const tile = watcher!.getByTestId(`lobby-${code}`);
  await expect(tile.getByRole("heading", { name: "Friday game" })).toBeVisible();
  await expect(tile).toContainText(`Room code: ${code}`);
  await expect(tile).toContainText("Players: 1/2");
  await expect(tile).toContainText("15 minutes");
  await expect(tile).toContainText("Password");

  // Joining asks for the password first; a wrong one is refused inline.
  await joiner!.goto("/rooms");
  const joinerTile = joiner!.getByTestId(`lobby-${code}`);
  await joinerTile.getByRole("button", { name: "Join" }).click();
  await joinerTile.getByLabel("Password").fill("open sesame?");
  await joinerTile.getByRole("button", { name: "Join" }).click();
  await expect(joinerTile.getByRole("alert")).toHaveText("Wrong password.");
  await joinerTile.getByLabel("Password").fill("open sesame");
  await joinerTile.getByRole("button", { name: "Join" }).click();
  await expect(joiner!).toHaveURL(`/room/${code}`);
  await expect(joiner!.getByText("Players: 2/2")).toBeVisible();

  // A full Lobby shows Full, with no Join button; joining by code says so.
  await expect(tile).toContainText("Full");
  await expect(tile.getByRole("button", { name: "Join" })).toHaveCount(0);
  await watcher!.getByRole("textbox", { name: "Room code" }).fill(code);
  await watcher!.locator("form.join").getByRole("button", { name: "Join" }).click();
  await expect(watcher!.getByRole("alert")).toHaveText("This Lobby is full.");

  // Started: the Room leaves the list.
  await joiner!.getByRole("button", { name: "Start" }).click();
  await expect(creator).toHaveURL(`/game/${code}`);
  await expect(tile).toHaveCount(0);
  await expectOneJoinSocket(creator, "creator");
});

test("joining by Room code asks for the password, and an unknown code is refused inline", async ({
  page: creator,
  browser,
  baseURL,
}) => {
  const context = await browser.newContext({ baseURL, locale: "en-US" });
  try {
    const guest = await context.newPage();
    await creator.goto("/create");
    await creator.getByLabel("Password (optional)").fill("pw");
    await creator.getByRole("button", { name: "Create Room" }).click();
    await expect(creator).toHaveURL(/\/room\/\d{6}$/);
    const code = codeOf(creator);

    await guest.goto("/");
    await guest.getByRole("textbox", { name: "Room code" }).fill("100000");
    await guest.getByRole("button", { name: "Join" }).click();
    await expect(guest.getByRole("alert")).toHaveText("There is no open Room with this code.");

    await guest.getByRole("textbox", { name: "Room code" }).fill(code);
    await guest.getByRole("button", { name: "Join" }).click();
    await expect(guest.getByText("This Lobby has a password.")).toBeVisible();
    await guest.getByLabel("Password").fill("pw");
    await guest.locator("form.password").getByRole("button", { name: "Join" }).click();
    await expect(guest).toHaveURL(`/room/${code}`);
    await expect(guest.getByText("Players: 2/4")).toBeVisible();
  } finally {
    await context.close();
  }
});

test("opening a password Lobby's address asks for the password before taking a Seat", async ({
  page: creator,
  browser,
  baseURL,
}) => {
  const context = await browser.newContext({ baseURL, locale: "en-US" });
  try {
    const guest = await context.newPage();
    await creator.goto("/create");
    await creator.getByLabel("Password (optional)").fill("pw");
    await creator.getByRole("button", { name: "Create Room" }).click();
    await expect(creator).toHaveURL(/\/room\/\d{6}$/);
    const code = codeOf(creator);

    await guest.goto(`/room/${code}`);
    await expect(guest.getByText("This Lobby has a password.")).toBeVisible();
    await expect(creator.getByText("Players: 1/4")).toBeVisible();
    await guest.getByLabel("Password").fill("pw");
    await guest.getByRole("button", { name: "Join" }).click();

    await expect(guest.getByText("Players: 2/4")).toBeVisible();
    await expect(creator.getByText("Players: 2/4")).toBeVisible();
  } finally {
    await context.close();
  }
});
