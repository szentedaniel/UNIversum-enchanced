import { expect, test } from "@playwright/test";

// The language picker and the old-browser page (spec: Client → Text/Browsers).
// Runs once per single-browser project: desktop Chromium and iPhone WebKit.

test("the home picker switches language and the choice survives a reload", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("language-de")).toHaveAttribute("aria-pressed", "false");

  await page.getByTestId("language-de").click();

  await expect(page.locator("html")).toHaveAttribute("lang", "de");
  await expect(page.getByRole("link", { name: "Raum erstellen" })).toBeVisible();
  await expect(page.getByTestId("language-de")).toHaveAttribute("aria-pressed", "true");

  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("lang", "de");
  await expect(page.getByRole("link", { name: "Raum erstellen" })).toBeVisible();
});

test("a browser below the Vite baseline gets the update page instead of the game", async ({
  page,
}) => {
  // A feature every supported browser has, removed before any page script runs.
  await page.addInitScript(() => {
    Object.defineProperty(Object, "hasOwn", { value: undefined });
  });
  await page.goto("/");

  const notice = page.getByTestId("old-browser");
  await expect(notice).toBeVisible();
  await expect(notice.getByRole("heading")).toHaveText("Update your browser");
  await expect(page.getByRole("link", { name: "Create Room" })).toHaveCount(0);
});

test("the old-browser page speaks the browser's language", async ({ browser, baseURL }) => {
  const context = await browser.newContext({ baseURL, locale: "de-DE" });
  const page = await context.newPage();
  try {
    await page.addInitScript(() => {
      Object.defineProperty(Object, "hasOwn", { value: undefined });
    });
    await page.goto("/");
    await expect(page.getByTestId("old-browser").getByRole("heading")).toHaveText(
      "Aktualisiere deinen Browser",
    );
  } finally {
    await context.close();
  }
});
