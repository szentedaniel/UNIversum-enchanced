import { once } from "node:events";
import { createServer } from "node:http";
import type { GameMetrics } from "#observability/metrics.ts";

/**
 * The internal HTTP port (spec: Health): `/healthz` (the process is up) and
 * `/readyz` (every unfinished Room is restored). Caddy never routes it and
 * compose never publishes it; the compose healthcheck polls `/readyz` and the
 * `monitoring` profile's Prometheus scrapes `/metrics`.
 */
export type InternalServer = {
  /** The bound port (useful when started on port 0). */
  port: number;
  /** Restore has finished: `/readyz` turns green. */
  ready(): void;
  close(): Promise<void>;
};

export async function startInternalServer(options: {
  port: number;
  host: string;
  /** Served at `/metrics`; without it `/metrics` is 404. */
  metrics?: GameMetrics;
}): Promise<InternalServer> {
  let isReady = false;
  const { metrics } = options;
  const server = createServer((request, response) => {
    const path = new URL(request.url ?? "/", "http://internal").pathname;
    if (path === "/metrics" && metrics) {
      void metrics.scrape().then(
        (body) => {
          response.writeHead(200, { "content-type": metrics.contentType });
          response.end(body);
        },
        () => {
          response.writeHead(500, { "content-type": "text/plain" });
          response.end("metrics failed");
        },
      );
      return;
    }
    const status = path === "/healthz" ? 200 : path === "/readyz" ? (isReady ? 200 : 503) : 404;
    response.writeHead(status, { "content-type": "text/plain" });
    response.end(status === 200 ? "ok" : status === 503 ? "restoring" : "not found");
  });
  server.listen(options.port, options.host);
  await once(server, "listening");
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("no TCP port");
  return {
    port: address.port,
    ready() {
      isReady = true;
    },
    async close() {
      server.closeAllConnections();
      server.close();
      await once(server, "close");
    },
  };
}
