import { loadConfig, timingIgnored } from "#config.ts";
import { createLogger } from "#observability/logger.ts";
import { startServer } from "#server.ts";

const config = loadConfig();
// pino-pretty is a dev dependency: production images log plain NDJSON.
const log = createLogger({
  level: config.logLevel,
  stream: config.prettyLogs ? (await import("pino-pretty")).default() : undefined,
});
if (timingIgnored()) {
  log.warn("GAME_TURN_LIMIT_MS, GAME_MINUTE_MS and GAME_SEED are ignored in production");
}

await startServer(config, { log });
