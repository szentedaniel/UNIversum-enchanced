import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startTestServer, type TestClient, type TestServer } from "./helpers.ts";

let server: TestServer;

beforeAll(async () => {
  server = await startTestServer();
});

afterAll(async () => {
  await server.stop();
});

/** A full Lobby of `players` Guests, in join order, with everyone's Player id taken. */
async function fullLobby(players: 2 | 3 | 4) {
  const creator = await server.create({ maxPlayers: players });
  const clients: TestClient[] = [creator];
  for (let i = 1; i < players; i++) {
    // oxlint-disable-next-line no-await-in-loop -- one after another: join order is Seat order
    clients.push(await server.join(creator.code));
  }
  const ids = await Promise.all(clients.map(async (c) => (await c.next("welcome")).playerId));
  return { clients, ids, code: creator.code };
}

/** A started game, with everyone's first push taken: the Room is now waiting for its first Roll. */
async function startedGame(players: 2 | 3 | 4 = 2) {
  const { clients, ids, code } = await fullLobby(players);
  clients[0]?.send({ type: "Start" });
  const views = await Promise.all(clients.map((c) => c.next("game")));
  return { clients, ids, code, view: views[0]!.view };
}

describe("chat", () => {
  it("broadcasts a chat to every Seat with its sender's Seat", async () => {
    const { clients, ids, view } = await startedGame();
    const [alice, bob] = clients;

    // Bob chats while it is Alice's Turn: chat is allowed in any phase.
    expect(view.currentPlayer).toBe(ids[0]);
    bob!.sendChat({ id: "good_luck" });

    const chat = { seat: 1, id: "good_luck" };
    expect(await alice!.next("chat")).toEqual(chat);
    expect(await bob!.next("chat")).toEqual(chat);
  });

  it("refuses an id outside the catalogue with MALFORMED, and broadcasts nothing", async () => {
    const { clients } = await startedGame();
    const [alice, bob] = clients;

    bob!.sendChat({ id: "teleport" });

    expect(await bob!.next("rejected")).toEqual({ code: "MALFORMED" });
    expect(alice!.pending("chat")).toEqual([]);
  });

  it("never takes the sender from the payload", async () => {
    const { clients } = await startedGame();
    const [alice, bob] = clients;

    // A seat in the payload is an extra field: the schema refuses it, so nobody
    // can chat in another Player's name.
    bob!.sendChat({ id: "cheer", seat: 0 });

    expect(await bob!.next("rejected")).toEqual({ code: "MALFORMED" });
    expect(alice!.pending("chat")).toEqual([]);
  });

  it("drops a second chat within the second with one SLOW_DOWN, and broadcasts nothing", async () => {
    const { clients } = await startedGame();
    const [alice, bob] = clients;

    bob!.sendChat({ id: "good_luck" });
    const chat = { seat: 1, id: "good_luck" };
    expect(await alice!.next("chat")).toEqual(chat);
    expect(await bob!.next("chat")).toEqual(chat);

    bob!.sendChat({ id: "cheer" });

    expect(await bob!.next("rejected")).toEqual({ code: "SLOW_DOWN" });
    expect(alice!.pending("chat")).toEqual([]);
    expect(bob!.pending("chat")).toEqual([]);
  });

  it("refuses chat in the Lobby with NOT_OFFERED", async () => {
    const { clients } = await fullLobby(2);
    const [alice, bob] = clients;

    bob!.sendChat({ id: "good_luck" });

    expect(await bob!.next("rejected")).toEqual({ code: "NOT_OFFERED" });
    expect(alice!.pending("chat")).toEqual([]);
  });

  it("leaves the game state, its version and the stored Room untouched", async () => {
    const { clients, code } = await startedGame();
    const [alice, bob] = clients;
    const room = server.room(code);
    if (!room) throw new Error("the Room is live");
    const stored = server.store.unfinished().find((r) => r.code === code);
    expect(stored).toBeDefined();
    const before = JSON.stringify(stored);
    const version = room.game?.version;

    bob!.sendChat({ id: "cheer" });
    await alice!.next("chat");

    expect(room.game?.version).toBe(version);
    expect(JSON.stringify(server.store.unfinished().find((r) => r.code === code))).toBe(before);
    // No game push either: a chat never moves the Playback or the Turn clock.
    expect(alice!.pending("game")).toEqual([]);
  });
});
