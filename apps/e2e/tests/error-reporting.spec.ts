import { expect, test } from "@playwright/test";

test.use({ locale: "en-US" });

/**
 * The client half of error reporting (spec: Observability → Errors): when the
 * server says `errorReporting: true`, `@sentry/react` sends browser errors to
 * `/errors` through the tunnel. The server half (DSN swap, stripping, limits)
 * has its own server tests; here the route is intercepted.
 */
test("a browser error is sent through the /errors tunnel, without sessions", async ({ page }) => {
  const posted = Promise.withResolvers<string>();
  await page.route("**/client-config", (route) =>
    route.fulfill({ json: { errorReporting: true } }),
  );
  await page.route("**/errors", async (route) => {
    posted.resolve(route.request().postData() ?? "");
    await route.fulfill({ status: 200, body: "" });
  });

  await page.goto("/");
  await page.evaluate(() => {
    setTimeout(() => {
      throw new Error("e2e reporting boom");
    }, 0);
  });

  const envelope = await posted.promise;
  expect(envelope).toContain('"type":"event"');
  expect(envelope).toContain("e2e reporting boom");
  expect(envelope).not.toContain('"type":"session"');
});
