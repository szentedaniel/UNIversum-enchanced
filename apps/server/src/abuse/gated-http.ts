/**
 * The Room server's HTTP server, with the abuse-protection gate in front of
 * Colyseus (spec: Abuse protection). Colyseus serves `/matchmake/*` from its
 * own router before any middleware, and refuses an unknown Room code before
 * `onAuth`, so the request rates and the body cap are checked here, as each
 * request arrives:
 * - `POST /matchmake/create/game` counts as a Room creation, and
 *   `joinById/<code>`, `join/game`, `joinOrCreate/game` as join attempts;
 * - a matchmaking body is at most `matchmakeBodyBytes`.
 * It also counts each IP's open WebSockets (refused in `beforeUpgrade`), and
 * hands Colyseus the resolved client IP as `X-Real-IP`, since Colyseus's
 * matchmaking `onAuth` context does not fall back to the socket address.
 *
 * `readRequest` is the one reader for a route's request, matchmaking or
 * browser (`#http/browser-routes.ts`): it resolves the client bucket, refuses
 * a declared body over its cap, optionally consults a rate check, then reads
 * the body under the same cap. `reply` is the one writer for a refusal, with
 * the matchmaking JSON and CORS headers or an empty body.
 */
import { createServer, IncomingMessage, ServerResponse, type Server } from "node:http";
import { Duplex } from "node:stream";
import { matchMaker } from "@colyseus/core";
import { GAME_ROOM, refusalMessage, type Refusal } from "@universum/protocol";
import { REQUEST_ID_HEADER, type AbuseGuard, type RequestKind } from "#abuse/guard.ts";
import { clientIp, ipBucket } from "#abuse/ip.ts";
import type { BrowserRoutes } from "#http/browser-routes.ts";

const MATCHMAKE = /^\/matchmake\/(\w+)\/([^/?#]+)/;

/** What a matchmaking request counts as, if anything (the Lobby list's own Room is free). */
function kindOf(method: string, room: string): RequestKind | null {
  if (method === "create") return room === GAME_ROOM ? "create" : null;
  if (method === "joinById") return "join";
  if (method === "join" || method === "joinOrCreate") return room === GAME_ROOM ? "join" : null;
  return null;
}

/** The whole body, or `null` once it grows past `max` bytes. */
function readBody(req: IncomingMessage, max: number): Promise<string | null> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > max) {
        resolve(null);
        req.removeAllListeners("data");
        req.resume();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", () => resolve(null));
  });
}

/** What reading a route's request got: its client bucket and body, or the refusal to answer. */
export type RequestRead = { bucket: string; body: string } | { refusal: Refusal; status: number };

/**
 * Reads a route's request: resolves the client bucket, refuses a declared or
 * actual body over `max` bytes (413 `MALFORMED`), and consults `rate` once the
 * declared body fits (429 with its Refusal).
 */
export async function readRequest(
  req: IncomingMessage,
  { max, rate }: { max: number; rate?: (bucket: string) => Promise<Refusal | null> },
): Promise<RequestRead> {
  const bucket = ipBucket(clientIp(req.headers, req.socket.remoteAddress));
  if (Number(req.headers["content-length"] ?? 0) > max) {
    return { refusal: { code: "MALFORMED" }, status: 413 };
  }
  if (rate) {
    const refusal = await rate(bucket);
    if (refusal) return { refusal, status: 429 };
  }
  const body = await readBody(req, max);
  if (body === null) return { refusal: { code: "MALFORMED" }, status: 413 };
  return { bucket, body };
}

/**
 * Answers a refusal: `status`, `retry-after` when the Refusal carries one,
 * and, when `request` is given, Colyseus's CORS headers and the
 * `{ code, error }` JSON its matchmaking clients read.
 */
export function reply(
  response: ServerResponse,
  status: number,
  refusal: Refusal,
  request?: IncomingMessage,
): void {
  const headers: Record<string, string | number> = {};
  if (refusal.retryAfter !== undefined) headers["retry-after"] = refusal.retryAfter;
  if (request === undefined) {
    response.writeHead(status, headers);
    response.end();
    return;
  }
  const json = JSON.stringify({ code: status, error: refusalMessage(refusal) });
  response.writeHead(status, {
    ...matchMaker.controller.DEFAULT_CORS_HEADERS,
    ...matchMaker.controller.getCorsHeaders(
      new Headers(
        typeof request.headers.origin === "string" ? { origin: request.headers.origin } : {},
      ),
    ),
    ...headers,
    "content-type": "application/json",
    "content-length": Buffer.byteLength(json),
  });
  response.end(json);
}

/**
 * Runs the gate, then hands the request on to Colyseus (`next`) unless it was
 * refused. The body is read here, so Colyseus gets it as `req.body`.
 */
async function gate(
  guard: AbuseGuard,
  routes: BrowserRoutes | undefined,
  req: IncomingMessage & { body?: unknown },
  res: ServerResponse,
  next: () => void,
): Promise<void> {
  const ip = clientIp(req.headers, req.socket.remoteAddress);
  if (ip !== undefined && req.headers["x-real-ip"] === undefined) req.headers["x-real-ip"] = ip;
  // Browser routes (`/client-config`, `/errors`) come before matchmaking and
  // are not part of Colyseus's router.
  if (routes && (await routes.handle(req, res))) return;
  const match = req.method === "POST" ? MATCHMAKE.exec(req.url ?? "") : null;
  if (!match) return next();
  const [, method = "", room = ""] = match;
  const id = guard.requestId();
  req.headers[REQUEST_ID_HEADER] = id;
  // A refused request (the Room name, a full Lobby, a lost race) holds no Seat.
  res.once("finish", () => {
    if (res.statusCode >= 400) guard.release(id);
  });
  const kind = kindOf(method, room);
  const read = await readRequest(req, {
    max: guard.limits.matchmakeBodyBytes,
    rate: kind === null ? undefined : (bucket) => guard.admitRequest(kind, bucket),
  });
  if ("refusal" in read) return reply(res, read.status, read.refusal, req);
  req.body = read.body;
  next();
}

/** A `node:http` server for the WebSocket transport, gated by `guard`. */
export function createGatedHttpServer(guard: AbuseGuard, routes?: BrowserRoutes): Server {
  const server = createServer();
  const emit = server.emit.bind(server) as (event: string | symbol, ...args: unknown[]) => boolean;
  // Intercepting `emit` puts the gate in front of every listener, whatever
  // order Colyseus registers its own in (it prepends one on `listen`).
  server.emit = ((event: string | symbol, ...args: unknown[]): boolean => {
    const [req, second] = args;
    if (event === "request" && req instanceof IncomingMessage && second instanceof ServerResponse) {
      gate(guard, routes, req, second, () => emit(event, ...args)).catch(() => {
        if (!second.headersSent) reply(second, 500, { code: "INTERNAL" }, req);
      });
      return true;
    }
    if (event === "upgrade" && req instanceof IncomingMessage && second instanceof Duplex) {
      const socket = second;
      const bucket = ipBucket(clientIp(req.headers, req.socket.remoteAddress));
      guard.socketOpened(bucket);
      socket.once("close", () => guard.socketClosed(bucket));
    }
    return emit(event, ...args);
  }) as typeof server.emit;
  return server;
}
