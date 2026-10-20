/**
 * The browser-facing routes that are not Colyseus (spec: Observability → Errors):
 * `GET /client-config` tells the client whether error reporting is on, and
 * `POST /errors` is the Sentry envelope tunnel. Both are served on the Room
 * server's HTTP port; Caddy gives each its own `handle` so neither falls
 * through to the app shell, and Vite proxies them in dev.
 *
 * The tunnel is deliberately strict: reporting off means 404, only `event`
 * items pass, and the IP and every token, password and request header are
 * stripped before the envelope is forwarded to the tracker with the real DSN.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { ipBucket, clientIp } from "#abuse/ip.ts";
import { readBody } from "#abuse/gated-http.ts";
import type { AbuseGuard } from "#abuse/guard.ts";
import type { Dsn } from "#observability/dsn.ts";
import {
  joinEnvelope,
  sanitizeEvent,
  splitEnvelope,
  type EnvelopeItem,
} from "#observability/error-envelope.ts";
import { silentLogger, type Logger } from "#observability/logger.ts";

export const CLIENT_CONFIG_PATH = "/client-config";
export const ERROR_TUNNEL_PATH = "/errors";

export type BrowserRoutes = {
  /** Handles `request` when it is one of these routes; `false` hands it to Colyseus. */
  handle(request: IncomingMessage, response: ServerResponse): Promise<boolean>;
};

export type BrowserRoutesOptions = {
  /** The real tracker DSN; `null` means reporting is off. */
  dsn: Dsn | null;
  guard: AbuseGuard;
  log?: Logger;
};

/** Answers a route with no body and the given status. */
function empty(response: ServerResponse, status: number, headers: Record<string, string> = {}) {
  response.writeHead(status, headers);
  response.end();
}

/**
 * Builds the two routes. `/client-config` always answers (the client must know
 * that reporting is off), `/errors` always 404s while reporting is off.
 */
export function createBrowserRoutes({
  dsn,
  guard,
  log = silentLogger,
}: BrowserRoutesOptions): BrowserRoutes {
  async function clientConfig(request: IncomingMessage, response: ServerResponse) {
    if (request.method !== "GET") return empty(response, 405, { allow: "GET" });
    const body = JSON.stringify({ errorReporting: dsn !== null });
    response.writeHead(200, {
      "content-type": "application/json",
      "content-length": Buffer.byteLength(body),
      "cache-control": "no-store",
    });
    response.end(body);
  }

  async function errorTunnel(request: IncomingMessage, response: ServerResponse) {
    if (dsn === null) return empty(response, 404);
    if (request.method !== "POST") return empty(response, 405, { allow: "POST" });
    const max = guard.limits.errorReportBytes;
    if (Number(request.headers["content-length"] ?? 0) > max) return empty(response, 413);
    const bucket = ipBucket(clientIp(request.headers, request.socket.remoteAddress));
    const refusal = await guard.errorReportRefusal(bucket);
    if (refusal) {
      return empty(response, 429, {
        "retry-after": String(refusal.retryAfter ?? 60),
      });
    }
    const body = await readBody(request, max);
    if (body === null) return empty(response, 413);
    const envelope = splitEnvelope(Buffer.from(body, "utf8"));
    if (envelope === null) return empty(response, 400);
    const events: EnvelopeItem[] = [];
    for (const item of envelope.items) {
      if (item.header["type"] !== "event") continue;
      const payload = sanitizeEvent(item.payload);
      if (payload !== null) events.push({ header: item.header, payload });
    }
    if (events.length === 0) return empty(response, 200);
    const forward = joinEnvelope({
      header: { ...envelope.header, dsn: dsn.dsn },
      items: events,
    });
    try {
      const upstream = await fetch(dsn.envelopeUrl, {
        method: "POST",
        headers: { "content-type": "application/x-sentry-envelope" },
        body: forward,
      });
      if (!upstream.ok) {
        log.error({ status: upstream.status }, "Error report refused by the tracker");
        return empty(response, 502);
      }
      return empty(response, 200);
    } catch (error) {
      log.error({ err: error }, "Error report not forwarded");
      return empty(response, 502);
    }
  }

  return {
    async handle(request, response) {
      const path = new URL(request.url ?? "/", "http://server").pathname;
      if (path === CLIENT_CONFIG_PATH) {
        await clientConfig(request, response);
        return true;
      }
      if (path === ERROR_TUNNEL_PATH) {
        await errorTunnel(request, response);
        return true;
      }
      return false;
    },
  };
}
