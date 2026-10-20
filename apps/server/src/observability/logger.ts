import { format } from "node:util";
import { pino, type DestinationStream, type Level, type Logger } from "pino";

export type { Logger } from "pino";

/** Log levels `LOG_LEVEL` accepts. */
export const LOG_LEVELS = ["fatal", "error", "warn", "info", "debug", "trace", "silent"] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

/**
 * Keys that must never reach a log line (spec: Observability → Logs): the
 * Guest token and its hash, the `reconnectionToken`, Room passwords and their
 * hashes, raw IPs and full snapshots. The code never logs them; this is the
 * safety net, at the top level and one level down (e.g. `options.password`).
 */
const SECRET_KEYS = [
  "guestToken",
  "guestTokenHash",
  "token",
  "tokenHash",
  "reconnectionToken",
  "password",
  "passwordHash",
  "ip",
  "remoteAddress",
  "snapshot",
  "state",
  "game",
  "view",
  'headers["x-real-ip"]',
  'headers["x-forwarded-for"]',
  'headers["x-client-ip"]',
];
const REDACT_PATHS = SECRET_KEYS.flatMap((key) => [key, `*.${key}`]);

/**
 * The server's logger: pino NDJSON on stdout (or `stream`), with secrets
 * redacted. Lines about a Room carry `roomCode`, lines about a Seat the
 * public `playerId`.
 */
export function createLogger(options: { level: LogLevel; stream?: DestinationStream }): Logger {
  const settings = {
    level: options.level,
    base: undefined, // no pid/hostname: one process per container
    redact: { paths: REDACT_PATHS, censor: "[redacted]" },
  };
  // Without a stream: synchronous writes to stdout, so no line is lost at exit.
  return options.stream ? pino(settings, options.stream) : pino(settings);
}

/** A logger that writes nothing (the default for in-process test servers). */
export const silentLogger: Logger = pino({ level: "silent" });

type ConsoleLike = Record<Level, (...args: unknown[]) => void>;

/**
 * Colyseus logs like `console` (`logger.warn("text", value)`); this passes
 * its lines to pino under `component: "colyseus"`.
 */
export function colyseusLogger(log: Logger): ConsoleLike {
  const child = log.child({ component: "colyseus" });
  const at =
    (level: Level) =>
    (...args: unknown[]) => {
      const [first, ...rest] = args;
      if (first instanceof Error) child[level]({ err: first }, format(...rest) || first.message);
      else child[level](format(...args));
    };
  return {
    fatal: at("fatal"),
    error: at("error"),
    warn: at("warn"),
    info: at("info"),
    debug: at("debug"),
    trace: at("trace"),
  };
}
