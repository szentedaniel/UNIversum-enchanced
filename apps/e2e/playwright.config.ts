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
const MIXED = /(two-guests|full-game)\.spec\.ts$/;
// A fresh SQLite file per run, so no Rooms from an earlier run are restored, and
// any free internal port (/healthz, /readyz), so parallel checkouts never clash.
const SERVER_ENV = {
  PORT: String(SERVER_PORT),
  DATA_DIR: process.env["E2E_DATA_DIR"] ?? mkdtempSync(join(tmpdir(), "universum-e2e-")),
  INTERNAL_PORT: "0",
  // Test-only clock overrides: a full 4-Guest game reaches its end inside the test.
  // 8 s Turns (+3 s slack) and 8 s "minutes" (15 × 8 s = 2 min for a 15-minute Room).
  GAME_TURN_LIMIT_MS: "8000",
  GAME_MINUTE_MS: "8000",
  // A fixed dice/card seed: the full game reaches a Doubler/Erasmus/Sale pick
  // early (turn 5 in the 4-Guest game, turn 1's offer in the 2-Guest game), so
  // every run covers the required steps even though the Playback makes each
  // Turn take longer and the 120 s game has fewer of them.
  GAME_SEED: "4,29,55,129",
};

// Every test Guest comes from 127.0.0.1, so the per-IP limits are raised (spec: e2e raises them
// by env, as the load test does); flood limits, payload sizes and the Lobby cap stay as in production.
const RAISED = String(1_000_000);
const PER_IP_LIMITS = Object.fromEntries(
  [
    "ROOM_CREATIONS_PER_MINUTE",
    "ROOM_CREATIONS_PER_HOUR",
    "OPEN_LOBBIES_PER_IP",
    "JOINS_PER_MINUTE",
    "SEAT_RESERVATIONS_PER_IP",
    "SOCKETS_PER_IP",
    "PASSWORD_FAILURES_PER_IP",
  ].map((name) => [`LIMIT_${name}`, RAISED]),
);

export default defineConfig({
  testDir: "tests",
  forbidOnly: CI,
  retries: CI ? 1 : 0,
  // The retry is for the report only: a test that passes only on retry fails the run.
  failOnFlakyTests: CI,
  workers: CI ? 1 : undefined,
  reporter: CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: `http://localhost:${WEB_PORT}`,
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "desktop-chromium",
      use: { ...devices["Desktop Chrome"], launchOptions: { args: ["--mute-audio"] } },
      testIgnore: MIXED,
    },
    { name: "iphone-webkit", use: { ...devices["iPhone 15"] }, testIgnore: MIXED },
    // Multi-Guest tests launch their own desktop Chromium and iPhone WebKit
    // browsers, one context per Guest, so they run once, not per project.
    { name: "mixed-devices", testMatch: MIXED },
  ],
  webServer: [
    {
      command: "pnpm --filter @universum/server start",
      cwd: repoRoot,
      env: { ...SERVER_ENV, ...PER_IP_LIMITS },
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
