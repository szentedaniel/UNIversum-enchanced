import { defineConfig } from "vitest/config";

// One `vitest run` at the root runs every package's tests. The projects are
// listed explicitly so the untracked .claude/ and .agents/ folders are never
// scanned, and the Playwright specs in apps/e2e are never picked up.
export default defineConfig({
  test: {
    projects: [
      "packages/rules",
      "packages/protocol",
      "apps/server",
      "apps/web",
      "apps/loadtest",
      "packages/repo-checks",
    ],
    passWithNoTests: true,
  },
});
