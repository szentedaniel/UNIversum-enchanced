import { paraglideVitePlugin } from "@inlang/paraglide-js";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv, type Plugin } from "vite";
import { buildAtlas } from "./scripts/atlas.ts";

// The browser talks to one origin: Vite (and Caddy in production) forwards
// `/colyseus/*` — Colyseus' HTTP matchmaking and its WebSockets — to the Room
// server, stripping the prefix. The client connects with `new Client("/colyseus")`.
export const COLYSEUS_PATH = "/colyseus";

const repoRoot = new URL("../..", import.meta.url).pathname;

/**
 * Builds the Board atlas (scripts/atlas.ts) into public/atlas before Vite
 * serves or bundles. AssetPack's cache makes repeat runs cheap. Vitest loads
 * this config too and skips it.
 */
function boardAtlas(): Plugin {
  return {
    name: "universum:board-atlas",
    async buildStart() {
      if (!process.env["VITEST"]) await buildAtlas();
    },
  };
}

export default defineConfig(({ mode }) => {
  // Settings come from the root .env (see .env.example) or the environment.
  const env = { ...loadEnv(mode, repoRoot, ""), ...process.env };
  const proxy = {
    [COLYSEUS_PATH]: {
      target: `http://127.0.0.1:${env["PORT"] ?? "2567"}`,
      ws: true,
      rewrite: (path: string) => path.slice(COLYSEUS_PATH.length) || "/",
    },
  };

  return {
    envDir: repoRoot,
    plugins: [
      boardAtlas(),
      react(),
      tailwindcss(),
      // Same options as the `paraglide` script in package.json (run on install,
      // so lint and type-checks see the generated messages).
      paraglideVitePlugin({
        project: "./project.inlang",
        outdir: "./src/paraglide",
        strategy: ["localStorage", "preferredLanguage", "baseLocale"],
      }),
    ],
    define: {
      // Test-only hooks for Playwright (src/test-hooks.ts): on in dev, compiled
      // out of production builds unless TEST_HOOKS=1 (CI's e2e build).
      TEST_HOOKS_ENABLED: JSON.stringify(mode !== "production" || env["TEST_HOOKS"] === "1"),
    },
    server: { proxy },
    preview: { proxy },
    build: { sourcemap: "hidden" },
  };
});
