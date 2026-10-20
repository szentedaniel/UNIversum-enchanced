import { expect, test, type Page } from "@playwright/test";

test.use({ locale: "en-US" });

/** The Room code from a Lobby's address (`/room/123456`). */
const codeOf = (page: Page) => new URL(page.url()).pathname.split("/").at(-1) ?? "";

test("the create form refuses an offensive Room name inline", async ({ page }) => {
  await page.goto("/create");
  await page.getByLabel("Room name").fill("Shit happens");
  await page.getByRole("button", { name: "Create Room" }).click();

  await expect(page.getByRole("alert")).toHaveText(/That Room name isn't allowed/);
  await expect(page).toHaveURL(/\/create$/);
});

test("too many wrong passwords lock the Join button with a countdown", async ({
  page: creator,
  browser,
  baseURL,
}) => {
  const context = await browser.newContext({ baseURL, locale: "en-US" });
  try {
    const guest = await context.newPage();
    await creator.goto("/create");
    await creator.getByLabel("Password (optional)").fill("right");
    await creator.getByRole("button", { name: "Create Room" }).click();
    await expect(creator).toHaveURL(/\/room\/\d{6}$/);

    await guest.goto(`/room/${codeOf(creator)}`);
    const join = guest.getByRole("button", { name: "Join" });
    for (let i = 0; i < 5; i++) {
      // oxlint-disable-next-line no-await-in-loop -- one guess after another
      await guest.getByLabel("Password").fill(`wrong ${i}`);
      // oxlint-disable-next-line no-await-in-loop -- one guess after another
      await join.click();
      // oxlint-disable-next-line no-await-in-loop -- one guess after another
      await expect(guest.getByRole("alert")).toHaveText("Wrong password.");
    }
    await guest.getByLabel("Password").fill("right");
    await join.click();

    await expect(guest.getByRole("alert")).toHaveText(/Too many wrong passwords/);
    const locked = guest.getByRole("button", { name: /Try again in \d+ s/ });
    await expect(locked).toBeDisabled();
    await expect(locked).toHaveText(/Try again in (60|59|58) s/);
  } finally {
    await context.close();
  }
});
