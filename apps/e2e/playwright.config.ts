import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineConfig, devices } from "@playwright/test";

const CI = Boolean(process.env["CI"]);

// Own ports, so a running `pnpm dev` (2567 / 5173) never collides with a test run.
// E2E_SERVER_PORT / E2E_WEB_PORT override them, so parallel checkouts don't share servers.
const SERVER_PORT = Number(process.env["E2E_SERVER_PORT"] ?? 2577);
const WEB_PORT = Number(process.env["E2E_WEB_PORT"] ?? 5183);
const repoRoot = new URL("../..", import.meta.url).pathname;
const MIXED = /two-guests\.spec\.ts$/;
// A fresh SQLite file per run, so no Rooms from an earlier run are restored, and
// any free internal port (/healthz, /readyz), so parallel checkouts never clash.
const SERVER_ENV = {
  PORT: String(SERVER_PORT),
  DATA_DIR: process.env["E2E_DATA_DIR"] ?? mkdtempSync(join(tmpdir(), "universum-e2e-")),
  INTERNAL_PORT: "0",
};

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
      env: SERVER_ENV,
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
