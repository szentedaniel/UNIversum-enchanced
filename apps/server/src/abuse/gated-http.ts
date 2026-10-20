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
 */
import { createServer, IncomingMessage, ServerResponse, type Server } from "node:http";
import { Duplex } from "node:stream";
import { matchMaker } from "@colyseus/core";
import { GAME_ROOM, refusalMessage, type Refusal } from "@universum/protocol";
import { REQUEST_ID_HEADER, type AbuseGuard, type RequestKind } from "#abuse/guard.ts";
import { clientIp, ipBucket } from "#abuse/ip.ts";

const MATCHMAKE = /^\/matchmake\/(\w+)\/([^/?#]+)/;

/** What a matchmaking request counts as, if anything (the Lobby list's own Room is free). */
function kindOf(method: string, room: string): RequestKind | null {
  if (method === "create") return room === GAME_ROOM ? "create" : null;
  if (method === "joinById") return "join";
  if (method === "join" || method === "joinOrCreate") return room === GAME_ROOM ? "join" : null;
  return null;
}

/** Answers like Colyseus's own matchmaking errors: `{ code, error }`, the error being the Rejection. */
function refuse(req: IncomingMessage, res: ServerResponse, status: number, refusal: Refusal): void {
  const json = JSON.stringify({ code: status, error: refusalMessage(refusal) });
  const headers: Record<string, string | number> = {
    ...matchMaker.controller.DEFAULT_CORS_HEADERS,
    ...matchMaker.controller.getCorsHeaders(
      new Headers(typeof req.headers.origin === "string" ? { origin: req.headers.origin } : {}),
    ),
    "content-type": "application/json",
    "content-length": Buffer.byteLength(json),
  };
  if (refusal.retryAfter !== undefined) headers["retry-after"] = refusal.retryAfter;
  res.writeHead(status, headers);
  res.end(json);
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

/**
 * Runs the gate, then hands the request on to Colyseus (`next`) unless it was
 * refused. The body is read here, so Colyseus gets it as `req.body`.
 */
async function gate(
  guard: AbuseGuard,
  req: IncomingMessage & { body?: unknown },
  res: ServerResponse,
  next: () => void,
): Promise<void> {
  const ip = clientIp(req.headers, req.socket.remoteAddress);
  if (ip !== undefined && req.headers["x-real-ip"] === undefined) req.headers["x-real-ip"] = ip;
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
  if (kind) {
    const refusal = await guard.admitRequest(kind, ipBucket(ip));
    if (refusal) return refuse(req, res, 429, refusal);
  }
  const max = guard.limits.matchmakeBodyBytes;
  if (Number(req.headers["content-length"] ?? 0) > max) {
    return refuse(req, res, 413, { code: "MALFORMED" });
  }
  const body = await readBody(req, max);
  if (body === null) return refuse(req, res, 413, { code: "MALFORMED" });
  req.body = body;
  next();
}

/** A `node:http` server for the WebSocket transport, gated by `guard`. */
export function createGatedHttpServer(guard: AbuseGuard): Server {
  const server = createServer();
  const emit = server.emit.bind(server) as (event: string | symbol, ...args: unknown[]) => boolean;
  // Intercepting `emit` puts the gate in front of every listener, whatever
  // order Colyseus registers its own in (it prepends one on `listen`).
  server.emit = ((event: string | symbol, ...args: unknown[]): boolean => {
    const [req, second] = args;
    if (event === "request" && req instanceof IncomingMessage && second instanceof ServerResponse) {
      gate(guard, req, second, () => emit(event, ...args)).catch(() => {
        if (!second.headersSent) refuse(req, second, 500, { code: "INTERNAL" });
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
