import { defineConfig, devices } from "@playwright/test";

const CI = Boolean(process.env["CI"]);

// Own ports, so a running `pnpm dev` (2567 / 5173) never collides with a test run.
const SERVER_PORT = 2577;
const WEB_PORT = 5183;
const repoRoot = new URL("../..", import.meta.url).pathname;
const MIXED = /two-guests\.spec\.ts$/;

export default defineConfig({
  testDir: "tests",
  forbidOnly: CI,
  retries: CI ? 1 : 0,
  workers: CI ? 1 : undefined,
  reporter: CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: `http://localhost:${WEB_PORT}`,
    trace: "retain-on-failure",
  },
  projects: [
    { name: "desktop-chromium", use: { ...devices["Desktop Chrome"] }, testIgnore: MIXED },
    { name: "iphone-webkit", use: { ...devices["iPhone 15"] }, testIgnore: MIXED },
    // Multi-Guest tests launch their own desktop Chromium and iPhone WebKit
    // browsers, one context per Guest, so they run once, not per project.
    { name: "mixed-devices", testMatch: MIXED },
  ],
  webServer: [
    {
      command: "pnpm --filter @universum/server start",
      cwd: repoRoot,
      env: { PORT: String(SERVER_PORT) },
      url: `http://127.0.0.1:${SERVER_PORT}/__healthcheck`,
      reuseExistingServer: !CI,
    },
    {
      // CI tests the production build (built by the step before); locally the dev server.
      command: `pnpm --filter @universum/web ${CI ? "preview" : "dev"} --port ${WEB_PORT} --strictPort`,
      cwd: repoRoot,
      env: { PORT: String(SERVER_PORT) },
      url: `http://localhost:${WEB_PORT}`,
      reuseExistingServer: !CI,
    },
  ],
});
