import type { JoinOptions } from "@universum/protocol/messages";
import { MatchMakeError } from "@colyseus/sdk";
import type * as ColyseusSdk from "@colyseus/sdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { joinRoom, watchRoom } from "#connection.ts";
import { reset, roomStore } from "#stores/room-store.ts";

// Watching a Room (spec #179, decisions 2–4): the wire options a watcher and a
// Player send, and how a dropped watcher comes back. The `@colyseus/sdk` client
// is the one boundary between `connection.ts` and the Room server, so this
// replaces it with a fake that records each join and can drop the connection.
// A real Room's refusal is a `MatchMakeError`, which the real SDK class stays.

type Join = { method: "joinById" | "create"; code: string | null; options: JoinOptions };

const sdk = vi.hoisted(() => {
  const joins: Join[] = [];
  const rooms: FakeRoom[] = [];
  let failure: unknown = null;

  /** The SDK's client side of one Room connection: handlers the module registers, and a drop. */
  class FakeRoom {
    readonly roomId: string;
    readonly connection = { isOpen: true };
    readonly reconnection: {
      maxRetries?: number;
      backoff?: (attempt: number, delay: number) => number;
    } = {};
    readonly dropHandlers: (() => void)[] = [];
    readonly leaveHandlers: ((code: number) => void)[] = [];

    constructor(roomId: string) {
      this.roomId = roomId;
    }

    onMessage(): void {}
    onReconnect(): void {}

    onDrop(handler: () => void): void {
      this.dropHandlers.push(handler);
    }

    onLeave(handler: (code: number) => void): void {
      this.leaveHandlers.push(handler);
    }

    async leave(): Promise<void> {
      this.connection.isOpen = false;
    }

    /** The connection dropped and the SDK gave up on it: `onDrop`, then `onLeave`. */
    drop(): void {
      for (const handler of this.dropHandlers) handler();
      this.connection.isOpen = false;
      // 1006: no close frame, as a dead network gives (4000 is the server's consent).
      for (const handler of this.leaveHandlers) handler(1006);
    }
  }

  class FakeClient {
    readonly endpoint: string;

    constructor(endpoint: string) {
      this.endpoint = endpoint;
    }

    async joinById(code: string, options: JoinOptions): Promise<FakeRoom> {
      joins.push({ method: "joinById", code, options });
      if (failure !== null) throw failure;
      const room = new FakeRoom(code);
      rooms.push(room);
      return room;
    }

    async create(_name: string, options: JoinOptions & Record<string, unknown>): Promise<FakeRoom> {
      joins.push({ method: "create", code: null, options });
      const room = new FakeRoom("654321");
      rooms.push(room);
      return room;
    }
  }

  return {
    joins,
    rooms,
    FakeClient,
    failWith: (error: unknown) => {
      failure = error;
    },
  };
});

vi.mock("@colyseus/sdk", async (importOriginal) => ({
  ...(await importOriginal<typeof ColyseusSdk>()),
  Client: sdk.FakeClient,
}));

beforeEach(() => {
  sdk.joins.length = 0;
  sdk.rooms.length = 0;
  sdk.failWith(null);
  reset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("watching a Room", () => {
  it("joins by Room code with the watch flag and no Guest token", async () => {
    await expect(watchRoom("123456", "titok")).resolves.toBe("123456");

    expect(sdk.joins).toEqual([
      {
        method: "joinById",
        code: "123456",
        options: { code: "123456", password: "titok", watch: true },
      },
    ]);
    expect(roomStore.getState()).toMatchObject({
      status: "connected",
      code: "123456",
      role: "spectator",
      me: null,
    });
  });

  it("surfaces the Room's refusal as a JoinError with its code", async () => {
    sdk.failWith(new MatchMakeError("SPECTATORS_FULL", 409));

    await expect(watchRoom("123456")).rejects.toMatchObject({
      code: "SPECTATORS_FULL",
      retryAfter: null,
    });
    expect(roomStore.getState().status).toBe("idle");
  });
});

describe("a Spectator's rejoin", () => {
  it("comes back by Room code with the watch flag, without a Seat or a token", async () => {
    await watchRoom("123456");
    vi.useFakeTimers();

    sdk.rooms.at(-1)!.drop();
    expect(roomStore.getState().status).toBe("reconnecting");
    await vi.advanceTimersByTimeAsync(1_000);

    expect(sdk.joins.at(-1)).toEqual({
      method: "joinById",
      code: "123456",
      options: { code: "123456", watch: true },
    });
    expect(roomStore.getState()).toMatchObject({ status: "connected", role: "spectator" });
  });

  it("keeps a Player's own rejoin a Guest-token join, never a watch", async () => {
    await joinRoom("123456");
    vi.useFakeTimers();

    sdk.rooms.at(-1)!.drop();
    await vi.advanceTimersByTimeAsync(1_000);

    const rejoined = sdk.joins.at(-1)!;
    expect(rejoined.method).toBe("joinById");
    expect(rejoined.options.watch).toBeUndefined();
    expect(rejoined.options.guestToken).toMatch(/^[0-9a-f]{32}$/);
    expect(roomStore.getState().role).toBe("player");
  });
});
