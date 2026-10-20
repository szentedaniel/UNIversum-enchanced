/**
 * Server-wide capacity (spec: Abuse protection → Capacity) and open sockets
 * per IP, through a real server with lowered limits.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startTestServer, type TestServer } from "./helpers.ts";

let server: TestServer;

beforeAll(async () => {
  server = await startTestServer({ limits: { liveLobbies: 2, socketsPerIp: 2 } });
});

afterAll(async () => {
  await server.stop();
});

describe("the live-Lobby cap", () => {
  it("refuses a new Room with SERVER_BUSY, lets joins through, and never counts a running game", async () => {
    const alice = await server.from("198.51.100.1").create({ maxPlayers: 2 });
    await server.from("198.51.100.2").create();

    expect(await server.matchmake("create/game", {}, { ip: "198.51.100.3" })).toEqual({
      code: "SERVER_BUSY",
    });

    const bob = await server.from("198.51.100.4").join(alice.code);
    bob.send({ type: "Start" });
    await alice.next("game");

    expect(await server.matchmake("create/game", {}, { ip: "198.51.100.3" })).toBeNull();
  });
});

/** A Room-less WebSocket from `ip`, or `null` when the server refused it. */
function connect(ip: string): Promise<WebSocket | null> {
  const socket = new WebSocket(`ws://127.0.0.1:${server.port}/`, {
    headers: { "x-real-ip": ip },
  });
  return new Promise((resolve) => {
    socket.addEventListener("open", () => resolve(socket));
    socket.addEventListener("error", () => resolve(null));
  });
}

describe("open WebSockets per IP", () => {
  it("refuses a socket over the limit, per IP, and counts a closed one free", async () => {
    const first = await connect("203.0.113.1");
    const second = await connect("203.0.113.1");

    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    expect(await connect("203.0.113.1")).toBeNull();
    expect(await connect("203.0.113.2")).not.toBeNull();

    first?.close();
    await expect.poll(async () => (await connect("203.0.113.1")) !== null).toBe(true);
  });
});
