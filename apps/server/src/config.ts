import { resolve } from "node:path";
import { loadLimits, type Limits } from "#limits.ts";

/** Typed server settings. Every value comes from the environment, with dev defaults. */
export type ServerConfig = {
  /** HTTP + WebSocket port (`PORT`). */
  port: number;
  /** Interface to bind (`HOST`). The dev default stays on loopback; Vite proxies to it. */
  host: string;
  /** Folder for the SQLite data (`DATA_DIR`). Gitignored in dev. */
  dataDir: string;
  /** Abuse-protection limits (`LIMIT_*`, see `limits.ts`). */
  limits: Limits;
};

type Env = Readonly<Record<string, string | undefined>>;

const DEV_DATA_DIR = resolve(import.meta.dirname, "..", "data");

export function loadConfig(env: Env = process.env): ServerConfig {
  return {
    port: parsePort(env["PORT"]),
    host: env["HOST"] ?? "127.0.0.1",
    dataDir: env["DATA_DIR"] ?? DEV_DATA_DIR,
    limits: loadLimits(env),
  };
}

function parsePort(raw: string | undefined): number {
  if (raw === undefined) return 2567;
  const port = Number(raw);
  if (raw.trim() === "" || !Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error(`PORT must be an integer from 0 to 65535, got ${JSON.stringify(raw)}`);
  }
  return port;
}
