import { afterEach, describe, expect, it } from "vitest";
import { createLogger } from "#observability/logger.ts";
import { captureLogs, eventually, startTestServer, type TestServer } from "./helpers.ts";

let server: TestServer | undefined;

afterEach(async () => {
  await server?.stop();
  server = undefined;
});

/** The value of one sample in a Prometheus text scrape, e.g. `sample(text, 'rooms{state="lobby"}')`. */
function sample(scrape: string, series: string): number {
  const line = scrape.split("\n").find((l) => l.startsWith(`${series} `));
  if (line === undefined) throw new Error(`no sample ${series} in the scrape`);
  return Number(line.slice(series.length + 1));
}

describe("metrics", () => {
  it("a scrape after played intents shows the Rooms, connections, intents and Rejections", async () => {
    server = await startTestServer();
    const alice = await server.create({ maxPlayers: 2 });
    const bob = await server.join(alice.code);
    await bob.until("lobby", (l) => l.seats.length === 2);

    const lobby = await server.metrics.scrape();
    expect(sample(lobby, 'rooms{state="lobby"}')).toBe(1);
    expect(sample(lobby, 'rooms{state="playing"}')).toBe(0);
    expect(sample(lobby, "players_connected")).toBe(2);

    alice.send({ type: "Start" });
    const { view } = await alice.next("game");
    await bob.next("game");
    const current = view.players[0]?.id === (await alice.next("welcome")).playerId ? alice : bob;
    const other = current === alice ? bob : alice;
    other.send({ type: "Roll", turn: view.turn }); // not their Turn
    await other.next("rejected");
    other.send({ hello: "world" }); // malformed
    await other.next("rejected");
    current.send({ type: "Roll", turn: view.turn });
    await current.next("game");

    const played = await server.metrics.scrape();
    expect(sample(played, 'rooms{state="lobby"}')).toBe(0);
    expect(sample(played, 'rooms{state="playing"}')).toBe(1);
    expect(sample(played, 'intents_total{result="accepted"}')).toBe(2);
    expect(sample(played, 'intents_total{result="rejected"}')).toBe(2);
    expect(sample(played, 'rejections_total{code="NOT_YOUR_TURN"}')).toBe(1);
    expect(sample(played, 'rejections_total{code="MALFORMED"}')).toBe(1);
    expect(sample(played, 'rejections_total{code="ROOM_FULL"}')).toBe(0);
    expect(sample(played, "intent_duration_seconds_count")).toBe(4);
    // Two Seats taken, Start, Roll.
    expect(sample(played, "room_store_write_duration_seconds_count")).toBe(4);
    expect(sample(played, "rooms_restored")).toBe(0);
    expect(sample(played, "seat_drops_total")).toBe(0);

    await other.leave();

    await eventually(async () => {
      const dropped = await server!.metrics.scrape();
      expect(sample(dropped, "seat_drops_total")).toBe(1);
      expect(sample(dropped, "players_connected")).toBe(1);
      expect(sample(dropped, "seats_held_disconnected")).toBe(1);
    });
  });

  it("no series is labelled with a Room code or a Player", async () => {
    server = await startTestServer();
    const alice = await server.create({ maxPlayers: 2 });
    const { playerId } = await alice.next("welcome");

    const scrape = await server.metrics.scrape();

    expect(scrape).not.toContain(alice.code);
    expect(scrape).not.toContain(playerId);
  });

  it("reports the Rooms restored at boot and how long the restore took", async () => {
    server = await startTestServer();
    await server.create({ maxPlayers: 2 });
    await server.create({ maxPlayers: 3 });
    const { databasePath } = server;
    await server.stop();

    server = await startTestServer({ databasePath });
    const scrape = await server.metrics.scrape();

    expect(sample(scrape, "rooms_restored")).toBe(2);
    expect(sample(scrape, "restore_duration_seconds")).toBeGreaterThan(0);
    expect(sample(scrape, 'rooms{state="lobby"}')).toBe(2);
  });
});

describe("logs", () => {
  it("say which Rooms came back at boot, as Lobbies or running games", async () => {
    server = await startTestServer();
    const lobby = await server.create({ maxPlayers: 2 });
    const { databasePath } = server;
    await server.stop();
    const capture = captureLogs();

    server = await startTestServer({
      databasePath,
      log: createLogger({ level: "info", stream: capture.stream }),
    });

    expect(capture.lines().filter((l) => l["msg"] === "Room restored")).toEqual([
      expect.objectContaining({ level: 30, roomCode: lobby.code, playing: false, seats: 1 }),
    ]);
  });

  it("tell the Room and Seat story with roomCode and the public Player id, and never a secret or IP", async () => {
    const capture = captureLogs();
    server = await startTestServer({
      log: createLogger({ level: "debug", stream: capture.stream }),
    });
    const alice = await server.create({ maxPlayers: 2, password: "hunter2-secret" });
    await expect(server.join(alice.code, { password: "wrong-guess" })).rejects.toThrow();
    const bob = await server.join(alice.code, { password: "hunter2-secret" });
    const aliceId = (await alice.next("welcome")).playerId;
    const bobId = (await bob.next("welcome")).playerId;
    alice.send({ type: "Start" });
    const { view } = await alice.next("game");
    const current = view.players[0]?.id === aliceId ? alice : bob;
    const other = current === alice ? bob : alice;
    other.send({ type: "Roll", turn: view.turn });
    await other.next("rejected");
    current.send({ type: "Roll", turn: view.turn });
    await current.next("game");
    await other.leave();
    await eventually(() => {
      expect(capture.lines().some((l) => l["msg"] === "Seat dropped")).toBe(true);
    });

    const lines = capture.lines();
    const about = (msg: string) => lines.filter((l) => l["msg"] === msg);
    const code = alice.code;
    expect(about("Room created")).toEqual([expect.objectContaining({ level: 30, roomCode: code })]);
    expect(about("Seat taken").map((l) => l["playerId"])).toEqual([aliceId, bobId]);
    expect(about("Room started")).toEqual([expect.objectContaining({ level: 30, roomCode: code })]);
    expect(about("intent accepted")).toEqual([
      expect.objectContaining({ level: 20, roomCode: code, intent: "Start" }),
      expect.objectContaining({ level: 20, roomCode: code, intent: "Roll" }),
    ]);
    expect(about("Rejection")).toEqual([
      expect.objectContaining({
        level: 20,
        roomCode: code,
        playerId: other === alice ? aliceId : bobId,
        intent: "Roll",
        code: "NOT_YOUR_TURN",
      }),
    ]);
    expect(about("Seat dropped")).toEqual([
      expect.objectContaining({
        level: 30,
        roomCode: code,
        playerId: other === alice ? aliceId : bobId,
      }),
    ]);

    const stored = server.store.unfinished().find((r) => r.code === code)?.password;
    const secrets = [
      "hunter2-secret",
      "wrong-guess",
      stored?.hash,
      stored?.salt,
      alice.room.reconnectionToken,
      bob.room.reconnectionToken,
      "127.0.0.1",
    ];
    for (const secret of secrets) {
      expect(secret).toBeTruthy();
      expect(capture.text()).not.toContain(secret);
    }
  });
});
