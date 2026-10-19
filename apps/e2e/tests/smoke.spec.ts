import { expect, test } from "@playwright/test";

test("the page loads and reaches the Room server on the same origin", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "UNIversum" })).toBeVisible();
  await expect(page.getByRole("img", { name: "UNIversum logo" })).toBeVisible();

  const health = await page.request.get("/colyseus/__healthcheck");
  expect(health.status()).toBe(200);
  expect(await health.text()).toBe("OK"); // the server's answer, not Vite's SPA fallback

  // Colyseus answers any message on a room-less socket with a ping byte, so a
  // reply proves the WebSocket upgrade goes through the same-origin proxy too.
  const reply = await page.evaluate(
    () =>
      new Promise<number>((resolve, reject) => {
        const socket = new WebSocket(new URL("/colyseus/", location.href.replace(/^http/, "ws")));
        socket.binaryType = "arraybuffer";
        socket.addEventListener("open", () => socket.send("ping"));
        socket.addEventListener("message", (event: MessageEvent<ArrayBuffer>) => {
          socket.close();
          resolve(event.data.byteLength);
        });
        socket.addEventListener("error", () => reject(new Error("WebSocket failed")));
      }),
  );
  expect(reply).toBeGreaterThan(0);
});
