import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";

// The browser talks to one origin: Vite (and Caddy in production) forwards
// `/colyseus/*` — Colyseus' HTTP matchmaking and its WebSockets — to the Room
// server, stripping the prefix. The client connects with `new Client("/colyseus")`.
export const COLYSEUS_PATH = "/colyseus";

const repoRoot = new URL("../..", import.meta.url).pathname;

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
    plugins: [react()],
    server: { proxy },
    preview: { proxy },
    build: { sourcemap: "hidden" },
  };
});
