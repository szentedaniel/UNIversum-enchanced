import { mkdirSync } from "node:fs";
import { loadConfig } from "#config.ts";
import { startInternalServer } from "#internal-server.ts";
import { installCrashHandlers } from "#observability/crash-handlers.ts";
import { parseDsn } from "#observability/dsn.ts";
import { noReporter, type ErrorReporter } from "#observability/error-reporting.ts";
import { createLogger } from "#observability/logger.ts";
import { GameMetrics } from "#observability/metrics.ts";
import { createSentryReporter } from "#observability/sentry-reporter.ts";
import { createGameServer, restoreRooms } from "#server.ts";
import { openSqliteRoomStore } from "#store/sqlite-room-store.ts";

const config = loadConfig();
// pino-pretty is a dev dependency: production images log plain NDJSON.
const log = createLogger({
  level: config.logLevel,
  stream: config.prettyLogs ? (await import("pino-pretty")).default() : undefined,
});
const metrics = new GameMetrics({ release: config.release });

// Sentry stays off unless SENTRY_DSN is set: no reporter means nothing is sent.
const dsn = config.sentryDsn === null ? null : parseDsn(config.sentryDsn);
const reporter: ErrorReporter =
  dsn === null ? noReporter : createSentryReporter({ dsn, release: config.release });
installCrashHandlers({ source: process, log, reporter, exit: (code) => process.exit(code) });

mkdirSync(config.dataDir, { recursive: true });
const store = openSqliteRoomStore(config.databasePath);
const internal = await startInternalServer({
  port: config.internalPort,
  host: config.host,
  metrics,
});

const server = createGameServer({
  store,
  limits: config.limits,
  metrics,
  log,
  reporter,
  errorReporting: dsn,
  timing: config.timing,
});
server.onBeforeShutdown(() => log.info("Server shutting down"));
// Every Room has stopped (on SIGTERM/SIGINT) before the store closes.
server.onShutdown(async () => {
  store.close();
  await internal.close();
  log.info("Server stopped");
});

await server.listen(config.port, config.host);
log.info(
  { port: config.port, internalPort: internal.port, release: config.release },
  "Server listening",
);

const started = performance.now();
const restored = await restoreRooms({ store, metrics, log });
log.info({ restored, durationMs: Math.round(performance.now() - started) }, "Rooms restored");
internal.ready();
log.info("Server ready");
