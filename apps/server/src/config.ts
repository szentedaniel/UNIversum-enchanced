import { join, resolve } from "node:path";
import { LOG_LEVELS, type LogLevel } from "#observability/logger.ts";
import { parseDsn } from "#observability/dsn.ts";
import { loadLimits, type Limits } from "#limits.ts";
import type { GameTiming } from "#room/game-room.ts";

/** Typed server settings. Every value comes from the environment, with dev defaults. */
export type ServerConfig = {
  /** HTTP + WebSocket port (`PORT`). */
  port: number;
  /** Interface to bind (`HOST`). The dev default stays on loopback; Vite proxies to it. */
  host: string;
  /** Folder for the SQLite data (`DATA_DIR`). Gitignored in dev; a local volume in compose. */
  dataDir: string;
  /** Abuse-protection limits (`LIMIT_*`, see `limits.ts`). */
  limits: Limits;
  /** The SQLite file of the RoomStore, inside `dataDir`. */
  databasePath: string;
  /**
   * Port for `/healthz` and `/readyz` (`INTERNAL_PORT`, 0 = any free port).
   * Never routed by Caddy nor published by compose.
   */
  internalPort: number;
  /** pino level: `info` in production (`NODE_ENV=production`), `debug` otherwise; `LOG_LEVEL` overrides. */
  logLevel: LogLevel;
  /** Human-readable logs through pino-pretty (a dev dependency): everywhere but production. */
  prettyLogs: boolean;
  /** The build's git SHA (`RELEASE`, a build arg of the image), shown as `build_info{release}`. */
  release: string;
  /**
   * The Sentry-protocol DSN (`SENTRY_DSN`) errors are reported to, or `null`
   * when reporting is off (the default). Also the client's switch: it starts
   * reporting only while this is set.
   */
  sentryDsn: string | null;
  /**
   * Test-only clock overrides (`GAME_TURN_LIMIT_MS`, `GAME_MINUTE_MS`): shorter
   * Turns and "minutes", so an e2e game reaches its end quickly. Unset in production.
   */
  timing: GameTiming;
};

type Env = Readonly<Record<string, string | undefined>>;

const DEV_DATA_DIR = resolve(import.meta.dirname, "..", "data");

export function loadConfig(env: Env = process.env): ServerConfig {
  const dataDir = env["DATA_DIR"] ?? DEV_DATA_DIR;
  const production = env["NODE_ENV"] === "production";
  return {
    port: parsePort("PORT", env["PORT"], 2567),
    host: env["HOST"] ?? "127.0.0.1",
    dataDir,
    databasePath: join(dataDir, "rooms.sqlite"),
    internalPort: parsePort("INTERNAL_PORT", env["INTERNAL_PORT"], 9464),
    logLevel: parseLogLevel(env["LOG_LEVEL"], production ? "info" : "debug"),
    prettyLogs: !production,
    release: env["RELEASE"] || "dev",
    sentryDsn: parseSentryDsn(env["SENTRY_DSN"]),
    limits: loadLimits(env),
    timing: {
      turnLimitMs: parseOptionalMs("GAME_TURN_LIMIT_MS", env["GAME_TURN_LIMIT_MS"]),
      minuteMs: parseOptionalMs("GAME_MINUTE_MS", env["GAME_MINUTE_MS"]),
    },
  };
}

/** A positive whole number of milliseconds, or `undefined` when the variable is unset. */
function parseOptionalMs(name: string, raw: string | undefined): number | undefined {
  if (raw === undefined || raw === "") return undefined;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${name} must be a whole number of milliseconds, got ${JSON.stringify(raw)}`);
  }
  return value;
}

/** The DSN, or `null` when reporting is off; anything else must be a DSN, never silently ignored. */
function parseSentryDsn(raw: string | undefined): string | null {
  if (raw === undefined || raw === "") return null;
  if (!parseDsn(raw)) {
    throw new Error(
      `SENTRY_DSN must be a Sentry-protocol DSN (https://<public key>@<host>/<project id>), got ${JSON.stringify(raw)}`,
    );
  }
  return raw;
}

function parseLogLevel(raw: string | undefined, fallback: LogLevel): LogLevel {
  if (raw === undefined || raw === "") return fallback;
  const level = LOG_LEVELS.find((l) => l === raw);
  if (!level) {
    throw new Error(
      `LOG_LEVEL must be one of ${LOG_LEVELS.join(", ")}, got ${JSON.stringify(raw)}`,
    );
  }
  return level;
}

function parsePort(name: string, raw: string | undefined, fallback: number): number {
  if (raw === undefined) return fallback;
  const port = Number(raw);
  if (raw.trim() === "" || !Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error(`${name} must be an integer from 0 to 65535, got ${JSON.stringify(raw)}`);
  }
  return port;
}
