import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { routeOf } from "../src/pwa/routing.ts";
import { withoutComments } from "./source-scan.ts";

// The service worker's routing (spec #184, Decisions 1 and 2): which requests
// it intercepts at all, which it answers from the immutable `/assets` cache
// and which it sends to the network first. Fixed URLs, no timers and no
// `Request`: the worker asks the same question about a request it already has.

const ORIGIN = "https://universum.example";

/** A same-origin request's route. */
function route(path: string, request: { method?: string; mode?: string } = {}) {
  return routeOf(
    {
      url: new URL(path, ORIGIN).href,
      method: request.method ?? "GET",
      mode: request.mode ?? "same-origin",
    },
    ORIGIN,
  );
}

describe("routeOf", () => {
  it("never touches the Room server's matchmaking, WebSocket or error paths", () => {
    expect(route("/colyseus")).toBe("never");
    expect(route("/colyseus/matchmake/joinOrCreate/universum")).toBe("never");
    expect(route("/colyseus/room-1?sessionId=abc", { mode: "websocket" })).toBe("never");
    expect(route("/client-config")).toBe("never");
    expect(route("/errors", { method: "POST" })).toBe("never");
  });

  it("gives hashed build output the cache-first route", () => {
    expect(route("/assets/index-abc123.js", { mode: "cors" })).toBe("cache-first-hashed");
    expect(route("/assets/font.woff2", { mode: "no-cors" })).toBe("cache-first-hashed");
    expect(route("/assets/index-abc123.js?v=1", { mode: "cors" })).toBe("cache-first-hashed");
  });

  it("sends navigations to the network first", () => {
    expect(route("/", { mode: "navigate" })).toBe("network-first");
    expect(route("/room/ABCD", { mode: "navigate" })).toBe("network-first");
    expect(route("/index.html", { mode: "navigate" })).toBe("network-first");
  });

  it("leaves cross-origin, non-GET and every other request alone", () => {
    expect(
      routeOf({ url: "https://cdn.example/assets/chunk.js", method: "GET", mode: "cors" }, ORIGIN),
    ).toBe("never");
    expect(route("/assets/index-abc123.js", { method: "POST" })).toBe("never");
    expect(route("/room/ABCD", { method: "POST", mode: "navigate" })).toBe("never");
    expect(route("/manifest.webmanifest")).toBe("never");
    expect(route("/icons/icon-192.png")).toBe("never");
    expect(route("/index.html", { mode: "cors" })).toBe("never");
    expect(route("/sw.js")).toBe("never");
  });

  it("matches the server paths exactly, not their prefixes", () => {
    expect(route("/colyseus-lobby", { mode: "navigate" })).toBe("network-first");
    expect(route("/errors-page", { mode: "navigate" })).toBe("network-first");
    expect(route("/client-configuration", { mode: "navigate" })).toBe("network-first");
  });
});

it("leaves the new worker to take over on the next launch", () => {
  const source = readFileSync(new URL("../src/pwa/sw.ts", import.meta.url), "utf8");
  expect(withoutComments(source)).not.toMatch(/\bskipWaiting\b|\bclients\.claim\b/);
});
